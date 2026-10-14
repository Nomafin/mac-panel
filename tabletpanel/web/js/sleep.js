// Going dark while the Mac isn't in use, and keeping the AMOLED screen from burning in.
const SLEEP_AFTER_DISCONNECT_MS = 30000; // a fully sleeping Mac can't say so; silence means it's gone
const PEEK_MS = 60000;
const SHIFT_MS = 180000; // burn-in: nudge the whole UI every 3 minutes
const SHIFTS = [[0, 0], [1, 1], [2, 0], [1, -1], [0, -2], [-1, -1], [-2, 0], [-1, 1]];

// Whether the tablet screen should be dark. macAwake is undefined until the Mac reports it.
export function shouldSleep({ macAwake, connected, disconnectedSince, peekUntil, now }) {
  if (now < peekUntil) return false;
  if (connected) return macAwake === false;
  return disconnectedSince != null && now - disconnectedSince >= SLEEP_AFTER_DISCONNECT_MS;
}

export function initSleep(ctx) {
  const state = { disconnectedSince: Date.now(), peekUntil: 0, asleep: false };

  function update() {
    const asleep = shouldSleep({
      macAwake: ctx.store.display ? ctx.store.display.awake : undefined,
      connected: ctx.connected === true,
      disconnectedSince: state.disconnectedSince,
      peekUntil: state.peekUntil,
      now: Date.now(),
    });
    if (asleep === state.asleep) return;
    state.asleep = asleep;
    document.body.classList.toggle('asleep', asleep);
    if (window.TabletApp) {
      try { window.TabletApp.setScreen(!asleep); } catch (_) { /* older app build */ }
    }
  }

  // A tap on the dark screen shows the panel for a minute.
  function peek() {
    state.peekUntil = Date.now() + PEEK_MS;
    update();
  }

  ctx.on('connection', () => {
    state.disconnectedSince = ctx.connected ? null : (state.disconnectedSince ?? Date.now());
    update();
  });
  ctx.on('display', update);
  ctx.$('sleep').addEventListener('pointerdown', (e) => { e.preventDefault(); peek(); });
  setInterval(update, 1000);

  const shell = ctx.$('shell');
  let shiftIndex = 0;
  setInterval(() => {
    shiftIndex = (shiftIndex + 1) % SHIFTS.length;
    const [x, y] = SHIFTS[shiftIndex];
    shell.style.translate = `${x}px ${y}px`;
  }, SHIFT_MS);

  return { peek, isAsleep: () => state.asleep };
}
