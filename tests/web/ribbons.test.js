import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasSize, frameDue, hslToRgb, mixPalette, moodFor, shouldAnimate } from '../../tabletpanel/web/js/ribbons.js';

const round = (rgb) => rgb.map((v) => Math.round(v * 100) / 100);

test('hslToRgb converts to 0..1 channels', () => {
  assert.deepEqual(round(hslToRgb({ h: 0, s: 1, l: 0.5 })), [1, 0, 0]);
  assert.deepEqual(round(hslToRgb({ h: 240, s: 1, l: 0.5 })), [0, 0, 1]);
  assert.deepEqual(round(hslToRgb({ h: 123, s: 0, l: 0.4 })), [0.4, 0.4, 0.4]);
});

test('mixPalette blends colour by colour and clamps t', () => {
  const a = [[0, 0, 0], [1, 1, 1], [0, 1, 0]];
  const b = [[1, 1, 1], [0, 0, 0], [0, 1, 0]];
  assert.deepEqual(mixPalette(a, b, 0.25), [[0.25, 0.25, 0.25], [0.75, 0.75, 0.75], [0, 1, 0]]);
  assert.deepEqual(mixPalette(a, b, 2), b);
  assert.deepEqual(mixPalette(a, b, -1), a);
});

test('moodFor: full speed and light while playing, slower and dimmer otherwise', () => {
  const playing = moodFor('playing'), paused = moodFor('paused'), idle = moodFor('idle');
  assert.equal(playing.speed, 1);
  assert.ok(paused.speed < playing.speed && paused.light < playing.light);
  assert.ok(idle.speed <= paused.speed && idle.light <= paused.light);
  assert.deepEqual(moodFor('anything else'), idle);
});

test('shouldAnimate only when visible, awake and motion is allowed', () => {
  assert.equal(shouldAnimate({ hidden: false, asleep: false, reducedMotion: false }), true);
  assert.equal(shouldAnimate({ hidden: true, asleep: false, reducedMotion: false }), false);
  assert.equal(shouldAnimate({ hidden: false, asleep: true, reducedMotion: false }), false);
  assert.equal(shouldAnimate({ hidden: false, asleep: false, reducedMotion: true }), false);
});

test('canvasSize draws at a fraction of the CSS size, capped, never zero', () => {
  assert.deepEqual(canvasSize(1024, 768, 0.5, 640), [512, 384]);
  assert.deepEqual(canvasSize(2048, 1536, 0.5, 640), [640, 480]);
  assert.deepEqual(canvasSize(0, 0, 0.5, 640), [1, 1]);
});

test('frameDue caps the frame rate', () => {
  assert.equal(frameDue(1000, 1000 - 34, 30), true);
  assert.equal(frameDue(1000, 1000 - 20, 30), false);
  assert.equal(frameDue(1000, -Infinity, 30), true);
});
