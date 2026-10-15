import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE, swipeDirection } from '../../tabletpanel/web/js/pages.js';

test('swipeDirection needs a long, mostly horizontal swipe', () => {
  assert.equal(swipeDirection(-120, 10), 1); // finger moves left: next page
  assert.equal(swipeDirection(120, -20), -1);
  assert.equal(swipeDirection(-50, 0), 0);
  assert.equal(swipeDirection(-120, 90), 0);
});

test('the panel is the start page, with the Authenticator to its left', () => {
  assert.deepEqual(PAGE, { auth: 0, panel: 1, map: 2, pad: 3 });
});
