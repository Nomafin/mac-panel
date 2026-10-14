// The tablet panel's page: wires the features together. Each feature module exports its pure,
// tested helpers and an init(ctx) that sets up its part of the screen.
//
// ctx is the shared context: the Mac's state (ctx.store), requests to the Mac (ctx.send), state
// change events (ctx.on / ctx.emit, one per Mac module), and each feature's small API
// (ctx.windows, ctx.sheet, …) for the few places where features talk to each other.
import { initConnection } from './connection.js';
import { initWindows } from './windows.js';
import { initSheet } from './sheet.js';
import { initSleep } from './sleep.js';
import { initMusic } from './music.js';
import { initMic } from './mic.js';
import { initStatus } from './status.js';
import { initShortcuts } from './shortcuts.js';
import { initMap } from './map.js';
import { initPad } from './pad.js';
import { initPages } from './pages.js';
import { initKeys } from './keys.js';
import { browserShots } from './shots.js';

const params = new URLSearchParams(location.search);
const listeners = {};

const ctx = {
  MOCK: params.has('mock'),
  mockVariant: params.get('mock'),
  $: (id) => document.getElementById(id),
  store: { windows: null, spotify: null, display: null, badges: null, mic: null, system: null, shortcuts: null, spotifyAt: 0 },
  connected: false,
  on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
  emit(event) { (listeners[event] || []).forEach((fn) => fn()); },
};

ctx.shots = browserShots(ctx.MOCK);
ctx.connection = initConnection(ctx);
ctx.send = ctx.connection.send;
ctx.windows = initWindows(ctx);
ctx.sheet = initSheet(ctx);
ctx.sleep = initSleep(ctx);
initMusic(ctx);
ctx.mic = initMic(ctx);
initStatus(ctx);
initShortcuts(ctx);
ctx.map = initMap(ctx);
ctx.pad = initPad(ctx);
ctx.pages = initPages(ctx); // last: it shows the first page, which uses the others
initKeys(ctx);

console.log('tabletpanel UA:', navigator.userAgent);
ctx.windows.render();
ctx.connection.connect();
