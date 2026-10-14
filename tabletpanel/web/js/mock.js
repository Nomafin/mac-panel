// Mock mode (?mock, ?mock=idle, ?mock=nospotify): fake Mac state for working on the page in a
// desktop browser. MockSocket answers like the Mac does.

export function mockArt(h1, h2) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},70%,55%)"/><stop offset="1" stop-color="hsl(${h2},60%,18%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="190" cy="120" r="70" fill="hsl(${h1},80%,72%)" opacity=".55"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export const MOCK_TRACKS = [
  { id: 'spotify:track:mock1', name: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", durationMs: 243000, artworkUrl: mockArt(320, 250) },
  { id: 'spotify:track:mock2', name: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine', durationMs: 330000, artworkUrl: mockArt(170, 210) },
];

export function mockState(variant) {
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

export function mockIcon(bundleId) {
  let hue = 0;
  for (const c of bundleId) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  const letter = bundleId.split('.').pop()[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="hsl(${hue},55%,45%)"/><text x="24" y="32" font-size="24" font-family="sans-serif" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Stands in for WebSocket: same events and message shapes as the Mac side.
export class MockSocket {
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
