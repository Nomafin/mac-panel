// The WebSocket to the Mac: connect, reconnect, requests with replies, and the state store.
// Each Mac module's state lands in ctx.store[module] and is announced with ctx.emit(module).
import { MockSocket } from './mock.js';

const PING_MS = 2000;
const CONNECT_TIMEOUT_MS = 3000; // an unanswered connect (Mac asleep) can otherwise hang ~2 min
const STALE_MS = 7000; // no message for this long => socket is dead (e.g. after tablet sleep)
const REQUEST_TIMEOUT_MS = 4000;
const OVERLAY_DELAY_MS = 2000;

export function backoff(attempt) {
  return Math.min(500 * Math.pow(2, attempt), 5000);
}

// Hammerspoon pushes only to the newest WebSocket client. A push client is always up to
// date, so ping replies that keep carrying missed updates mean another client took over.
export function makeDemotionDetector(threshold) {
  let streak = 0;
  return function (missedCount) {
    streak = missedCount > 0 ? streak + 1 : 0;
    if (streak < threshold) return false;
    streak = 0;
    return true;
  };
}

export function initConnection(ctx) {
  const overlay = ctx.$('overlay');
  const dot = ctx.$('dot');
  const conn = { ws: null, attempt: 0, nextId: 1, pending: new Map(), lastRx: 0, versions: {} };
  let overlayTimer = null;

  function connect() {
    const ws = ctx.MOCK ? new MockSocket(ctx.mockVariant) : new WebSocket('ws://' + location.host + '/ws');
    conn.ws = ws;
    const connectTimer = setTimeout(() => { if (ws.readyState === 0) reconnect(ws); }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(connectTimer);
      conn.attempt = 0;
      conn.versions = {}; // the Mac may have restarted and reset its version counters
      conn.lastRx = Date.now();
      setConnected(true);
      send('hello', { ua: navigator.userAgent });
    };
    ws.onmessage = (ev) => {
      conn.lastRx = Date.now();
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      handle(msg);
    };
    ws.onclose = () => reconnect(ws);
    ws.onerror = () => reconnect(ws);
  }

  function reconnect(ws) {
    if (conn.ws !== ws) return;
    conn.ws = null;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch (_) { /* already closed */ }
    setConnected(false);
    setTimeout(connect, backoff(conn.attempt++));
  }

  function setConnected(on) {
    dot.classList.toggle('on', on);
    clearTimeout(overlayTimer);
    if (on) overlay.hidden = true;
    else overlayTimer = setTimeout(() => { overlay.hidden = false; }, OVERLAY_DELAY_MS);
    ctx.connected = on;
    ctx.emit('connection');
  }

  function send(cmd, args) {
    const ws = conn.ws;
    if (!ws || ws.readyState !== 1) return Promise.resolve({ ok: false, error: 'offline' });
    const id = conn.nextId++;
    const msg = { id, cmd };
    if (args) msg.args = args;
    if (cmd === 'ping') msg.versions = conn.versions;
    ws.send(JSON.stringify(msg));
    return new Promise((resolve) => {
      conn.pending.set(id, resolve);
      setTimeout(() => { if (conn.pending.delete(id)) resolve({ ok: false, error: 'timeout' }); }, REQUEST_TIMEOUT_MS);
    });
  }

  function handle(msg) {
    if (msg.type === 'state') {
      applyState(msg);
    } else if (msg.type === 'reply') {
      (msg.updates || []).forEach(applyState);
      const resolve = conn.pending.get(msg.id);
      if (resolve) {
        conn.pending.delete(msg.id);
        resolve(msg);
      }
    }
  }

  function applyState(msg) {
    conn.versions[msg.module] = msg.v;
    ctx.store[msg.module] = msg.data;
    if (msg.module === 'spotify') ctx.store.spotifyAt = Date.now();
    ctx.emit(msg.module);
  }

  const missedPushes = makeDemotionDetector(2);
  setInterval(() => {
    const ws = conn.ws;
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - conn.lastRx > STALE_MS) { reconnect(ws); return; }
    send('ping').then((r) => {
      // Reconnecting makes this tablet the newest client, so it gets pushes again.
      if (r.ok && missedPushes((r.updates || []).length) && conn.ws === ws) reconnect(ws);
    });
  }, PING_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && conn.ws && conn.ws.readyState === 1) send('ping');
  });

  return { connect, send, socket: () => conn.ws };
}
