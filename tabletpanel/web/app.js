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
function keyAction(key, { layerOpen, asleep, micInUse, page = 0 }) {
  if (asleep) return key === 'back' || key === 'home' || key === 'recents' ? 'peek' : null;
  if (key === 'back' && layerOpen) return 'closeLayer';
  if (key === 'back' && page !== 0) return 'panel';
  if (key === 'recents' && micInUse) return 'toggleMic'; // a physical mute key during calls
  return null;
}

// The Mac status line: CPU, memory, and the MacBook's battery (amber when low and unplugged).
function macStats(sys) {
  if (!sys) return { parts: [], low: false };
  const parts = [];
  if (sys.cpu != null) parts.push(`CPU ${sys.cpu}%`);
  if (sys.memory != null) parts.push(`Memory ${sys.memory}%`);
  const b = sys.battery;
  if (b) parts.push(`MacBook ${b.level}%${b.onPower ? ' ⚡' : ''}`);
  return { parts, low: !!(b && !b.onPower && b.level < 20) };
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

const TILE_MAX = 136;
const TILE_MIN = 64;

// The largest tile (px) at which `count` tiles fit in width × height without scrolling.
// Gaps and the stack strips' headroom scale with the tile.
function tileSize(count, width, height) {
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
function tileAction(app) {
  if (!app.windows.length) return 'launch';
  return app.windows.length === 1 ? 'focus' : 'sheet';
}

/* ----- map page: the Mac's screens drawn to scale ----- */

// Fits the bounding box of all screens into width × height, centred.
function mapFit(screens, width, height) {
  const minX = Math.min(...screens.map((s) => s.frame.x));
  const minY = Math.min(...screens.map((s) => s.frame.y));
  const maxX = Math.max(...screens.map((s) => s.frame.x + s.frame.w));
  const maxY = Math.max(...screens.map((s) => s.frame.y + s.frame.h));
  const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
  return { scale, minX, minY, ox: (width - (maxX - minX) * scale) / 2, oy: (height - (maxY - minY) * scale) / 2 };
}

function toMap(frame, fit) {
  return {
    left: (frame.x - fit.minX) * fit.scale + fit.ox,
    top: (frame.y - fit.minY) * fit.scale + fit.oy,
    width: frame.w * fit.scale,
    height: frame.h * fit.scale,
  };
}

function fromMap(rect, fit) {
  return {
    x: Math.round((rect.left - fit.ox) / fit.scale + fit.minX),
    y: Math.round((rect.top - fit.oy) / fit.scale + fit.minY),
    w: Math.round(rect.width / fit.scale),
    h: Math.round(rect.height / fit.scale),
  };
}

// Page swipe: 1 = next page (finger moved left), -1 = previous, 0 = not a swipe.
function swipeDirection(dx, dy) {
  if (Math.abs(dx) < 80 || Math.abs(dx) < 2 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

// The drawn area plus a margin, in the pad's coordinates; null when nothing is drawn.
function strokeBounds(strokes, margin) {
  const points = strokes.flat();
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - margin;
  const y = Math.min(...ys) - margin;
  return { x, y, w: Math.max(...xs) + margin - x, h: Math.max(...ys) + margin - y };
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
      screens: [
        { id: 3, name: 'Odyssey G95NC', frame: { x: -7680, y: -285, w: 7680, h: 2130 } },
        { id: 1, name: 'Built-in Display', frame: { x: 0, y: 57, w: 2992, h: 1877 } },
      ],
      apps: [
        { bundleId: 'com.apple.finder', name: 'Finder', hidden: false, running: true, pinned: true, windows: [] },
        { bundleId: 'com.apple.Safari', name: 'Safari', hidden: false, running: true, pinned: true, windows: [
          { id: 11, title: 'GitHub – Pull requests', minimized: false, otherSpace: false, frame: { x: -7680, y: -260, w: 2560, h: 2105 }, z: 1 },
          { id: 12, title: 'Hammerspoon docs: hs.window.filter', minimized: false, otherSpace: false, frame: { x: -4600, y: 200, w: 1800, h: 1200 }, z: 3 },
          { id: 13, title: 'A very long window title that should be clamped to two lines on the tile, really', minimized: true, otherSpace: false },
        ] },
        { bundleId: 'com.apple.mail', name: 'Mail', hidden: false, running: false, pinned: true, windows: [] },
        { bundleId: 'com.microsoft.VSCode', name: 'Code', hidden: false, running: true, pinned: true, windows: [
          { id: 21, title: 'app.js — Control', minimized: false, otherSpace: false, frame: { x: -5120, y: -260, w: 2560, h: 2105 }, z: 2 },
          { id: 22, title: 'init.lua — Control', minimized: false, otherSpace: true },
        ] },
        { bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack', hidden: true, running: true, pinned: false, windows: [
          { id: 31, title: 'Slack — #general <b>&amp;</b> 😀', minimized: false, otherSpace: false },
        ] },
        { bundleId: 'com.apple.Terminal', name: 'Terminal', hidden: false, running: true, pinned: false, windows: [
          { id: 41, title: '~ — zsh', minimized: false, otherSpace: false, frame: { x: 300, y: 300, w: 1600, h: 1000 }, z: 4 },
        ] },
      ],
    },
    spotify,
    display: { awake: true },
    shortcuts: { bundleId: 'com.microsoft.VSCode', name: 'Code', buttons: [
      { label: 'Command palette' }, { label: 'Go to file' }, { label: 'Terminal' }, { label: 'Sidebar' }, { label: 'Search' }, { label: 'Save all' },
    ] },
    badges: { items: [{ bundleId: 'com.tinyspeck.slackmacgap', label: '3' }, { bundleId: 'com.apple.mail', label: '12' }] },
    mic: { available: true, name: 'MacBook Pro Microphone', inUse: true, muted: false },
    system: { cpu: 12, memory: 63, battery: { level: 84, onPower: true, charging: true } },
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
    } else if (msg.cmd === 'windows.move' || msg.cmd === 'windows.layout') {
      const win = this.state.windows.apps.flatMap((a) => a.windows).find((x) => x.id === args.id);
      if (win && msg.cmd === 'windows.move') win.frame = { x: args.x, y: args.y, w: args.w, h: args.h };
      if (win && msg.cmd === 'windows.layout') {
        const f = { 'left-third': [0, 1 / 3], 'middle-third': [1 / 3, 1 / 3], 'right-third': [2 / 3, 1 / 3], 'left-half': [0, 0.5],
          'right-half': [0.5, 0.5], center: [1 / 6, 2 / 3], max: [0, 1] }[args.preset];
        if (f) win.frame = { x: Math.round(-7680 + 7680 * f[0]), y: -285, w: Math.round(7680 * f[1]), h: 2130 };
      }
    } else if (msg.cmd === 'mic.set') {
      this.state.mic.muted = args.muted === true;
    } else if (msg.cmd === 'windows.launch') {
      // Like a real launch: the app's first window shows up a moment later.
      const app = this.state.windows.apps.find((a) => a.bundleId === args.bundleId);
      setTimeout(() => {
        if (!app || app.windows.length) return;
        const id = 900 + this.v;
        Object.assign(app, { running: true, windows: [{ id, title: app.name + ' window', minimized: false, otherSpace: false }] });
        this.state.windows.focusedId = id;
        this.v += 1;
        if (this.onmessage) this.onmessage({ data: JSON.stringify(this.stateMsg('windows')) });
      }, 1500);
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
  const macstatEl = $('macstat');
  const actionsEl = $('actions');
  const stage = $('stage');
  const grid = $('grid');
  const lamp = $('lamp');
  const spEl = $('spotify');
  const glows = [$('glow-a'), $('glow-b')];
  const overlay = $('overlay');
  const dot = $('dot');

  const store = { windows: null, spotify: null, display: null, badges: null, mic: null, system: null, shortcuts: null, spotifyAt: 0 };
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
    const action = tileAction(app);
    const win = app.windows[0];
    const cls = ['tile'];
    if (app.running === false) cls.push('off');
    if (app.hidden) cls.push('app-hidden');
    if (action === 'focus' && win.minimized) cls.push('minimized');
    if (action === 'sheet') cls.push('stack');
    if (launching.has(app.bundleId)) cls.push('launching');
    const label = action === 'focus' ? `${app.name}: ${win.title}${windowFlag(app, win) ? ' (' + windowFlag(app, win) + ')' : ''}`
      : action === 'sheet' ? `${app.name}, ${app.windows.length} windows`
      : app.running === false ? `Open ${app.name}` : `${app.name}: new window`;
    return `<button class="${cls.join(' ')}" data-app="${esc(app.bundleId)}"${action === 'focus' ? ` data-id="${win.id}"` : ''} aria-label="${esc(label)}" title="${esc(label)}">
        <img class="icon" src="${esc(iconUrl(app.bundleId))}" alt="">
        ${action === 'sheet' ? `<span class="n">${app.windows.length}</span>` : win && win.otherSpace ? SPACE_MARK : ''}
        ${badgeFor(app.bundleId) ? `<span class="badge">${esc(badgeFor(app.bundleId))}</span>` : ''}
      </button>`;
  }

  function badgeFor(bundleId) {
    const items = store.badges && store.badges.items;
    const hit = items && items.find((b) => b.bundleId === bundleId);
    return hit ? hit.label : null;
  }

  // Apps launched from the tablet bounce, like in the Dock, until a window shows up.
  const launching = new Map(); // bundleId -> timeout
  const LAUNCH_BOUNCE_MS = 10000;

  function launchApp(bundleId) {
    clearTimeout(launching.get(bundleId));
    launching.set(bundleId, setTimeout(() => { launching.delete(bundleId); renderWindows(); }, LAUNCH_BOUNCE_MS));
    renderWindows();
    send('windows.launch', { bundleId }).then((r) => {
      if (r.ok) return;
      clearTimeout(launching.get(bundleId));
      launching.delete(bundleId);
      renderWindows();
      shake(tileFor(bundleId));
    });
  }

  // The tiles shrink when there are more apps than fit, so nothing needs scrolling.
  function fitTiles() {
    const n = store.windows && store.windows.apps ? store.windows.apps.length : 0;
    const cs = getComputedStyle(scroller);
    const clock = $('clock');
    const width = scroller.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const height = scroller.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      - clock.offsetHeight - parseFloat(getComputedStyle(clock).marginBottom) - macstatEl.offsetHeight
      - actionsEl.offsetHeight;
    const size = tileSize(n, width, height) + 'px';
    if (stage.style.getPropertyValue('--tile') !== size) stage.style.setProperty('--tile', size);
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
    w.apps.forEach((a) => {
      if (a.windows.length && launching.has(a.bundleId)) { clearTimeout(launching.get(a.bundleId)); launching.delete(a.bundleId); }
    });
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
  new ResizeObserver(() => fitTiles()).observe(scroller);

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
    const app = findApp(tile.dataset.app);
    if (!app) return;
    const action = tileAction(app);
    if (action === 'focus') {
      hop(tile);
      focusWindow(app.windows[0].id, () => tileFor(app.bundleId));
    } else if (action === 'sheet') {
      openLayer(app.bundleId);
    } else {
      launchApp(app.bundleId);
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

  let thumbStamp = 0; // a fresh preview each time the sheet opens

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
      // Previews need Screen Recording permission on the Mac; without it the image just goes away.
      const thumb = !MOCK && !win.minimized && !win.otherSpace
        ? `<img class="thumb" src="/thumb/${win.id}.jpg?t=${thumbStamp}" alt="" onerror="this.remove()">` : '';
      return `<button class="${cls.join(' ')}" data-id="${win.id}" style="--i:${i}">
          ${thumb}
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
    thumbStamp = Date.now();
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
    const micInUse = !!(store.mic && store.mic.inUse);
    const action = keyAction(e.detail && e.detail.key, { layerOpen: !!openApp, asleep: sleep.asleep, micInUse, page: currentPage });
    if (action === 'closeLayer') closeLayer();
    else if (action === 'peek') peek();
    else if (action === 'toggleMic') toggleMic();
    else if (action === 'panel') goToPage(0);
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

  /* ----- microphone: a mute button while an app is using the mic ----- */

  const micEl = $('mic');

  function renderMic() {
    const m = store.mic;
    const show = !!(m && m.available && m.inUse);
    micEl.hidden = !show;
    if (!show) return;
    micEl.classList.toggle('muted', m.muted);
    micEl.setAttribute('aria-label', m.muted ? 'Unmute microphone' : 'Mute microphone');
    micEl.title = `${m.name}: ${m.muted ? 'muted' : 'live'}`;
  }

  function toggleMic() {
    const m = store.mic;
    if (!m || !m.available) return;
    const muted = !m.muted;
    m.muted = muted; // optimistic
    renderMic();
    send('mic.set', { muted }).then((r) => {
      if (r.ok) return;
      if (store.mic) store.mic.muted = !muted;
      renderMic();
      shake(micEl);
    });
  }

  micEl.addEventListener('click', toggleMic);
  renderers.mic = renderMic;

  /* ----- the Mac's CPU, memory and battery ----- */

  function renderSystem() {
    const { parts, low } = macStats(store.system);
    macstatEl.innerHTML = parts.map((p) => `<span>${esc(p)}</span>`).join('');
    macstatEl.classList.toggle('low', low);
  }
  renderers.system = renderSystem;
  renderers.badges = renderWindows;

  /* ----- buttons for the Mac's front app ----- */

  let actionsHtml = '';

  function renderShortcuts() {
    const sc = store.shortcuts;
    const buttons = (sc && sc.buttons) || [];
    const html = buttons.map((b, i) => `<button class="action" data-index="${i + 1}">${esc(b.label)}</button>`).join('');
    if (html === actionsHtml) return;
    actionsHtml = html;
    actionsEl.innerHTML = html;
    actionsEl.setAttribute('aria-label', sc && sc.name ? `Shortcuts for ${sc.name}` : 'Shortcuts');
    fitTiles();
  }

  actionsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.action');
    const sc = store.shortcuts;
    if (!btn || !sc) return;
    send('shortcuts.run', { bundleId: sc.bundleId, index: Number(btn.dataset.index) }).then((r) => { if (!r.ok) shake(btn); });
  });
  renderers.shortcuts = renderShortcuts;

  /* ----- pages: panel, screens map, sketch pad ----- */

  const pagesEl = $('pages');
  const dotsEl = $('page-dots');
  let currentPage = 0;

  function goToPage(n) {
    currentPage = Math.max(0, Math.min(2, n));
    pagesEl.style.transform = `translateX(${-currentPage * 100}vw)`;
    dotsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.page) === currentPage));
    if (currentPage !== 0 && openApp) closeLayer();
    if (currentPage === 1) { renderMap(); refreshShots(); }
    if (currentPage === 2) sizePad();
  }

  dotsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) goToPage(Number(b.dataset.page));
  });

  // Swipe between pages: anywhere on the panel, and on the map's empty space (dragging a window
  // moves it instead). The pad draws everywhere, so there the dots and Back switch pages.
  let swipe = null;
  let swallowClick = false;
  function canSwipeFrom(target) {
    if (currentPage === 0) return !openApp && !target.closest('input, .scrub, .vol');
    if (currentPage === 1) return !target.closest('.mwin, .map-tools');
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
    goToPage(currentPage + dir);
  });
  document.addEventListener('click', (e) => {
    if (swallowClick) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  /* ----- map page: drag windows around the Mac's screens ----- */

  const mapEl = $('map');
  const mapTools = $('map-tools');
  const map = { fit: null, selected: null, drag: null };
  const SHOT_REFRESH_MS = 15000; // each capture briefly blocks Hammerspoon, so not too often

  // Window screenshots: each new one is downloaded and decoded off-screen, then crossfaded over the
  // old one, so a refresh never shows an empty window. Kept as object URLs so redraws reuse them.
  const shots = new Map(); // window id -> object URL of its latest screenshot
  let shotsBusy = false;

  async function refreshShots() {
    if (MOCK || shotsBusy) return;
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
  setInterval(() => { if (currentPage === 1 && !sleep.asleep) refreshShots(); }, SHOT_REFRESH_MS);
  const PRESETS = [
    ['left-third', 'Left ⅓', 0, 1 / 3], ['middle-third', 'Middle ⅓', 1 / 3, 1 / 3], ['right-third', 'Right ⅓', 2 / 3, 1 / 3],
    ['left-half', 'Left ½', 0, 0.5], ['right-half', 'Right ½', 0.5, 0.5], ['center', 'Centre', 1 / 6, 2 / 3],
    ['max', 'Full', 0, 1], ['other-screen', 'Other screen', null, null],
  ];
  const presetGlyph = (left, width) => left == null
    ? '<svg viewBox="0 0 64 22"><rect x="1" y="3" width="36" height="16" rx="3"/><rect x="45" y="5" width="18" height="12" rx="2"/><path d="M30 11h22m-5-4 5 4-5 4" fill="none"/></svg>'
    : `<svg viewBox="0 0 64 22"><rect x="1" y="3" width="62" height="16" rx="3"/><rect class="zone" x="${1 + 62 * left}" y="3" width="${62 * width}" height="16" rx="3"/></svg>`;
  mapTools.innerHTML = PRESETS.map(([id, label, l, w]) => `<button class="preset" data-preset="${id}">${presetGlyph(l, w)}<span>${label}</span></button>`).join('');

  function mapWindows() {
    const out = [];
    for (const app of (store.windows && store.windows.apps) || []) {
      for (const w of app.windows) {
        if (w.frame && !w.minimized && !w.otherSpace && !app.hidden) out.push({ app, w });
      }
    }
    // Back to front, so later elements sit on top like windows on the screen.
    return out.sort((a, b) => (b.w.z || 1e9) - (a.w.z || 1e9));
  }

  function renderMap() {
    if (currentPage !== 1 || map.drag) return;
    const screens = store.windows && store.windows.screens;
    if (!screens || !screens.length) { mapEl.innerHTML = ''; return; }
    const box = mapEl.getBoundingClientRect();
    map.fit = mapFit(screens, box.width, box.height);
    const px = (r) => `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    const wins = mapWindows();
    if (map.selected && !wins.some((x) => x.w.id === map.selected)) map.selected = null;
    mapEl.innerHTML = screens.map((sc) => `<div class="mscreen" style="${px(toMap(sc.frame, map.fit))}"><span>${esc(sc.name)}</span></div>`).join('')
      + wins.map(({ app, w }) => {
        const cls = ['mwin'];
        if (w.id === store.windows.focusedId) cls.push('focused');
        if (w.id === map.selected) cls.push('selected');
        // The window's live look (needs Screen Recording on the Mac; otherwise just the plain card).
        const shot = shots.has(w.id) ? `<img class="mshot" src="${shots.get(w.id)}" alt="">` : '';
        return `<div class="${cls.join(' ')}" data-id="${w.id}" style="${px(toMap(w.frame, map.fit))}">
            ${shot}
            <div class="mwin-head"><img src="${esc(iconUrl(app.bundleId))}" alt=""><span>${esc(w.title)}</span></div>
            <div class="grip"></div>
          </div>`;
      }).join('');
    mapTools.classList.toggle('on', !!map.selected);
  }

  const sendMove = makeThrottle((id, frame) => send('windows.move', { id, ...frame }), 80);

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
      focusWindow(d.id, () => mapEl.querySelector(`.mwin[data-id="${d.id}"]`));
    } else if (d.rect) {
      send('windows.move', { id: d.id, ...fromMap(d.rect, map.fit) });
    }
    setTimeout(renderMap, 150); // let the Mac's update catch up before redrawing
    if (d.moved) setTimeout(refreshShots, 400); // the window redraws at its new size
  }
  mapEl.addEventListener('pointerup', endDrag);
  mapEl.addEventListener('pointercancel', endDrag);

  mapTools.addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (!b || !map.selected) return;
    send('windows.layout', { id: map.selected, preset: b.dataset.preset }).then((r) => {
      if (!r.ok) shake(b);
      else setTimeout(refreshShots, 400); // the window redraws at its new size
    });
  });

  const renderWindowsOnly = renderers.windows;
  renderers.windows = () => { renderWindowsOnly(); renderMap(); };

  /* ----- sketch pad: draw, then copy to the Mac's clipboard ----- */

  const padEl = $('pad');
  const padCtx = padEl.getContext('2d');
  const padHint = $('pad-hint');
  const padToast = $('pad-toast');
  const strokes = [];
  let stroke = null;
  let padFrame = 0;
  const INK_WIDTH = 3.5;

  function drawStrokes(ctx, list, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = INK_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pts of list) {
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, INK_WIDTH / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      // Smooth the finger's path: curve through the midpoints between samples.
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  }

  function redrawPad() {
    padFrame = 0;
    const dpr = window.devicePixelRatio || 1;
    padCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    padCtx.clearRect(0, 0, padEl.width, padEl.height);
    drawStrokes(padCtx, strokes, '#eeeaf4');
    padHint.hidden = strokes.length > 0;
  }

  function sizePad() {
    const dpr = window.devicePixelRatio || 1;
    padEl.width = Math.round(padEl.clientWidth * dpr);
    padEl.height = Math.round(padEl.clientHeight * dpr);
    redrawPad();
  }

  const padPoint = (e) => ({ x: e.offsetX, y: e.offsetY });
  padEl.addEventListener('pointerdown', (e) => {
    padEl.setPointerCapture(e.pointerId);
    stroke = [padPoint(e)];
    strokes.push(stroke);
    redrawPad();
  });
  padEl.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    events.forEach((ev) => stroke.push(padPoint(ev)));
    if (!padFrame) padFrame = requestAnimationFrame(redrawPad);
  });
  const endStroke = () => { stroke = null; };
  padEl.addEventListener('pointerup', endStroke);
  padEl.addEventListener('pointercancel', endStroke);

  $('pad-undo').addEventListener('click', () => { strokes.pop(); redrawPad(); });
  $('pad-clear').addEventListener('click', () => { strokes.length = 0; redrawPad(); });

  function padMessage(text) {
    padToast.textContent = text;
    padToast.hidden = false;
    padToast.classList.remove('show');
    void padToast.offsetWidth;
    padToast.classList.add('show');
  }

  // Black ink on transparent, cropped to the drawing, at 2× for a crisp paste.
  $('pad-copy').addEventListener('click', (e) => {
    const b = strokeBounds(strokes, 12);
    if (!b) { shake(e.currentTarget); return; }
    const scale = 2;
    const out = document.createElement('canvas');
    out.width = Math.round(b.w * scale);
    out.height = Math.round(b.h * scale);
    const ctx = out.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, -b.x * scale, -b.y * scale);
    drawStrokes(ctx, strokes, '#000');
    const png = out.toDataURL('image/png').split(',')[1];
    send('pad.copy', { png }).then((r) => padMessage(r.ok ? 'Copied — paste it on the Mac' : 'Couldn\'t copy to the Mac'));
  });

  window.addEventListener('resize', () => {
    if (currentPage === 1) renderMap();
    if (currentPage === 2) sizePad();
  });
  goToPage(0);

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
    rgbToHsl, pickAccent, accentCss, mockState, shouldSleep, keyAction, formatClock, batteryTrend, batteryTone, tileSize, tileAction, macStats,
    mapFit, toMap, fromMap, swipeDirection, strokeBounds,
  };
}
if (typeof document !== 'undefined') boot();
