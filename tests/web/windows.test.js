import test from 'node:test';
import assert from 'node:assert/strict';
import { tileAction, tileSize } from '../../tabletpanel/web/js/windows.js';

test('tileSize keeps full-size tiles when they fit', () => {
  assert.equal(tileSize(12, 1000, 700), 136);
  assert.equal(tileSize(0, 1000, 700), 136);
});

test('tileSize shrinks tiles until every row fits the height', () => {
  const s = tileSize(17, 600, 560);
  assert.ok(s < 136 && s >= 64, 'size ' + s);
  const k = s / 136;
  const cols = Math.floor((600 + 16 * k) / (s + 16 * k));
  const rows = Math.ceil(17 / cols);
  assert.ok(rows * s + (rows - 1) * 22 * k + 11 * k <= 560, 'fits');
  // and the next size up would not fit
  assert.ok(tileSize(17, 600, 560) === s);
});

test('tileSize stops at a minimum', () => {
  assert.equal(tileSize(40, 300, 200), 64);
});

test('tileAction: launch apps without windows, focus a single window, open the sheet for several', () => {
  const w = (id) => ({ id, title: 't', minimized: false, otherSpace: false });
  assert.equal(tileAction({ running: false, windows: [] }), 'launch');
  assert.equal(tileAction({ running: true, windows: [] }), 'launch');
  assert.equal(tileAction({ running: true, windows: [w(1)] }), 'focus');
  assert.equal(tileAction({ running: true, windows: [w(1), w(2)] }), 'sheet');
});
