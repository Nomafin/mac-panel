// Buttons for the Mac's front app (keyboard shortcuts defined in tabletpanel/shortcuts.lua).
import { esc, shake } from './util.js';

export function initShortcuts(ctx) {
  const actionsEl = ctx.$('actions');
  let html = '';

  function render() {
    const sc = ctx.store.shortcuts;
    const buttons = (sc && sc.buttons) || [];
    const next = buttons.map((b, i) => `<button class="action" data-index="${i + 1}">${esc(b.label)}</button>`).join('');
    if (next === html) return;
    html = next;
    actionsEl.innerHTML = next;
    actionsEl.setAttribute('aria-label', sc && sc.name ? `Shortcuts for ${sc.name}` : 'Shortcuts');
    ctx.windows.fitTiles(); // the row's height changes the room left for tiles
  }

  actionsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.action');
    const sc = ctx.store.shortcuts;
    if (!btn || !sc) return;
    // The bundle id lets the Mac refuse if the front app changed in the meantime.
    ctx.send('shortcuts.run', { bundleId: sc.bundleId, index: Number(btn.dataset.index) })
      .then((r) => { if (!r.ok) shake(btn); });
  });

  ctx.on('shortcuts', render);
}
