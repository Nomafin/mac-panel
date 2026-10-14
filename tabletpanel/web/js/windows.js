// The app grid: one tile per app, like the Dock. Pinned apps first, a tap focuses the window,
// opens the sheet (several windows) or launches the app; the focus lamp glides between tiles.
import { esc, replay, shake } from './util.js';
import { mockIcon } from './mock.js';

const TILE_MAX = 136;
const TILE_MIN = 64;
const LAUNCH_BOUNCE_MS = 10000;

// The largest tile (px) at which `count` tiles fit in width × height without scrolling.
// Gaps and the stack strips' headroom scale with the tile.
export function tileSize(count, width, height) {
  for (let s = TILE_MAX; s > TILE_MIN; s -= 2) {
    const k = s / TILE_MAX;
    const gx = 16 * k;
    const gy = 22 * k;
    const cols = Math.max(1, Math.floor((width + gx) / (s + gx)));
    const rows = Math.ceil(count / cols);
    if (rows * s + Math.max(0, rows - 1) * gy + 11 * k <= height) return s;
  }
  return TILE_MIN;
}

// What tapping an app's tile does, like clicking it in the Dock.
export function tileAction(app) {
  if (!app.windows.length) return 'launch';
  return app.windows.length === 1 ? 'focus' : 'sheet';
}

const SPACE_MARK = '<svg class="space-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="12" height="12" rx="2.5"/><path d="M9 4h9.5A2.5 2.5 0 0 1 21 6.5V15"/></svg>';

export function initWindows(ctx) {
  const { $, store } = ctx;
  const scroller = $('windows');
  const stage = $('stage');
  const grid = $('grid');
  const lamp = $('lamp');
  const clock = $('clock');
  const macstatEl = $('macstat');
  const actionsEl = $('actions');
  let knownApps = null; // apps rendered last time; new ones get an entrance
  let gridHtml = '';
  const launching = new Map(); // bundleId -> timeout; these tiles bounce until a window shows up

  function iconUrl(bundleId) {
    return ctx.MOCK ? mockIcon(bundleId) : 'icon/' + encodeURIComponent(bundleId) + '.png';
  }

  function windowFlag(app, win) {
    return win.minimized ? 'In the Dock' : win.otherSpace ? 'Other Space' : app.hidden ? 'Hidden' : '';
  }

  function findApp(bundleId) {
    const w = store.windows;
    return w && w.apps ? w.apps.find((a) => a.bundleId === bundleId) : null;
  }

  function tileFor(bundleId) {
    return grid.querySelector(`.tile[data-app="${CSS.escape(bundleId)}"]`);
  }

  function badgeFor(bundleId) {
    const items = store.badges && store.badges.items;
    const hit = items && items.find((b) => b.bundleId === bundleId);
    return hit ? hit.label : null;
  }

  // Tiles depend only on the window data; focus, entrances and the open sheet are classes
  // applied afterwards, so a focus change never rebuilds the grid (and never cuts an animation).
  function tileHtml(app) {
    const action = tileAction(app);
    const win = app.windows[0];
    const cls = ['tile'];
    if (app.running === false) cls.push('off');
    if (app.hidden) cls.push('app-hidden');
    if (action === 'focus' && win.minimized) cls.push('minimized');
    if (action === 'sheet') cls.push('stack');
    if (launching.has(app.bundleId)) cls.push('launching');
    const flag = win ? windowFlag(app, win) : '';
    const label = action === 'focus' ? `${app.name}: ${win.title}${flag ? ' (' + flag + ')' : ''}`
      : action === 'sheet' ? `${app.name}, ${app.windows.length} windows`
      : app.running === false ? `Open ${app.name}` : `${app.name}: new window`;
    const badge = badgeFor(app.bundleId);
    return `<button class="${cls.join(' ')}" data-app="${esc(app.bundleId)}"${action === 'focus' ? ` data-id="${win.id}"` : ''} aria-label="${esc(label)}" title="${esc(label)}">
        <img class="icon" src="${esc(iconUrl(app.bundleId))}" alt="">
        ${action === 'sheet' ? `<span class="n">${app.windows.length}</span>` : win && win.otherSpace ? SPACE_MARK : ''}
        ${badge ? `<span class="badge">${esc(badge)}</span>` : ''}
      </button>`;
  }

  function stopBounce(bundleId) {
    clearTimeout(launching.get(bundleId));
    launching.delete(bundleId);
  }

  function launchApp(bundleId) {
    clearTimeout(launching.get(bundleId));
    launching.set(bundleId, setTimeout(() => { launching.delete(bundleId); render(); }, LAUNCH_BOUNCE_MS));
    render();
    ctx.send('windows.launch', { bundleId }).then((r) => {
      if (r.ok) return;
      stopBounce(bundleId);
      render();
      shake(tileFor(bundleId));
    });
  }

  // The tiles shrink when there are more apps than fit, so nothing needs scrolling.
  function fitTiles() {
    const n = store.windows && store.windows.apps ? store.windows.apps.length : 0;
    const cs = getComputedStyle(scroller);
    const width = scroller.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const height = scroller.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      - clock.offsetHeight - parseFloat(getComputedStyle(clock).marginBottom) - macstatEl.offsetHeight
      - actionsEl.offsetHeight;
    const size = tileSize(n, width, height) + 'px';
    if (stage.style.getPropertyValue('--tile') !== size) stage.style.setProperty('--tile', size);
  }

  function render() {
    const w = store.windows;
    if (!w || !w.apps || !w.apps.length) {
      gridHtml = '';
      grid.innerHTML = '<p class="empty">No open windows on your Mac.</p>';
      placeLamp();
      ctx.sheet.close();
      return;
    }
    w.apps.forEach((a) => { if (a.windows.length && launching.has(a.bundleId)) stopBounce(a.bundleId); });
    fitTiles();
    const html = w.apps.map(tileHtml).join('');
    if (html !== gridHtml) {
      gridHtml = html;
      grid.innerHTML = html;
      if (knownApps) {
        w.apps.forEach((a) => { if (!knownApps.has(a.bundleId)) tileFor(a.bundleId).classList.add('enter'); });
      }
      knownApps = new Set(w.apps.map((a) => a.bundleId));
    }
    const openApp = ctx.sheet.openApp();
    grid.querySelectorAll('.tile').forEach((tile) => {
      const app = findApp(tile.dataset.app);
      tile.classList.toggle('focused', app.windows.some((x) => x.id === w.focusedId));
      tile.classList.toggle('source', app.bundleId === openApp); // it has become the sheet
    });
    placeLamp();
    if (openApp) {
      if (findApp(openApp)) ctx.sheet.refresh();
      else ctx.sheet.close();
    }
  }

  // The focus lamp glides to the focused tile instead of being redrawn on it. Layout offsets
  // (not screen rects) keep it right while the grid is scaled back behind the sheet.
  function placeLamp() {
    const tile = grid.querySelector('.tile.focused');
    if (!tile) { lamp.classList.remove('lit'); return; }
    const first = !lamp.classList.contains('lit');
    lamp.classList.toggle('instant', first);
    lamp.style.width = tile.offsetWidth + 'px';
    lamp.style.height = tile.offsetHeight + 'px';
    lamp.style.transform = `translate(${grid.offsetLeft + tile.offsetLeft}px, ${grid.offsetTop + tile.offsetTop}px)`;
    if (first) void lamp.offsetWidth; // apply position before fading in
    lamp.classList.add('lit');
  }

  // Tiles move when the music column slides in/out or the web font arrives; follow them.
  const lampWatch = new ResizeObserver(() => placeLamp());
  lampWatch.observe(grid);
  lampWatch.observe(clock); // the clock sits above the grid; its height moves the tiles
  new ResizeObserver(() => fitTiles()).observe(scroller);

  // Like the Dock: the icon you picked does a little hop.
  const hop = (tile) => replay(tile, 'hop');

  function focusWindow(id, origin) {
    const previous = store.windows.focusedId;
    store.windows.focusedId = id; // optimistic
    render();
    ctx.send('windows.focus', { id }).then((r) => {
      if (r.ok) return;
      if (store.windows && store.windows.focusedId === id) {
        store.windows.focusedId = previous;
        render();
      }
      shake(origin());
    });
  }

  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile || !store.windows) return;
    const app = findApp(tile.dataset.app);
    if (!app) return;
    const action = tileAction(app);
    if (action === 'focus') {
      hop(tile);
      focusWindow(app.windows[0].id, () => tileFor(app.bundleId));
    } else if (action === 'sheet') {
      ctx.sheet.open(app.bundleId);
    } else {
      launchApp(app.bundleId);
    }
  });

  ctx.on('windows', render);
  ctx.on('badges', render);

  return { render, fitTiles, focusWindow, findApp, tileFor, iconUrl, windowFlag, hop };
}
