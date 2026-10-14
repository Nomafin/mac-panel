import test from 'node:test';
import assert from 'node:assert/strict';
import { fromMap, mapFit, toMap } from '../../tabletpanel/web/js/map.js';

const SCREENS = [
  { id: 3, name: 'Odyssey', frame: { x: -7680, y: -285, w: 7680, h: 2130 } },
  { id: 1, name: 'Built-in', frame: { x: 0, y: 57, w: 2992, h: 1877 } },
];

const near = (a, b) => Math.abs(a - b) < 1e-6;

test('mapFit scales all screens into the box and centres them', () => {
  const fit = mapFit(SCREENS, 1067.2, 600);
  // bounding box 10672 x 2219 (y -285 .. 1934): width-limited
  assert.ok(near(fit.scale, 0.1), 'scale ' + fit.scale);
  assert.equal(fit.minX, -7680);
  assert.equal(fit.minY, -285);
  assert.ok(near(fit.ox, 0));
  assert.ok(near(fit.oy, (600 - 221.9) / 2));
});

test('toMap and fromMap are inverses', () => {
  const fit = mapFit(SCREENS, 1067.2, 600);
  const frame = { x: -5120, y: -285, w: 2560, h: 2130 };
  const r = toMap(frame, fit);
  assert.ok(near(r.left, 256) && near(r.top, fit.oy) && near(r.width, 256) && near(r.height, 213), JSON.stringify(r));
  assert.deepEqual(fromMap(r, fit), frame);
});
