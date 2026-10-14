import test from 'node:test';
import assert from 'node:assert/strict';
import { mockState } from '../../tabletpanel/web/js/mock.js';

test('mockState variants', () => {
  assert.equal(mockState('nospotify').spotify.running, false);
  assert.equal(mockState('idle').spotify.state, 'stopped');
  assert.equal(mockState('').spotify.state, 'playing');
  assert.ok(mockState('').windows.apps.length >= 3);
  assert.equal(mockState('').display.awake, true);
});
