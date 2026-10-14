import test from 'node:test';
import assert from 'node:assert/strict';
import { accentCss, estimatePosition, formatTime, pickAccent, rgbToHsl, seekFraction } from '../../tabletpanel/web/js/music.js';

function pixels(...rgbs) {
  const out = [];
  rgbs.forEach(([r, g, b, n = 1]) => { for (let i = 0; i < n; i++) out.push(r, g, b, 255); });
  return Uint8ClampedArray.from(out);
}

test('formatTime renders m:ss', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(59999), '0:59');
  assert.equal(formatTime(61000), '1:01');
  assert.equal(formatTime(3725000), '62:05');
  assert.equal(formatTime(-5), '0:00');
  assert.equal(formatTime(undefined), '0:00');
});

test('estimatePosition interpolates only while playing and clamps to duration', () => {
  const sp = { state: 'playing', positionMs: 1000, track: { durationMs: 5000 } };
  assert.equal(estimatePosition(sp, 100, 600), 1500);
  assert.equal(estimatePosition(sp, 100, 99999), 5000);
  assert.equal(estimatePosition({ ...sp, state: 'paused' }, 100, 600), 1000);
  assert.equal(estimatePosition({ state: 'stopped' }, 0, 10), 0);
  assert.equal(estimatePosition(sp, 600, 100), 1000);
});

test('seekFraction maps x to 0..1', () => {
  const rect = { left: 100, width: 200 };
  assert.equal(seekFraction(200, rect), 0.5);
  assert.equal(seekFraction(50, rect), 0);
  assert.equal(seekFraction(400, rect), 1);
  assert.equal(seekFraction(150, { left: 0, width: 0 }), 0);
});

test('rgbToHsl converts primaries and greys', () => {
  assert.deepEqual(rgbToHsl(255, 0, 0).map((v) => Math.round(v * 100) / 100), [0, 1, 0.5]);
  assert.deepEqual(rgbToHsl(0, 0, 255).map((v) => Math.round(v * 100) / 100), [240, 1, 0.5]);
  assert.equal(rgbToHsl(128, 128, 128)[1], 0);
});

test('pickAccent follows the dominant saturated hue, not a single stray pixel', () => {
  const accent = pickAccent(pixels([200, 40, 40, 30], [40, 60, 220, 1], [20, 20, 20, 30]));
  assert.ok(accent.h < 20 || accent.h > 340, 'red wins: ' + accent.h);
});

test('pickAccent lifts dark colours so they read on black', () => {
  const accent = pickAccent(pixels([10, 20, 90, 50]));
  assert.ok(accent.l >= 0.6 && accent.l <= 0.75, 'lightness ' + accent.l);
  assert.ok(accent.h > 220 && accent.h < 240, 'hue kept ' + accent.h);
});

test('pickAccent returns null for greyscale art', () => {
  assert.equal(pickAccent(pixels([30, 30, 30, 20], [200, 200, 200, 20])), null);
});

test('accentCss formats an hsl colour', () => {
  assert.equal(accentCss({ h: 210.4, s: 0.8, l: 0.68 }), 'hsl(210 80% 68%)');
});
