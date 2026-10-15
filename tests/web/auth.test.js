import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeHue, copyLabel, periodLeft, sortAccounts } from '../../tabletpanel/web/js/auth.js';

test('sortAccounts orders by service, then account name, ignoring case; no service goes last', () => {
  const list = [
    { id: 1, issuer: 'github', name: 'work' },
    { id: 2, issuer: '', name: 'alpha' },
    { id: 3, issuer: 'AWS', name: 'root' },
    { id: 4, issuer: 'GitHub', name: 'me' },
  ];
  assert.deepEqual(sortAccounts(list).map((a) => a.id), [3, 4, 1, 2]);
  assert.deepEqual(list.map((a) => a.id), [1, 2, 3, 4]); // the input is left alone
});

test('badgeHue is stable per service and within 0..359', () => {
  assert.equal(badgeHue('GitHub'), badgeHue('GitHub'));
  assert.notEqual(badgeHue('GitHub'), badgeHue('AWS'));
  for (const s of ['', 'a', 'Microsoft', 'Ääkkönen']) {
    const h = badgeHue(s);
    assert.ok(Number.isInteger(h) && h >= 0 && h < 360, s);
  }
});

test('periodLeft counts down to the end of the current period', () => {
  assert.equal(periodLeft(10500, 30), 19.5);
  assert.equal(periodLeft(30000, 30), 30);
  assert.equal(periodLeft(59999, 60), 0.001);
});

test('copyLabel: waiting, copied, then the clear countdown', () => {
  assert.equal(copyLabel(null, 0, 0), null);
  assert.equal(copyLabel({ status: 'waiting' }, 0, 500), 'Next code…');
  const copied = { status: 'copied' };
  assert.equal(copyLabel(copied, 1000, 1000), 'Copied');
  assert.equal(copyLabel(copied, 1000, 2400), 'Copied');
  assert.equal(copyLabel(copied, 1000, 2600), 'Clears in 29 s');
  assert.equal(copyLabel(copied, 1000, 30500), 'Clears in 1 s');
  assert.equal(copyLabel(copied, 1000, 31000), null);
});
