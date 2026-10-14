import test from 'node:test';
import assert from 'node:assert/strict';
import { swipeDirection } from '../../tabletpanel/web/js/pages.js';

test('swipeDirection needs a long, mostly horizontal swipe', () => {
  assert.equal(swipeDirection(-120, 10), 1); // finger moves left: next page
  assert.equal(swipeDirection(120, -20), -1);
  assert.equal(swipeDirection(-50, 0), 0);
  assert.equal(swipeDirection(-120, 90), 0);
});
