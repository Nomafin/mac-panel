import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSleep } from '../../tabletpanel/web/js/sleep.js';

test('shouldSleep follows the Mac while connected', () => {
  const base = { connected: true, disconnectedSince: null, peekUntil: 0, now: 1000 };
  assert.equal(shouldSleep({ ...base, macAwake: true }), false);
  assert.equal(shouldSleep({ ...base, macAwake: false }), true);
  assert.equal(shouldSleep({ ...base, macAwake: undefined }), false);
});

test('shouldSleep goes dark after 30 s without a connection', () => {
  const base = { macAwake: true, connected: false, disconnectedSince: 0, peekUntil: 0 };
  assert.equal(shouldSleep({ ...base, now: 29999 }), false);
  assert.equal(shouldSleep({ ...base, now: 30000 }), true);
});

test('shouldSleep stays awake during a peek', () => {
  assert.equal(shouldSleep({ macAwake: false, connected: true, disconnectedSince: null, peekUntil: 5000, now: 4999 }), false);
  assert.equal(shouldSleep({ macAwake: false, connected: true, disconnectedSince: null, peekUntil: 5000, now: 5000 }), true);
});
