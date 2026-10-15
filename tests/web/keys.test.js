import test from 'node:test';
import assert from 'node:assert/strict';
import { keyAction } from '../../tabletpanel/web/js/keys.js';
import { PAGE } from '../../tabletpanel/web/js/pages.js';

test('keyAction: back closes the sheet, navigation keys peek while dark, volume keys do nothing', () => {
  assert.equal(keyAction('back', { layerOpen: true, asleep: false }), 'closeLayer');
  assert.equal(keyAction('back', { layerOpen: false, asleep: false }), null);
  assert.equal(keyAction('home', { layerOpen: false, asleep: true }), 'peek');
  assert.equal(keyAction('recents', { layerOpen: true, asleep: true }), 'peek');
  assert.equal(keyAction('volumedown', { layerOpen: true, asleep: true }), null);
  assert.equal(keyAction(undefined, { layerOpen: true, asleep: false }), null);
});

test('keyAction: Recents toggles the mic during a call, and only then', () => {
  assert.equal(keyAction('recents', { layerOpen: false, asleep: false, micInUse: true }), 'toggleMic');
  assert.equal(keyAction('recents', { layerOpen: false, asleep: false, micInUse: false }), null);
  // a dark screen wakes first
  assert.equal(keyAction('recents', { layerOpen: false, asleep: true, micInUse: true }), 'peek');
});

test('keyAction: Back returns to the panel from the other pages', () => {
  assert.equal(keyAction('back', { layerOpen: false, asleep: false, page: PAGE.map }), 'panel');
  assert.equal(keyAction('back', { layerOpen: false, asleep: false, page: PAGE.auth }), 'panel');
  assert.equal(keyAction('back', { layerOpen: true, asleep: false, page: PAGE.panel }), 'closeLayer');
  assert.equal(keyAction('back', { layerOpen: false, asleep: false, page: PAGE.panel }), null);
});
