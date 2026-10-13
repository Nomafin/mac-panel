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

/* ---------- Mock mode (?mock, ?mock=idle, ?mock=nospotify) ---------- */

function mockState(variant) {
  const spotify = variant === 'nospotify' ? { running: false }
    : variant === 'idle' ? { running: true, state: 'stopped' }
    : {
      running: true, state: 'playing',
      track: { id: 'spotify:track:mock', name: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", durationMs: 243000, artworkUrl: '' },
      positionMs: 61000, volume: 65, shuffle: false, repeat: true,
    };
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
    }
    if (mod in this.state) {
      this.v += 1;
      reply.updates = [this.stateMsg(mod)];
    }
    setTimeout(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify(reply) }); }, 30);
  }

  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose();
  }
}

/* ---------- App (browser only) ---------- */

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zM9.5 12 18 18V6z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
};

const PING_MS = 2000;
const STALE_MS = 7000; // no message for this long => socket is dead (e.g. after tablet sleep)
const SHIFT_MS = 180000; // AMOLED burn-in: nudge the whole UI every 3 minutes
const SHIFTS = [[0, 0], [1, 1], [2, 0], [1, -1], [0, -2], [-1, -1], [-2, 0], [-1, 1]];

function boot() {
  const params = new URLSearchParams(location.search);
  const MOCK = params.has('mock');
  const $ = (id) => document.getElementById(id);
  const shell = $('shell');
  const winEl = $('windows');
  const spEl = $('spotify');
  const overlay = $('overlay');
  const dot = $('dot');

  const store = { windows: null, spotify: null, spotifyAt: 0 };
  const conn = { ws: null, attempt: 0, nextId: 1, pending: new Map(), lastRx: 0, versions: {} };
  let overlayTimer = null;

  /* ----- connection ----- */

  function connect() {
    const ws = MOCK ? new MockSocket(params.get('mock')) : new WebSocket('ws://' + location.host + '/ws');
    conn.ws = ws;
    ws.onopen = () => {
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

  setInterval(() => {
    const ws = conn.ws;
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - conn.lastRx > STALE_MS) { reconnect(ws); return; }
    send('ping');
  }, PING_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && conn.ws && conn.ws.readyState === 1) send('ping');
  });

  /* ----- windows ----- */

  function iconUrl(bundleId) {
    return MOCK ? mockIcon(bundleId) : 'icon/' + encodeURIComponent(bundleId) + '.png';
  }

  function tileHtml(app, win, focusedId) {
    const cls = ['tile'];
    if (win.id === focusedId) cls.push('focused');
    if (win.minimized) cls.push('minimized');
    if (app.hidden) cls.push('app-hidden');
    const badge = win.minimized ? 'Minimized' : win.otherSpace ? 'Other Space' : app.hidden ? 'Hidden' : '';
    return `<button class="${cls.join(' ')}" data-id="${win.id}">
        <img class="tile-icon" src="${esc(iconUrl(app.bundleId))}" alt="">
        <span class="tile-title">${esc(win.title)}</span>
        ${badge ? `<span class="badge">${badge}</span>` : ''}
      </button>`;
  }

  function renderWindows() {
    const w = store.windows;
    if (!w || !w.apps || !w.apps.length) {
      winEl.innerHTML = '<div class="empty">No windows</div>';
      return;
    }
    const scroll = winEl.scrollTop;
    winEl.innerHTML = w.apps.map((app) => `
      <section class="app-group">
        <header class="app-head"><img src="${esc(iconUrl(app.bundleId))}" alt=""><span>${esc(app.name)}</span></header>
        <div class="tiles">${app.windows.map((win) => tileHtml(app, win, w.focusedId)).join('')}</div>
      </section>`).join('');
    winEl.scrollTop = scroll;
  }

  function shake(id) {
    const tile = winEl.querySelector(`.tile[data-id="${id}"]`);
    if (!tile) return;
    tile.classList.remove('shake');
    void tile.offsetWidth; // restart the animation
    tile.classList.add('shake');
  }

  winEl.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile || !store.windows) return;
    const id = Number(tile.dataset.id);
    const previous = store.windows.focusedId;
    store.windows.focusedId = id; // optimistic
    renderWindows();
    send('windows.focus', { id }).then((r) => {
      if (r.ok) return;
      if (store.windows && store.windows.focusedId === id) {
        store.windows.focusedId = previous;
        renderWindows();
      }
      shake(id);
    });
  });

  /* ----- spotify ----- */

  spEl.innerHTML = `
    <div class="sp-full">
      <img class="art" id="sp-art" alt="">
      <div class="meta"><div class="title" id="sp-title"></div><div class="sub" id="sp-sub"></div></div>
      <div>
        <div class="progress" id="sp-progress"><div class="rail"></div><div class="fill" id="sp-fill"></div></div>
        <div class="times"><span id="sp-pos">0:00</span><span id="sp-dur">0:00</span></div>
      </div>
      <div class="transport">
        <button class="btn" data-cmd="previous" aria-label="Previous">${ICONS.prev}</button>
        <button class="btn play" data-cmd="playpause" id="sp-play" aria-label="Play/Pause">${ICONS.play}</button>
        <button class="btn" data-cmd="next" aria-label="Next">${ICONS.next}</button>
      </div>
      <div class="row">
        <button class="btn toggle" data-cmd="shuffle" id="sp-shuffle" aria-label="Shuffle">${ICONS.shuffle}</button>
        <input type="range" min="0" max="100" step="1" id="sp-vol" aria-label="Volume">
        <button class="btn toggle" data-cmd="repeat" id="sp-repeat" aria-label="Repeat">${ICONS.repeat}</button>
      </div>
    </div>
    <div class="sp-idle">
      <div class="idle-text">Nothing playing</div>
      <button class="btn play" data-cmd="playpause" aria-label="Play">${ICONS.play}</button>
    </div>`;

  const artEl = $('sp-art'), titleEl = $('sp-title'), subEl = $('sp-sub');
  const progEl = $('sp-progress'), fillEl = $('sp-fill'), posEl = $('sp-pos'), durEl = $('sp-dur');
  const playBtn = $('sp-play'), shuffleBtn = $('sp-shuffle'), repeatBtn = $('sp-repeat'), volEl = $('sp-vol');
  let volDragging = false;
  let volReleaseTimer = null;

  function renderSpotify() {
    const sp = store.spotify;
    const running = !!(sp && sp.running);
    shell.classList.toggle('no-spotify', !running);
    spEl.hidden = !running;
    if (!running) return;
    const hasTrack = sp.state !== 'stopped' && !!sp.track;
    spEl.classList.toggle('idle', !hasTrack);
    if (!hasTrack) return;

    const t = sp.track;
    if (t.artworkUrl) {
      if (artEl.getAttribute('src') !== t.artworkUrl) artEl.src = t.artworkUrl;
    } else {
      artEl.removeAttribute('src');
    }
    titleEl.textContent = t.name;
    subEl.textContent = [t.artist, t.album].filter(Boolean).join(' · ');
    durEl.textContent = formatTime(t.durationMs);
    playBtn.innerHTML = sp.state === 'playing' ? ICONS.pause : ICONS.play;
    shuffleBtn.classList.toggle('on', !!sp.shuffle);
    repeatBtn.classList.toggle('on', !!sp.repeat);
    if (!volDragging) volEl.value = sp.volume;
    tickProgress();
  }

  function tickProgress() {
    const sp = store.spotify;
    if (!sp || !sp.track) return;
    const pos = estimatePosition(sp, store.spotifyAt, Date.now());
    const dur = sp.track.durationMs;
    fillEl.style.width = (dur ? Math.min(100, (pos / dur) * 100) : 0) + '%';
    posEl.textContent = formatTime(pos);
  }
  setInterval(tickProgress, 500);

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
    shell.style.transform = `translate(${x}px, ${y}px)`;
  }, SHIFT_MS);

  console.log('tabletpanel UA:', navigator.userAgent);
  renderWindows();
  connect();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, formatTime, estimatePosition, seekFraction, backoff, makeThrottle, mockState };
}
if (typeof document !== 'undefined') boot();
