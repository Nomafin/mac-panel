import test from 'node:test';
import assert from 'node:assert/strict';
import { statusText, trackPart } from '../../tabletpanel/web/js/scan.js';

const reply = (over) => ({ ok: true, imported: 0, duplicates: 0, skipped: 0, batchIndex: 0, batchSize: 1, batchId: 7, ...over });

test('a single-part export is done at once', () => {
  const { progress, done } = trackPart(null, reply({ imported: 3 }));
  assert.equal(done, true);
  assert.equal(statusText(progress, done), 'Imported 3 accounts');
  assert.equal(statusText(trackPart(null, reply({ imported: 1 })).progress, true), 'Imported 1 account');
});

test('a multi-part export asks for the next code until every part is in', () => {
  let r = trackPart(null, reply({ imported: 4, batchSize: 3, batchIndex: 0 }));
  assert.equal(r.done, false);
  assert.equal(statusText(r.progress, r.done), '1 of 3 parts scanned. Show the next code');
  r = trackPart(r.progress, reply({ imported: 4, batchSize: 3, batchIndex: 2 }));
  assert.equal(statusText(r.progress, r.done), '2 of 3 parts scanned. Show the next code');
  r = trackPart(r.progress, reply({ imported: 2, duplicates: 2, skipped: 1, batchSize: 3, batchIndex: 1 }));
  assert.equal(r.done, true);
  assert.equal(statusText(r.progress, r.done), 'Imported 10 accounts (2 already here, 1 counter-based skipped)');
});

test('a part scanned again is ignored', () => {
  const first = trackPart(null, reply({ imported: 4, batchSize: 2, batchIndex: 0 }));
  const again = trackPart(first.progress, reply({ duplicates: 4, batchSize: 2, batchIndex: 0 }));
  assert.deepEqual(again.progress, first.progress);
  assert.equal(again.done, false);
});

test('a code from another export starts over', () => {
  const first = trackPart(null, reply({ imported: 4, batchSize: 2, batchIndex: 0 }));
  const other = trackPart(first.progress, reply({ imported: 1, batchSize: 2, batchIndex: 0, batchId: 8 }));
  assert.deepEqual(other.progress.seen, [0]);
  assert.equal(other.progress.imported, 1);
});

test('nothing new is said plainly', () => {
  assert.equal(statusText(trackPart(null, reply({ duplicates: 2 })).progress, true), 'No new accounts (2 already here)');
  assert.equal(statusText(trackPart(null, reply({})).progress, true), 'No accounts in this code');
  assert.equal(statusText(null, false), 'Hold the export QR code up to the camera');
});
