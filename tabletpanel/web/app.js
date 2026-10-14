'use strict';

/* ---------- Pure helpers (unit-tested in tests/web.test.js) ---------- */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const s = total % 60;
  return Math.floor(total / 60) + ':' + (s < 10 ? '0' : '') + s;
}

// Position now, given the state received at `receivedAt` (client clock; Mac and tablet clocks differ).
function estimatePosition(sp, receivedAt, now) {
  if (!sp || !sp.track) return 0;
  const base = sp.positionMs || 0;
  if (sp.state !== 'playing') return base;
  return Math.min(base + Math.max(0, now - receivedAt), sp.track.durationMs || Infinity);
}

function seekFraction(clientX, rect) {
  if (!rect.width) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

function backoff(attempt) {
  return Math.min(500 * Math.pow(2, attempt), 5000);
}

// Calls fn at most once per `ms`; the last call in a burst always runs (trailing).
function makeThrottle(fn, ms, clock) {
  clock = clock || { now: () => Date.now(), setTimeout: (f, d) => setTimeout(f, d) };
  let last = -Infinity;
  let scheduled = false;
  let pendingArgs = null;
  return function (...args) {
    const wait = last + ms - clock.now();
    if (wait <= 0 && !scheduled) {
      last = clock.now();
      fn(...args);
      return;
    }
    pendingArgs = args;
    if (!scheduled) {
      scheduled = true;
      clock.setTimeout(() => {
        scheduled = false;
        last = clock.now();
        const a = pendingArgs;
        pendingArgs = null;
        fn(...a);
      }, Math.max(0, wait));
    }
  };
}

// Hammerspoon pushes only to the newest WebSocket client. A push client is always up to
// date, so ping replies that keep carrying missed updates mean another client took over.
function makeDemotionDetector(threshold) {
  let streak = 0;
  return function (missedCount) {
    streak = missedCount > 0 ? streak + 1 : 0;
    if (streak < threshold) return false;
    streak = 0;
    return true;
  };
}

// [hue 0–360, saturation 0–1, lightness 0–1]
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

// The album's accent: the hue family with the most saturated mid-tone weight, lifted so it
// reads on black. Returns null for greyscale art.
function pickAccent(rgba) {
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, x: 0, y: 0, s: 0 }));
  const pixelCount = rgba.length / 4;
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const [hue, sat, light] = rgbToHsl(rgba[i], rgba[i + 1], rgba[i + 2]);
    const w = sat * (1 - Math.abs(light - 0.5) * 1.6);
    if (w <= 0.05) continue;
    const b = buckets[Math.floor(hue / 30) % 12];
    const rad = (hue * Math.PI) / 180;
    b.w += w; b.x += Math.cos(rad) * w; b.y += Math.sin(rad) * w; b.s += sat * w;
    total += w;
  }
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w === 0 || total / pixelCount < 0.02) return null;
  let hue = (Math.atan2(best.y, best.x) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { h: hue, s: Math.min(0.85, Math.max(0.45, best.s / best.w)), l: 0.68 };
}

function accentCss(a) {
  return `hsl(${Math.round(a.h)} ${Math.round(a.s * 100)}% ${Math.round(a.l * 100)}%)`;
}

const SLEEP_AFTER_DISCONNECT_MS = 30000; // a fully sleeping Mac can't say so; silence means it's gone
const PEEK_MS = 60000;

// Whether the tablet screen should be dark. macAwake is undefined until the Mac reports it.
function shouldSleep({ macAwake, connected, disconnectedSince, peekUntil, now }) {
  if (now < peekUntil) return false;
  if (connected) return macAwake === false;
  return disconnectedSince != null && now - disconnectedSince >= SLEEP_AFTER_DISCONNECT_MS;
}

// What a hardware key does. Volume keys never wake the screen: the cover can hold them down.
function keyAction(key, { layerOpen, asleep }) {
  if (asleep) return key === 'back' || key === 'home' || key === 'recents' ? 'peek' : null;
  if (key === 'back' && layerOpen) return 'closeLayer';
  return null;
}

const TREND_WINDOW_MS = 30 * 60000;
const TREND_MIN_SPAN_MS = 10 * 60000;

const pad2 = (n) => String(n).padStart(2, '0');

function formatClock(d) {
  return {
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    date: `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`,
  };
}

// Whether the battery level really rose or fell recently. Android's "charging" can't tell a charger
// that barely keeps up from one that charges. samples: [{t, level}], oldest first.
function batteryTrend(samples, now) {
  const recent = samples.filter((s) => now - s.t <= TREND_WINDOW_MS);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (last.t - first.t < TREND_MIN_SPAN_MS) return null;
  if (last.level > first.level) return 'up';
  if (last.level < first.level) return 'down';
  return 'flat';
}

function batteryTone({ level, plugged }, trend) {
  if (plugged && trend === 'down') return 'warn';
  if (!plugged && level < 20) return 'low';
  return '';
}

/* ---------- Mock mode (?mock, ?mock=idle, ?mock=nospotify) ---------- */

function mockArt(h1, h2) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},70%,55%)"/><stop offset="1" stop-color="hsl(${h2},60%,18%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="190" cy="120" r="70" fill="hsl(${h1},80%,72%)" opacity=".55"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const MOCK_TRACKS = [
  { id: 'spotify:track:mock1', name: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", durationMs: 243000, artworkUrl: mockArt(320, 250) },
  { id: 'spotify:track:mock2', name: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine', durationMs: 330000, artworkUrl: mockArt(170, 210) },
];

function mockState(variant) {
  const spotify = variant === 'nospotify' ? { running: false }
    : variant === 'idle' ? { running: true, state: 'stopped' }
    : { running: true, state: 'playing', track: MOCK_TRACKS[0], positionMs: 61000, volume: 65, shuffle: false, repeat: true };
  return {
    windows: {
      focusedId: 11,
      apps: [
        { bundleId: 'com.apple.Safari', name: 'Safari', hidden: false, windows: [
          { id: 11, title: 'GitHub – Pull requests', minimized: false, otherSpace: false },
          { id: 12, title: 'Hammerspoon docs: hs.window.filter', minimized: false, otherSpace: false },
          { id: 13, title: 'A very long window title that should be clamped to two lines on the tile, really', minimized: true, otherSpace: false },
        ] },
        { bundleId: 'com.microsoft.VSCode', name: 'Code', hidden: false, windows: [
          { id: 21, title: 'app.js — Control', minimized: false, otherSpace: false },
          { id: 22, title: 'init.lua — Control', minimized: false, otherSpace: true },
        ] },
        { bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack', hidden: true, windows: [
          { id: 31, title: 'Slack — #general <b>&amp;</b> 😀', minimized: false, otherSpace: false },
        ] },
        { bundleId: 'com.apple.Terminal', name: 'Terminal', hidden: false, windows: [
          { id: 41, title: '~ — zsh', minimized: false, otherSpace: false },
        ] },
      ],
    },
    spotify,
    display: { awake: true },
  };
}

function mockIcon(bundleId) {
  let hue = 0;
  for (const c of bundleId) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  const letter = bundleId.split('.').pop()[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="hsl(${hue},55%,45%)"/><text x="24" y="32" font-size="24" font-family="sans-serif" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Stands in for WebSocket: same events and message shapes as the Mac side.
class MockSocket {
  constructor(variant) {
    this.readyState = 0;
    this.state = mockState(variant);
    this.v = 1;
    this.trackIndex = 0;
    setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 50);
  }

  stateMsg(mod) {
    return { type: 'state', module: mod, v: this.v, data: JSON.parse(JSON.stringify(this.state[mod])) };
  }

  send(raw) {
    const msg = JSON.parse(raw);
    const args = msg.args || {};
    const [mod, action] = msg.cmd.split('.');
    const sp = this.state.spotify;
    const reply = { type: 'reply', id: msg.id, ok: true, updates: [] };
    if (msg.cmd === 'hello') {
      reply.updates = Object.keys(this.state).map((m) => this.stateMsg(m));
    } else if (msg.cmd === 'windows.focus') {
      const exists = this.state.windows.apps.some((a) => a.windows.some((w) => w.id === args.id));
      if (exists) this.state.windows.focusedId = args.id;
      else Object.assign(reply, { ok: false, error: 'not_found' });
    } else if (mod === 'spotify' && sp.running) {
      if (action === 'playpause') sp.state = sp.state === 'playing' ? 'paused' : 'playing';
      else if (action === 'seek') sp.positionMs = args.ms;
      else if (action === 'volume') sp.volume = args.value;
      else if (action === 'shuffle') sp.shuffle = !sp.shuffle;
      else if (action === 'repeat') sp.repeat = !sp.repeat;
      else if (action === 'next' || action === 'previous') {
        this.trackIndex = (this.trackIndex + 1) % MOCK_TRACKS.length;
        Object.assign(sp, { track: MOCK_TRACKS[this.trackIndex], positionMs: 0, state: 'playing' });
      }
    }
    if (mod in this.state) {
      this.v += 1;
      reply.updates = [this.stateMsg(mod)];
    }
    setTimeout(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify(reply) }); }, 30);
  }

  // Dev aid: ?mock pages toggle the Mac's awake state with the "d" key.
  toggleDisplay() {
    this.state.display.awake = !this.state.display.awake;
    this.v += 1;
    if (this.onmessage) this.onmessage({ data: JSON.stringify(this.stateMsg('display')) });
  }

  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose();
  }
}

/* ---------- App (browser only) ---------- */

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.3"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><rect x="5" y="6" width="2.4" height="12" rx="1"/><path d="M19 7.1v9.8a.9.9 0 0 1-1.4.75l-7.6-4.9a.9.9 0 0 1 0-1.5l7.6-4.9A.9.9 0 0 1 19 7.1z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><rect x="16.6" y="6" width="2.4" height="12" rx="1"/><path d="M5 7.1v9.8a.9.9 0 0 0 1.4.75l7.6-4.9a.9.9 0 0 0 0-1.5L6.4 6.35A.9.9 0 0 0 5 7.1z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6C14.3 16 15.5 17 17.5 17H21"/><path d="M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M14.3 8.4C15.1 7.5 16.1 7 17.5 7H21"/><path d="m18.5 4.5 2.5 2.5-2.5 2.5M18.5 14.5l2.5 2.5-2.5 2.5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19"/><path d="m16 3 3 3-3 3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5"/><path d="m8 21-3-3 3-3"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.3 3.6a.8.8 0 0 0 1.3-.6V5.5a.8.8 0 0 0-1.3-.6L8 8.5H5a1 1 0 0 0-1 1z"/><path d="M16.5 8.8a4.5 4.5 0 0 1 0 6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

const PING_MS = 2000;
const CONNECT_TIMEOUT_MS = 3000; // an unanswered connect (Mac asleep) can otherwise hang ~2 min
const STALE_MS = 7000; // no message for this long => socket is dead (e.g. after tablet sleep)
const SHIFT_MS = 180000; // AMOLED burn-in: nudge the whole UI every 3 minutes
const SHIFTS = [[0, 0], [1, 1], [2, 0], [1, -1], [0, -2], [-1, -1], [-2, 0], [-1, 1]];
const DEFAULT_ACCENT = '#9db4ff';

function boot() {
  const params = new URLSearchParams(location.search);
  const MOCK = params.has('mock');
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const shell = $('shell');
  const scroller = $('windows');
  const stage = $('stage');
  const grid = $('grid');
  const lamp = $('lamp');
  const spEl = $('spotify');
  const glows = [$('glow-a'), $('glow-b')];
  const overlay = $('overlay');
  const dot = $('dot');

  const store = { windows: null, spotify: null, display: null, spotifyAt: 0 };
  const conn = { ws: null, attempt: 0, nextId: 1, pending: new Map(), lastRx: 0, versions: {} };
  let overlayTimer = null;

  /* ----- connection ----- */

  function connect() {
    const ws = MOCK ? new MockSocket(params.get('mock')) : new WebSocket('ws://' + location.host + '/ws');
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
    else overlayTimer = setTimeout(() => { overlay.hidden = false; }, 2000);
    sleep.connected = on;
    sleep.disconnectedSince = on ? null : (sleep.disconnectedSince ?? Date.now());
    updateSleep();
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
      setTimeout(() => { if (conn.pending.delete(id)) resolve({ ok: false, error: 'timeout' }); }, 4000);
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

  const renderers = { windows: renderWindows, spotify: renderSpotify };

  function applyState(msg) {
    conn.versions[msg.module] = msg.v;
    store[msg.module] = msg.data;
    if (msg.module === 'spotify') store.spotifyAt = Date.now();
    const render = renderers[msg.module];
    if (render) render();
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

  /* ----- windows ----- */

  // One tile per app. A single-window app focuses on tap; an app with several windows
  // opens a second layer (the sheet) that grows out of its tile.
  let knownApps = null; // apps rendered last time; new ones get an entrance
  let openApp = null; // bundleId shown in the sheet, if any

  function iconUrl(bundleId) {
    return MOCK ? mockIcon(bundleId) : 'icon/' + encodeURIComponent(bundleId) + '.png';
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

  const SPACE_MARK = '<svg class="space-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="12" height="12" rx="2.5"/><path d="M9 4h9.5A2.5 2.5 0 0 1 21 6.5V15"/></svg>';

  // Tiles depend only on the window data; focus, entrances and the open sheet are classes
  // applied afterwards, so a focus change never rebuilds the grid (and never cuts an animation).
  function tileHtml(app) {
    const single = app.windows.length === 1;
    const win = app.windows[0];
    const cls = ['tile'];
    if (app.hidden) cls.push('app-hidden');
    if (single && win.minimized) cls.push('minimized');
    if (!single) cls.push('stack');
    const label = single ? `${app.name}: ${win.title}${windowFlag(app, win) ? ' (' + windowFlag(app, win) + ')' : ''}`
      : `${app.name}, ${app.windows.length} windows`;
    return `<button class="${cls.join(' ')}" data-app="${esc(app.bundleId)}"${single ? ` data-id="${win.id}"` : ''} aria-label="${esc(label)}" title="${esc(label)}">
        <img class="icon" src="${esc(iconUrl(app.bundleId))}" alt="">
        ${single ? (win.otherSpace ? SPACE_MARK : '') : `<span class="n">${app.windows.length}</span>`}
      </button>`;
  }

  let gridHtml = '';

  function renderWindows() {
    const w = store.windows;
    if (!w || !w.apps || !w.apps.length) {
      gridHtml = '';
      grid.innerHTML = '<p class="empty">No open windows on your Mac.</p>';
      placeLamp();
      if (openApp) closeLayer();
      return;
    }
    const html = w.apps.map(tileHtml).join('');
    if (html !== gridHtml) {
      gridHtml = html;
      grid.innerHTML = html;
      if (knownApps) {
        w.apps.forEach((a) => { if (!knownApps.has(a.bundleId)) tileFor(a.bundleId).classList.add('enter'); });
      }
      knownApps = new Set(w.apps.map((a) => a.bundleId));
    }
    grid.querySelectorAll('.tile').forEach((tile) => {
      const app = findApp(tile.dataset.app);
      tile.classList.toggle('focused', app.windows.some((x) => x.id === w.focusedId));
      tile.classList.toggle('source', app.bundleId === openApp); // it has become the sheet
    });
    placeLamp();
    if (openApp) {
      if (findApp(openApp)) renderCards(false);
      else closeLayer();
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
  lampWatch.observe($('clock')); // the clock sits above the grid; its height moves the tiles

  function shake(el) {
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth; // restart the animation
    el.classList.add('shake');
  }

  // Like the Dock: the icon you picked does a little hop.
  function hop(tile) {
    if (!tile) return;
    tile.classList.remove('hop');
    void tile.offsetWidth;
    tile.classList.add('hop');
  }

  function focusWindow(id, origin) {
    const previous = store.windows.focusedId;
    store.windows.focusedId = id; // optimistic
    renderWindows();
    send('windows.focus', { id }).then((r) => {
      if (r.ok) return;
      if (store.windows && store.windows.focusedId === id) {
        store.windows.focusedId = previous;
        renderWindows();
      }
      shake(origin());
    });
  }

  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile || !store.windows) return;
    if (tile.dataset.id) {
      hop(tile);
      focusWindow(Number(tile.dataset.id), () => tileFor(tile.dataset.app));
    } else {
      openLayer(tile.dataset.app);
    }
  });

  /* ----- second layer: an app's windows ----- */

  const layer = $('layer'), sheet = $('sheet'), cards = $('cards');
  const sheetIcon = $('sheet-icon'), sheetTitle = $('sheet-title'), sheetSub = $('sheet-sub');
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
    const app = findApp(openApp);
    const focusedId = store.windows.focusedId;
    const known = new Set([...cards.querySelectorAll('.card')].map((c) => Number(c.dataset.id)));
    sheetTitle.textContent = app.name;
    sheetSub.textContent = app.windows.length === 1 ? '1 window' : `${app.windows.length} windows`;
    cards.innerHTML = app.windows.map((win, i) => {
      const cls = ['card'];
      if (win.id === focusedId) cls.push('focused');
      if (win.minimized) cls.push('minimized');
      if (animate || !known.has(win.id)) cls.push('fan');
      const flag = windowFlag(app, win);
      return `<button class="${cls.join(' ')}" data-id="${win.id}" style="--i:${i}">
          <span class="ct">${esc(win.title)}</span>
          ${flag ? `<span class="flag">${flag}</span>` : ''}
        </button>`;
    }).join('');
  }

  function fitSheet() {
    const r = scroller.getBoundingClientRect();
    Object.assign(sheet.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', maxHeight: r.height + 'px' });
  }

  function openLayer(bundleId) {
    const tile = tileFor(bundleId);
    if (!tile) return;
    clearTimeout(closeTimer);
    openApp = bundleId;
    sheetIcon.src = iconUrl(bundleId);
    layer.hidden = false;
    layer.classList.remove('open', 'closing');
    fitSheet();
    renderCards(true);
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

  function closeLayer() {
    if (!openApp) return;
    const tile = tileFor(openApp);
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
    }, 620);
  }

  cards.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = Number(card.dataset.id);
    const app = openApp;
    focusWindow(id, () => tileFor(app));
    closeLayer();
    setTimeout(() => hop(tileFor(app)), 560); // lands as the sheet folds back in
  });
  $('layer-backdrop').addEventListener('click', closeLayer);
  $('sheet-close').addEventListener('click', closeLayer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLayer(); });
  window.addEventListener('resize', () => { if (openApp) fitSheet(); });

  /* ----- sleep: dark while the Mac isn't in use ----- */

  const sleepEl = $('sleep');
  const sleep = { connected: false, disconnectedSince: Date.now(), peekUntil: 0, asleep: false };

  function updateSleep() {
    const asleep = shouldSleep({
      macAwake: store.display ? store.display.awake : undefined,
      connected: sleep.connected,
      disconnectedSince: sleep.disconnectedSince,
      peekUntil: sleep.peekUntil,
      now: Date.now(),
    });
    if (asleep === sleep.asleep) return;
    sleep.asleep = asleep;
    document.body.classList.toggle('asleep', asleep);
    if (window.TabletApp) {
      try { window.TabletApp.setScreen(!asleep); } catch (_) { /* older app build */ }
    }
  }

  function peek() {
    sleep.peekUntil = Date.now() + PEEK_MS;
    updateSleep();
  }

  renderers.display = updateSleep;
  sleepEl.addEventListener('pointerdown', (e) => { e.preventDefault(); peek(); });
  setInterval(updateSleep, 1000);

  /* ----- hardware keys (from the tablet app) ----- */

  window.addEventListener('tablet-key', (e) => {
    const action = keyAction(e.detail && e.detail.key, { layerOpen: !!openApp, asleep: sleep.asleep });
    if (action === 'closeLayer') closeLayer();
    else if (action === 'peek') peek();
  });
  if (MOCK) document.addEventListener('keydown', (e) => { if (e.key === 'd' && conn.ws) conn.ws.toggleDisplay(); });


  /* ----- spotify ----- */

  spEl.innerHTML = `
    <div class="sp-full">
      <div class="art-wrap" id="art-wrap">
        <img class="art" id="art-a" alt="" crossorigin="anonymous">
        <img class="art" id="art-b" alt="" crossorigin="anonymous">
      </div>
      <div class="meta" id="sp-meta">
        <div class="title" id="sp-title"></div>
        <div class="artist" id="sp-artist"></div>
        <div class="album" id="sp-album"></div>
      </div>
      <div class="scrub" id="sp-progress" aria-label="Seek">
        <div class="rail"><div class="fill" id="sp-fill"></div></div>
        <div class="times"><span id="sp-pos">0:00</span><span id="sp-dur">0:00</span></div>
      </div>
      <div class="transport">
        <button class="btn toggle" data-cmd="shuffle" id="sp-shuffle" aria-label="Shuffle">${ICONS.shuffle}</button>
        <button class="btn" data-cmd="previous" aria-label="Previous track">${ICONS.prev}</button>
        <button class="btn play" data-cmd="playpause" id="sp-play" aria-label="Play or pause">${ICONS.play}</button>
        <button class="btn" data-cmd="next" aria-label="Next track">${ICONS.next}</button>
        <button class="btn toggle" data-cmd="repeat" id="sp-repeat" aria-label="Repeat">${ICONS.repeat}</button>
      </div>
      <label class="volume">${ICONS.speaker}<input type="range" min="0" max="100" step="1" id="sp-vol" aria-label="Spotify volume"></label>
    </div>
    <div class="sp-idle">
      <p>Nothing playing in Spotify.</p>
      <button class="btn play" data-cmd="playpause" aria-label="Play">${ICONS.play}</button>
    </div>`;

  const arts = [$('art-a'), $('art-b')];
  const artWrap = $('art-wrap'), meta = $('sp-meta');
  const titleEl = $('sp-title'), artistEl = $('sp-artist'), albumEl = $('sp-album');
  const progEl = $('sp-progress'), fillEl = $('sp-fill'), posEl = $('sp-pos'), durEl = $('sp-dur');
  const playBtn = $('sp-play'), shuffleBtn = $('sp-shuffle'), repeatBtn = $('sp-repeat'), volEl = $('sp-vol');
  let volDragging = false;
  let volReleaseTimer = null;
  let shownTrackId = null;
  let shownArtUrl = null;
  let front = 0; // which art/glow layer is visible

  function setAccent(color) {
    root.style.setProperty('--accent', color || DEFAULT_ACCENT);
  }

  function sampleAccent(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 24, 24);
        const accent = pickAccent(ctx.getImageData(0, 0, 24, 24).data);
        if (url === shownArtUrl) setAccent(accent && accentCss(accent));
      } catch (_) { setAccent(null); }
    };
    img.onerror = () => setAccent(null);
    img.src = url;
  }

  // Track change: the one orchestrated moment. Art, ambient light and accent cross-fade together.
  function showArt(url) {
    if (url === shownArtUrl) return;
    shownArtUrl = url;
    const next = 1 - front;
    const img = arts[next];
    const reveal = () => {
      if (shownArtUrl !== url) return;
      arts[front].classList.remove('front');
      glows[front].classList.remove('on');
      img.classList.add('front');
      glows[next].style.backgroundImage = url ? `url("${url}")` : 'none';
      glows[next].classList.add('on');
      front = next;
    };
    if (!url) {
      img.removeAttribute('src');
      reveal();
      setAccent(null);
      return;
    }
    img.onload = reveal;
    img.onerror = reveal;
    img.src = url;
    sampleAccent(url);
  }

  function retitle(t) {
    titleEl.textContent = t.name;
    artistEl.textContent = t.artist;
    albumEl.textContent = t.album;
    meta.classList.remove('swap');
    void meta.offsetWidth; // restart the entrance
    meta.classList.add('swap');
  }

  function renderSpotify() {
    const sp = store.spotify;
    const running = !!(sp && sp.running);
    const hasTrack = running && sp.state !== 'stopped' && !!sp.track;
    shell.classList.toggle('no-spotify', !running);
    spEl.classList.toggle('idle', running && !hasTrack);
    document.body.classList.toggle('playing', hasTrack && sp.state === 'playing');
    document.body.classList.toggle('has-music', hasTrack);
    if (!hasTrack) {
      glows.forEach((g) => g.classList.remove('on'));
      shownArtUrl = null;
      shownTrackId = null;
      setAccent(null);
      return;
    }

    const t = sp.track;
    if (t.id !== shownTrackId) {
      shownTrackId = t.id;
      retitle(t);
    }
    showArt(t.artworkUrl || '');
    durEl.textContent = formatTime(t.durationMs);
    playBtn.innerHTML = sp.state === 'playing' ? ICONS.pause : ICONS.play;
    shuffleBtn.classList.toggle('on', !!sp.shuffle);
    repeatBtn.classList.toggle('on', !!sp.repeat);
    if (!volDragging) setVolume(sp.volume);
    tickProgress();
  }

  function setVolume(v) {
    volEl.value = v;
    volEl.style.setProperty('--v', v + '%');
  }

  function tickProgress() {
    const sp = store.spotify;
    if (!sp || !sp.track) return;
    const pos = estimatePosition(sp, store.spotifyAt, Date.now());
    const dur = sp.track.durationMs;
    fillEl.style.transform = `scaleX(${dur ? Math.min(1, pos / dur) : 0})`;
    posEl.textContent = formatTime(pos);
  }
  setInterval(tickProgress, 250);

  spEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    const sp = store.spotify;
    if (!btn || !sp) return;
    const cmd = btn.dataset.cmd;
    if (cmd === 'playpause' && sp.track) { // optimistic
      sp.positionMs = estimatePosition(sp, store.spotifyAt, Date.now());
      store.spotifyAt = Date.now();
      sp.state = sp.state === 'playing' ? 'paused' : 'playing';
    } else if (cmd === 'shuffle') {
      sp.shuffle = !sp.shuffle;
    } else if (cmd === 'repeat') {
      sp.repeat = !sp.repeat;
    }
    renderSpotify();
    send('spotify.' + cmd);
  });

  progEl.addEventListener('pointerdown', (e) => {
    const sp = store.spotify;
    if (!sp || !sp.track || !sp.track.durationMs) return;
    const ms = Math.round(seekFraction(e.clientX, progEl.getBoundingClientRect()) * sp.track.durationMs);
    sp.positionMs = ms;
    store.spotifyAt = Date.now();
    tickProgress();
    send('spotify.seek', { ms });
  });

  const sendVolume = makeThrottle((value) => send('spotify.volume', { value }), 100);
  volEl.addEventListener('input', () => {
    volDragging = true;
    clearTimeout(volReleaseTimer);
    setVolume(Number(volEl.value));
    sendVolume(Number(volEl.value));
  });
  volEl.addEventListener('change', () => {
    const value = Number(volEl.value);
    if (store.spotify) store.spotify.volume = value;
    send('spotify.volume', { value });
    volReleaseTimer = setTimeout(() => { volDragging = false; }, 1000);
  });

  /* ----- burn-in protection ----- */

  let shiftIndex = 0;
  setInterval(() => {
    shiftIndex = (shiftIndex + 1) % SHIFTS.length;
    const [x, y] = SHIFTS[shiftIndex];
    shell.style.translate = `${x}px ${y}px`;
  }, SHIFT_MS);

  /* ----- clock and the tablet's battery ----- */

  const timeEl = $('clock-time');
  const dateEl = $('clock-date');
  const battEl = $('battery');
  const battery = { samples: [], plugged: null };

  function tickClock() {
    const { time, date } = formatClock(new Date());
    if (timeEl.textContent !== time) timeEl.textContent = time;
    if (dateEl.textContent !== date) dateEl.textContent = date;
  }

  // Only the tablet app can read the battery; a desktop browser shows no indicator.
  function readBattery() {
    if (window.TabletApp && window.TabletApp.battery) {
      try { return JSON.parse(window.TabletApp.battery()); } catch (_) { return null; }
    }
    return MOCK ? { level: 72, plugged: true } : null;
  }

  function tickBattery() {
    const b = readBattery();
    battEl.hidden = !b;
    if (!b) return;
    const now = Date.now();
    if (b.plugged !== battery.plugged) battery.samples = []; // a new charging session, a new trend
    battery.plugged = b.plugged;
    battery.samples.push({ t: now, level: b.level });
    battery.samples = battery.samples.filter((s) => now - s.t <= TREND_WINDOW_MS);
    const trend = b.plugged ? batteryTrend(battery.samples, now) : null;
    battEl.className = ('battery ' + batteryTone(b, trend)).trim();
    battEl.style.setProperty('--level', b.level / 100);
    battEl.querySelector('.pct').textContent = b.level + '%';
    battEl.querySelector('.trend').textContent = trend === 'up' ? '▴' : trend === 'down' ? '▾' : '';
    battEl.title = !b.plugged ? 'Tablet battery' : trend === 'down' ? 'Falling on the charger'
      : trend === 'up' ? 'Charging' : 'On the charger';
  }

  tickClock();
  setInterval(tickClock, 1000);
  tickBattery();
  setInterval(tickBattery, 60000);

  console.log('tabletpanel UA:', navigator.userAgent);
  renderWindows();
  connect();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc, formatTime, estimatePosition, seekFraction, backoff, makeThrottle, makeDemotionDetector,
    rgbToHsl, pickAccent, accentCss, mockState, shouldSleep, keyAction, formatClock, batteryTrend, batteryTone,
  };
}
if (typeof document !== 'undefined') boot();
