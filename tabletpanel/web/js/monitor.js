// The external monitor's input switch (tabletpanel/monitor.lua), beside the clock. A tap shows the
// new input at once; if the monitor hasn't confirmed it after a few seconds, the button shakes.
import { esc, shake } from './util.js';

const CONFIRM_MS = 5000;

// The input to highlight: the one just tapped while it's being switched, else the monitor's.
export function highlighted(state, pending, now) {
  if (pending && now < pending.until) return pending.code;
  return state && state.current != null ? state.current : null;
}

export function switchFailed(state, pending, now) {
  return !!pending && now >= pending.until && (!state || state.current !== pending.code);
}

export function initMonitor(ctx) {
  const el = ctx.$('monitor');
  let pending = null;
  let html = '';

  function render() {
    const m = ctx.store.monitor;
    const show = !!(m && m.available && m.inputs && m.inputs.length > 1);
    el.hidden = !show;
    if (!show) return;
    const next = m.inputs.map((i) => `<button class="source" data-code="${Number(i.code)}">${esc(i.label)}</button>`).join('');
    if (next !== html) { html = next; el.innerHTML = next; }
    const on = highlighted(m, pending, Date.now());
    for (const b of el.children) {
      const active = Number(b.dataset.code) === on;
      b.classList.toggle('on', active);
      b.setAttribute('aria-pressed', String(active));
    }
  }

  function settle() {
    const m = ctx.store.monitor;
    if (pending && m && m.current === pending.code) pending = null;
    render();
  }

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.source');
    if (!btn) return;
    const code = Number(btn.dataset.code);
    const mine = { code, until: Date.now() + CONFIRM_MS };
    pending = mine;
    render();
    const fail = () => {
      if (pending !== mine) return;
      pending = null;
      render();
      shake(btn);
    };
    ctx.send('monitor.set', { code }).then((r) => { if (!r.ok) fail(); });
    setTimeout(() => { if (switchFailed(ctx.store.monitor, mine, Date.now())) fail(); else settle(); }, CONFIRM_MS);
  });

  ctx.on('monitor', settle);
}
