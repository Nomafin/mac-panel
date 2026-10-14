// The second layer: an app's windows as cards, in a sheet that grows out of the app's tile.
import { esc } from './util.js';
import { allWindowIds } from './shots.js';

const CLOSE_MS = 620;
const HOP_DELAY_MS = 560; // the tile hops as the sheet folds back into it

export function initSheet(ctx) {
  const { $, store } = ctx;
  const layer = $('layer');
  const sheet = $('sheet');
  const cards = $('cards');
  const sheetIcon = $('sheet-icon');
  const sheetTitle = $('sheet-title');
  const sheetSub = $('sheet-sub');
  const scroller = $('windows');
  const grid = $('grid');
  let openApp = null; // bundleId shown in the sheet, if any
  let closeTimer = null;

  // clip-path inset that crops the sheet down to exactly the tile's rectangle
  function insetFor(tile) {
    const s = sheet.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    return `inset(${t.top - s.top}px ${s.right - t.right}px ${s.bottom - t.bottom}px ${t.left - s.left}px round 18px)`;
  }

  // Moves the sheet's icon so it starts (or ends) exactly over the tile's icon.
  function iconOffset(tile) {
    const from = tile.querySelector('.icon').getBoundingClientRect();
    const to = sheetIcon.getBoundingClientRect();
    const scale = from.width / to.width;
    return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale})`;
  }

  function renderCards(animate) {
    const app = ctx.windows.findApp(openApp);
    const focusedId = store.windows.focusedId;
    const known = new Set([...cards.querySelectorAll('.card')].map((c) => Number(c.dataset.id)));
    sheetTitle.textContent = app.name;
    sheetSub.textContent = app.windows.length === 1 ? '1 window' : `${app.windows.length} windows`;
    cards.innerHTML = app.windows.map((win, i) => {
      const cls = ['card'];
      if (win.id === focusedId) cls.push('focused');
      if (win.minimized) cls.push('minimized');
      if (animate || !known.has(win.id)) cls.push('fan');
      const flag = ctx.windows.windowFlag(app, win);
      // Previews (shared cache, needs Screen Recording on the Mac) fill a fixed frame, so cards don't jump.
      const url = ctx.shots.url(win.id);
      const thumb = capturable(win) ? `<span class="thumb-box">${url ? `<img class="thumb" src="${url}" alt="">` : ''}</span>` : '';
      return `<button class="${cls.join(' ')}" data-id="${win.id}" style="--i:${i}">
          ${thumb}
          <span class="ct">${esc(win.title)}</span>
          ${flag ? `<span class="flag">${flag}</span>` : ''}
        </button>`;
    }).join('');
  }

  // Minimized windows and windows on other Spaces can't be captured.
  const capturable = (win) => !ctx.MOCK && !win.minimized && !win.otherSpace;

  function fadeInThumb(id, url) {
    const box = cards.querySelector(`.card[data-id="${id}"] .thumb-box`);
    if (!box) return;
    const old = box.querySelector('.thumb');
    const img = new Image();
    img.src = url;
    img.className = 'thumb fresh';
    img.alt = '';
    box.appendChild(img); // on top of the old one
    img.addEventListener('animationend', () => {
      img.classList.remove('fresh');
      if (old) old.remove();
    }, { once: true });
  }

  function fitSheet() {
    const r = scroller.getBoundingClientRect();
    Object.assign(sheet.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', maxHeight: r.height + 'px' });
  }

  function open(bundleId) {
    const tile = ctx.windows.tileFor(bundleId);
    if (!tile) return;
    clearTimeout(closeTimer);
    openApp = bundleId;
    sheetIcon.src = ctx.windows.iconUrl(bundleId);
    layer.hidden = false;
    layer.classList.remove('open', 'closing');
    fitSheet();
    renderCards(true);
    // Fresh previews once per opening; redraws while open reuse them instead of capturing again.
    ctx.shots.prune(allWindowIds(store));
    ctx.shots.refresh(ctx.windows.findApp(bundleId).windows.filter(capturable).map((w) => w.id), fadeInThumb);
    // Start as the tile, then grow: clip-path and icon jump to the tile with no transition…
    sheet.classList.add('no-anim');
    sheet.style.clipPath = insetFor(tile);
    sheetIcon.style.transform = iconOffset(tile);
    void sheet.offsetWidth;
    // …and animate to the full sheet.
    sheet.classList.remove('no-anim');
    sheet.style.clipPath = 'inset(0px 0px 0px 0px round 26px)';
    sheetIcon.style.transform = '';
    layer.classList.add('open');
    document.body.classList.add('layer-open');
    tile.classList.add('source');
  }

  function close() {
    if (!openApp) return;
    const tile = ctx.windows.tileFor(openApp);
    openApp = null;
    layer.classList.remove('open');
    layer.classList.add('closing');
    document.body.classList.remove('layer-open');
    if (tile) {
      sheet.style.clipPath = insetFor(tile);
      sheetIcon.style.transform = iconOffset(tile);
    }
    closeTimer = setTimeout(() => {
      layer.hidden = true;
      layer.classList.remove('closing');
      grid.querySelectorAll('.tile.source').forEach((t) => t.classList.remove('source'));
    }, CLOSE_MS);
  }

  cards.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = Number(card.dataset.id);
    const app = openApp;
    ctx.windows.focusWindow(id, () => ctx.windows.tileFor(app));
    close();
    setTimeout(() => ctx.windows.hop(ctx.windows.tileFor(app)), HOP_DELAY_MS);
  });
  $('layer-backdrop').addEventListener('click', close);
  $('sheet-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', () => { if (openApp) fitSheet(); });

  return { open, close, isOpen: () => !!openApp, openApp: () => openApp, refresh: () => renderCards(false) };
}
