// The screens map: the Mac's displays drawn to scale with live window screenshots. Drag to move,
// drag the corner to resize, tap to focus; the preset buttons snap the selected window.
import { esc, makeThrottle, shake } from './util.js';
import { allWindowIds } from './shots.js';

const SHOT_REFRESH_MS = 15000; // each capture briefly blocks Hammerspoon, so not too often
const MOVE_THROTTLE_MS = 150; // each move makes the Mac rebuild and push the window list

// Fits the bounding box of all screens into width × height, centred.
export function mapFit(screens, width, height) {
  const minX = Math.min(...screens.map((s) => s.frame.x));
  const minY = Math.min(...screens.map((s) => s.frame.y));
  const maxX = Math.max(...screens.map((s) => s.frame.x + s.frame.w));
  const maxY = Math.max(...screens.map((s) => s.frame.y + s.frame.h));
  const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
  return { scale, minX, minY, ox: (width - (maxX - minX) * scale) / 2, oy: (height - (maxY - minY) * scale) / 2 };
}

export function toMap(frame, fit) {
  return {
    left: (frame.x - fit.minX) * fit.scale + fit.ox,
    top: (frame.y - fit.minY) * fit.scale + fit.oy,
    width: frame.w * fit.scale,
    height: frame.h * fit.scale,
  };
}

export function fromMap(rect, fit) {
  return {
    x: Math.round((rect.left - fit.ox) / fit.scale + fit.minX),
    y: Math.round((rect.top - fit.oy) / fit.scale + fit.minY),
    w: Math.round(rect.width / fit.scale),
    h: Math.round(rect.height / fit.scale),
  };
}

function overlapArea(f, s) {
  const w = Math.min(f.x + f.w, s.x + s.w) - Math.max(f.x, s.x);
  const h = Math.min(f.y + f.h, s.y + s.h) - Math.max(f.y, s.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// Keeps a dragged frame on a screen: onto the one it overlaps most (or the nearest), shrunk to
// fit. The Mac applies the same rule (Layout.clamp in tabletpanel/layout_model.lua).
export function clampToScreens(frame, screens) {
  let best = null;
  let bestOverlap = -1;
  let bestDistance = Infinity;
  for (const { frame: s } of screens) {
    const o = overlapArea(frame, s);
    const d = ((frame.x + frame.w / 2) - (s.x + s.w / 2)) ** 2 + ((frame.y + frame.h / 2) - (s.y + s.h / 2)) ** 2;
    if (o > bestOverlap || (o === bestOverlap && d < bestDistance)) { best = s; bestOverlap = o; bestDistance = d; }
  }
  if (!best) return frame;
  const w = Math.min(frame.w, best.w);
  const h = Math.min(frame.h, best.h);
  return {
    x: Math.max(best.x, Math.min(frame.x, best.x + best.w - w)),
    y: Math.max(best.y, Math.min(frame.y, best.y + best.h - h)),
    w,
    h,
  };
}

// Layout presets (as in tabletpanel/layout_model.lua): id, label, left edge and width as fractions.
const PRESETS = [
  ['left-third', 'Left ⅓', 0, 1 / 3], ['middle-third', 'Middle ⅓', 1 / 3, 1 / 3], ['right-third', 'Right ⅓', 2 / 3, 1 / 3],
  ['left-half', 'Left ½', 0, 0.5], ['right-half', 'Right ½', 0.5, 0.5], ['center', 'Centre', 1 / 6, 2 / 3],
  ['max', 'Full', 0, 1], ['other-screen', 'Other screen', null, null],
];

const presetGlyph = (left, width) => left == null
  ? '<svg viewBox="0 0 64 22"><rect x="1" y="3" width="36" height="16" rx="3"/><rect x="45" y="5" width="18" height="12" rx="2"/><path d="M30 11h22m-5-4 5 4-5 4" fill="none"/></svg>'
  : `<svg viewBox="0 0 64 22"><rect x="1" y="3" width="62" height="16" rx="3"/><rect class="zone" x="${1 + 62 * left}" y="3" width="${62 * width}" height="16" rx="3"/></svg>`;

export function initMap(ctx) {
  const mapEl = ctx.$('map');
  const mapTools = ctx.$('map-tools');
  const map = { fit: null, selected: null, drag: null };

  // Screenshots come from the shared cache (shots.js): captured one at a time, crossfaded in.
  function refreshShots() {
    ctx.shots.prune(allWindowIds(ctx.store));
    return ctx.shots.refresh(mapWindows().map((x) => x.w.id), fadeInShot);
  }

  function fadeInShot(id, url) {
    const el = mapEl.querySelector(`.mwin[data-id="${id}"]`);
    if (!el) return;
    const old = el.querySelector('.mshot');
    const img = new Image();
    img.src = url;
    img.className = 'mshot fresh';
    img.alt = '';
    el.insertBefore(img, el.querySelector('.mwin-head')); // on top of the old one
    img.addEventListener('animationend', () => {
      img.classList.remove('fresh');
      if (old) old.remove();
    }, { once: true });
  }
  mapTools.innerHTML = PRESETS.map(([id, label, l, w]) => `<button class="preset" data-preset="${id}">${presetGlyph(l, w)}<span>${label}</span></button>`).join('');

  function mapWindows() {
    const out = [];
    for (const app of (ctx.store.windows && ctx.store.windows.apps) || []) {
      for (const w of app.windows) {
        if (w.frame && !w.minimized && !w.otherSpace && !app.hidden) out.push({ app, w });
      }
    }
    // Back to front, so later elements sit on top like windows on the screen.
    return out.sort((a, b) => (b.w.z || 1e9) - (a.w.z || 1e9));
  }

  function renderMap() {
    if (ctx.pages.current() !== 1 || map.drag) return;
    const screens = ctx.store.windows && ctx.store.windows.screens;
    if (!screens || !screens.length) { mapEl.innerHTML = ''; return; }
    const box = mapEl.getBoundingClientRect();
    map.fit = mapFit(screens, box.width, box.height);
    const px = (r) => `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    const wins = mapWindows();
    if (map.selected && !wins.some((x) => x.w.id === map.selected)) map.selected = null;
    mapEl.innerHTML = screens.map((sc) => `<div class="mscreen" style="${px(toMap(sc.frame, map.fit))}"><span>${esc(sc.name)}</span></div>`).join('')
      + wins.map(({ app, w }) => {
        const cls = ['mwin'];
        if (w.id === ctx.store.windows.focusedId) cls.push('focused');
        if (w.id === map.selected) cls.push('selected');
        // The window's live look (needs Screen Recording on the Mac; otherwise just the plain card).
        const url = ctx.shots.url(w.id);
        const shot = url ? `<img class="mshot" src="${url}" alt="">` : '';
        return `<div class="${cls.join(' ')}" data-id="${w.id}" style="${px(toMap(w.frame, map.fit))}">
            ${shot}
            <div class="mwin-head"><img src="${esc(ctx.windows.iconUrl(app.bundleId))}" alt=""><span>${esc(w.title)}</span></div>
            <div class="grip"></div>
          </div>`;
      }).join('');
    mapTools.classList.toggle('on', !!map.selected);
  }

  const sendMove = makeThrottle((id, frame) => ctx.send('windows.move', { id, ...frame }), MOVE_THROTTLE_MS);

  mapEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.mwin');
    if (!el) { map.selected = null; renderMap(); return; }
    const id = Number(el.dataset.id);
    map.selected = id;
    mapEl.querySelectorAll('.mwin.selected').forEach((x) => x.classList.remove('selected'));
    el.classList.add('selected');
    mapTools.classList.add('on');
    el.setPointerCapture(e.pointerId);
    map.drag = {
      id, el, x: e.clientX, y: e.clientY, moved: false, resize: !!e.target.closest('.grip'),
      start: { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight },
    };
  });

  mapEl.addEventListener('pointermove', (e) => {
    const d = map.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    const r = { ...d.start };
    if (d.resize) {
      r.width = Math.max(30, d.start.width + dx);
      r.height = Math.max(20, d.start.height + dy);
    } else {
      r.left += dx;
      r.top += dy;
    }
    const frame = clampToScreens(fromMap(r, map.fit), ctx.store.windows.screens); // stops at the screen edge
    const shown = toMap(frame, map.fit);
    Object.assign(d.el.style, { left: shown.left + 'px', top: shown.top + 'px', width: shown.width + 'px', height: shown.height + 'px' });
    d.frame = frame;
    sendMove(d.id, frame);
  });

  function endDrag() {
    const d = map.drag;
    if (!d) return;
    map.drag = null;
    if (!d.moved) {
      ctx.windows.focusWindow(d.id, () => mapEl.querySelector(`.mwin[data-id="${d.id}"]`));
    } else if (d.frame) {
      ctx.send('windows.move', { id: d.id, ...d.frame }).then((r) => { if (!r.ok) shake(d.el); });
    }
    setTimeout(renderMap, 150); // let the Mac's update catch up before redrawing
    if (d.moved) setTimeout(refreshShots, 400); // the window redraws at its new size
  }
  mapEl.addEventListener('pointerup', endDrag);
  mapEl.addEventListener('pointercancel', endDrag);

  mapTools.addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (!b || !map.selected) return;
    ctx.send('windows.layout', { id: map.selected, preset: b.dataset.preset }).then((r) => {
      if (!r.ok) shake(b);
      else setTimeout(refreshShots, 400); // the window redraws at its new size
    });
  });

  setInterval(() => { if (ctx.pages.current() === 1 && !ctx.sleep.isAsleep()) refreshShots(); }, SHOT_REFRESH_MS);
  window.addEventListener('resize', () => { if (ctx.pages.current() === 1) renderMap(); });
  ctx.on('windows', renderMap);

  return { show: () => { renderMap(); refreshShots(); } };
}
