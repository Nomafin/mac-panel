import test from 'node:test';
import assert from 'node:assert/strict';
import { backoff, makeDemotionDetector } from '../../tabletpanel/web/js/connection.js';

test('backoff doubles from 500ms and caps at 5s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(backoff), [500, 1000, 2000, 4000, 5000, 5000]);
});

test('demotion detector fires after consecutive ping replies that carried missed updates', () => {
  const missed = makeDemotionDetector(2);
  assert.equal(missed(1), false);
  assert.equal(missed(0), false); // a clean reply resets the count
  assert.equal(missed(1), false);
  assert.equal(missed(2), true);
  assert.equal(missed(1), false); // resets after firing
});
