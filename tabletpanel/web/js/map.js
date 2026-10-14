// The screens map: the Mac's displays drawn to scale with live window screenshots. Drag to move,
// drag the corner to resize, tap to focus; the preset buttons snap the selected window.
import { esc, makeThrottle, shake } from './util.js';

const SHOT_REFRESH_MS = 15000; // each capture briefly blocks Hammerspoon, so not too often
const MOVE_THROTTLE_MS = 80;

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

  // Window screenshots: each new one is downloaded and decoded off-screen, then crossfaded over the
  // old one, so a refresh never shows an empty window. Kept as object URLs so redraws reuse them.
  const shots = new Map(); // window id -> object URL of its latest screenshot
  let shotsBusy = false;

  async function refreshShots() {
    if (ctx.MOCK || shotsBusy) return;
    shotsBusy = true;
    const ids = mapWindows().map((x) => x.w.id);
    for (const id of ids) { // one at a time: each capture briefly blocks Hammerspoon
      try {
        const res = await fetch(`/thumb/${id}.jpg?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) continue; // no Screen Recording permission, or the window can't be captured
        const url = URL.createObjectURL(await res.blob());
        const img = new Image();
        img.src = url;
        await img.decode();
        const old = shots.get(id);
        shots.set(id, url);
        fadeInShot(id, img);
        if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
      } catch (_) { /* keep the previous screenshot */ }
    }
    for (const [id, url] of shots) {
      if (!ids.includes(id)) { URL.revokeObjectURL(url); shots.delete(id); }
    }
    shotsBusy = false;
  }

  function fadeInShot(id, img) {
    const el = mapEl.querySelector(`.mwin[data-id="${id}"]`);
    if (!el) return;
    const old = el.querySelector('.mshot');
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
        const shot = shots.has(w.id) ? `<img class="mshot" src="${shots.get(w.id)}" alt="">` : '';
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
    Object.assign(d.el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    d.rect = r;
    sendMove(d.id, fromMap(r, map.fit));
  });

  function endDrag() {
    const d = map.drag;
    if (!d) return;
    map.drag = null;
    if (!d.moved) {
      ctx.windows.focusWindow(d.id, () => mapEl.querySelector(`.mwin[data-id="${d.id}"]`));
    } else if (d.rect) {
      ctx.send('windows.move', { id: d.id, ...fromMap(d.rect, map.fit) });
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
