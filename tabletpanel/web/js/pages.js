// The three pages — panel, screens map, sketch pad — with dots, swipes and Back to switch.
const PAGES = 3;

// Page swipe: 1 = next page (finger moved left), -1 = previous, 0 = not a swipe.
export function swipeDirection(dx, dy) {
  if (Math.abs(dx) < 80 || Math.abs(dx) < 2 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

export function initPages(ctx) {
  const pagesEl = ctx.$('pages');
  const dotsEl = ctx.$('page-dots');
  let current = 0;

  function goTo(n) {
    current = Math.max(0, Math.min(PAGES - 1, n));
    pagesEl.style.transform = `translateX(${-current * 100}vw)`;
    dotsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.page) === current));
    if (current !== 0) ctx.sheet.close();
    if (current === 1) ctx.map.show();
    if (current === 2) ctx.pad.show();
  }

  dotsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) goTo(Number(b.dataset.page));
  });

  // Swipe between pages: anywhere on the panel, and on the map's empty space (dragging a window
  // moves it instead). The pad draws everywhere, so there the dots and Back switch pages.
  let swipe = null;
  let swallowClick = false;

  function canSwipeFrom(target) {
    if (current === 0) return !ctx.sheet.isOpen() && !target.closest('input, .scrub, .vol');
    if (current === 1) return !target.closest('.mwin, .map-tools');
    return false;
  }

  pagesEl.addEventListener('pointerdown', (e) => {
    swipe = canSwipeFrom(e.target) ? { x: e.clientX, y: e.clientY } : null;
  });
  pagesEl.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dir = swipeDirection(e.clientX - swipe.x, e.clientY - swipe.y);
    swipe = null;
    if (!dir) return;
    swallowClick = true; // the swipe ended over a tile; don't let it count as a tap
    setTimeout(() => { swallowClick = false; }, 0);
    goTo(current + dir);
  });
  document.addEventListener('click', (e) => {
    if (swallowClick) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  goTo(0);
  return { goTo, current: () => current };
}
