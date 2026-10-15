// The Authenticator page: the Mac's 2FA accounts as tiles. A tap asks the Mac to put the code on
// its clipboard. The tablet never sees a code or a secret, only the names.
import { esc, shake } from './util.js';
import { PAGE } from './pages.js';

const CLEAR_MS = 30000; // the Mac clears the clipboard this long after a copy
const COPIED_MS = 1500;
const TICK_MS = 250;

const byText = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export function sortAccounts(list) {
  return [...list].sort((a, b) => {
    if (!a.issuer !== !b.issuer) return a.issuer ? -1 : 1; // no service name: last
    return byText(a.issuer, b.issuer) || byText(a.name, b.name);
  });
}

export function badgeHue(issuer) {
  let h = 0;
  for (const c of issuer.toLowerCase()) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

// Seconds left in the current code's period.
export function periodLeft(nowMs, period) {
  const ms = period * 1000;
  return (ms - (nowMs % ms)) / 1000;
}

// The note on a copied tile. startedMs: when this tablet saw the copy land.
export function copyLabel(copied, startedMs, nowMs) {
  if (!copied) return null;
  if (copied.status === 'waiting') return 'Next code…';
  const elapsed = nowMs - startedMs;
  if (elapsed < COPIED_MS) return 'Copied';
  if (elapsed < CLEAR_MS) return `Clears in ${Math.ceil((CLEAR_MS - elapsed) / 1000)} s`;
  return null;
}

export function initAuth(ctx) {
  const listEl = ctx.$('auth-list');
  const emptyEl = ctx.$('auth-empty');
  const barEl = ctx.$('auth-bar').firstElementChild;
  const seen = { seq: 0, status: null, at: 0 }; // when the latest copy landed, by this tablet's clock

  function render() {
    const state = ctx.store.authenticator || { accounts: [] };
    const accounts = sortAccounts(state.accounts || []);
    emptyEl.hidden = accounts.length > 0;
    listEl.innerHTML = accounts.map((a) => {
      const title = a.issuer || a.name;
      const sub = a.issuer ? a.name : '';
      return `<button class="acct" data-id="${esc(a.id)}" data-period="${Number(a.period) || 30}">
        <span class="acct-badge" style="--hue:${badgeHue(title)}">${esc(title.charAt(0).toUpperCase() || '?')}</span>
        <span class="acct-text"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>
        <span class="acct-note"></span>
        ${a.period !== 30 ? '<svg class="acct-ring" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/></svg>' : ''}
      </button>`;
    }).join('');
    tick();
  }

  function onState() {
    const c = (ctx.store.authenticator || {}).copied;
    if (c && (c.seq !== seen.seq || c.status !== seen.status)) {
      Object.assign(seen, { seq: c.seq, status: c.status, at: Date.now() });
    }
    render();
  }

  // The countdown bar, the rings and the copy notes; only while the page is on screen.
  function tick() {
    if (ctx.pages && ctx.pages.current() !== PAGE.auth) return;
    const now = Date.now();
    barEl.style.transform = `scaleX(${periodLeft(now, 30) / 30})`;
    const copied = (ctx.store.authenticator || {}).copied;
    listEl.querySelectorAll('.acct').forEach((el) => {
      const period = Number(el.dataset.period);
      const ring = el.querySelector('.acct-ring circle');
      if (ring) ring.style.strokeDashoffset = String(50.27 * (1 - periodLeft(now, period) / period));
      const mine = copied && copied.id === el.dataset.id ? copied : null;
      const label = copyLabel(mine, seen.at, now);
      el.classList.toggle('copied', !!label);
      const note = el.querySelector('.acct-note');
      if (note.textContent !== (label || '')) note.textContent = label || '';
    });
  }

  listEl.addEventListener('click', (e) => {
    const el = e.target.closest('.acct');
    if (!el) return;
    ctx.send('authenticator.copy', { id: el.dataset.id }).then((r) => {
      if (!r.ok) shake(listEl.querySelector(`.acct[data-id="${CSS.escape(el.dataset.id)}"]`) || el);
    });
  });

  ctx.on('authenticator', onState);
  setInterval(tick, TICK_MS);
  render();
  return { show: render };
}
