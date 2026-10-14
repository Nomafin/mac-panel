import test from 'node:test';
import assert from 'node:assert/strict';
import { strokeBounds } from '../../tabletpanel/web/js/pad.js';

test('strokeBounds finds the drawing with a margin, or null when empty', () => {
  assert.deepEqual(strokeBounds([[{ x: 10, y: 20 }, { x: 50, y: 25 }], [{ x: 30, y: 60 }]], 5),
    { x: 5, y: 15, w: 50, h: 50 });
  assert.equal(strokeBounds([], 5), null);
});
