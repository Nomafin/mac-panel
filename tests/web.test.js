const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../tabletpanel/web/app.js');

function fakeClock() {
  const c = {
    t: 0, timers: [],
    now: () => c.t,
    setTimeout: (f, d) => { c.timers.push({ at: c.t + d, f }); },
    advance(ms) {
      c.t += ms;
      const due = c.timers.filter((x) => x.at <= c.t);
      c.timers = c.timers.filter((x) => x.at > c.t);
      due.forEach((x) => x.f());
    },
  };
  return c;
}

test('esc escapes HTML special characters', () => {
  assert.equal(h.esc(`<b a="x">&'</b>`), '&lt;b a=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;');
  assert.equal(h.esc(null), '');
  assert.equal(h.esc('Café 😀'), 'Café 😀');
});

test('formatTime renders m:ss', () => {
  assert.equal(h.formatTime(0), '0:00');
  assert.equal(h.formatTime(59999), '0:59');
  assert.equal(h.formatTime(61000), '1:01');
  assert.equal(h.formatTime(3725000), '62:05');
  assert.equal(h.formatTime(-5), '0:00');
  assert.equal(h.formatTime(undefined), '0:00');
});

test('estimatePosition interpolates only while playing and clamps to duration', () => {
  const sp = { state: 'playing', positionMs: 1000, track: { durationMs: 5000 } };
  assert.equal(h.estimatePosition(sp, 100, 600), 1500);
  assert.equal(h.estimatePosition(sp, 100, 99999), 5000);
  assert.equal(h.estimatePosition({ ...sp, state: 'paused' }, 100, 600), 1000);
  assert.equal(h.estimatePosition({ state: 'stopped' }, 0, 10), 0);
  assert.equal(h.estimatePosition(sp, 600, 100), 1000);
});

test('seekFraction maps x to 0..1', () => {
  const rect = { left: 100, width: 200 };
  assert.equal(h.seekFraction(200, rect), 0.5);
  assert.equal(h.seekFraction(50, rect), 0);
  assert.equal(h.seekFraction(400, rect), 1);
  assert.equal(h.seekFraction(150, { left: 0, width: 0 }), 0);
});

test('backoff doubles from 500ms and caps at 5s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(h.backoff), [500, 1000, 2000, 4000, 5000, 5000]);
});

test('makeThrottle runs immediately, then coalesces into one trailing call with the last args', () => {
  const clock = fakeClock();
  const calls = [];
  const fn = h.makeThrottle((v) => calls.push([clock.t, v]), 100, clock);
  fn(1);
  clock.advance(30); fn(2);
  clock.advance(30); fn(3);
  clock.advance(40);
  assert.deepEqual(calls, [[0, 1], [100, 3]]);
  clock.advance(200); fn(4);
  assert.deepEqual(calls[2], [300, 4]);
});

test('demotion detector fires after consecutive ping replies that carried missed updates', () => {
  const missed = h.makeDemotionDetector(2);
  assert.equal(missed(1), false);
  assert.equal(missed(0), false); // a clean reply resets the count
  assert.equal(missed(1), false);
  assert.equal(missed(2), true);
  assert.equal(missed(1), false); // resets after firing
});

function pixels(...rgbs) {
  const out = [];
  rgbs.forEach(([r, g, b, n = 1]) => { for (let i = 0; i < n; i++) out.push(r, g, b, 255); });
  return Uint8ClampedArray.from(out);
}

test('rgbToHsl converts primaries and greys', () => {
  assert.deepEqual(h.rgbToHsl(255, 0, 0).map((v) => Math.round(v * 100) / 100), [0, 1, 0.5]);
  assert.deepEqual(h.rgbToHsl(0, 0, 255).map((v) => Math.round(v * 100) / 100), [240, 1, 0.5]);
  assert.equal(h.rgbToHsl(128, 128, 128)[1], 0);
});

test('pickAccent follows the dominant saturated hue, not a single stray pixel', () => {
  const accent = h.pickAccent(pixels([200, 40, 40, 30], [40, 60, 220, 1], [20, 20, 20, 30]));
  assert.ok(accent.h < 20 || accent.h > 340, 'red wins: ' + accent.h);
});

test('pickAccent lifts dark colours so they read on black', () => {
  const accent = h.pickAccent(pixels([10, 20, 90, 50]));
  assert.ok(accent.l >= 0.6 && accent.l <= 0.75, 'lightness ' + accent.l);
  assert.ok(accent.h > 220 && accent.h < 240, 'hue kept ' + accent.h);
});

test('pickAccent returns null for greyscale art', () => {
  assert.equal(h.pickAccent(pixels([30, 30, 30, 20], [200, 200, 200, 20])), null);
});

test('accentCss formats an hsl colour', () => {
  assert.equal(h.accentCss({ h: 210.4, s: 0.8, l: 0.68 }), 'hsl(210 80% 68%)');
});

test('mockState variants', () => {
  assert.equal(h.mockState('nospotify').spotify.running, false);
  assert.equal(h.mockState('idle').spotify.state, 'stopped');
  assert.equal(h.mockState('').spotify.state, 'playing');
  assert.ok(h.mockState('').windows.apps.length >= 3);
});
