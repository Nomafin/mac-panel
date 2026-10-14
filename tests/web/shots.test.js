import test from 'node:test';
import assert from 'node:assert/strict';
import { createShots } from '../../tabletpanel/web/js/shots.js';

// Fake capture: each load of an id returns a new URL like "w7#2"; ids in `failLoad` give nothing,
// URLs in `failDecode` don't decode.
function fakes({ failLoad = [], failDecode = [] } = {}) {
  const loads = [];
  const revoked = [];
  const count = {};
  return {
    loads, revoked,
    deps: {
      load: async (id) => {
        loads.push(id);
        if (failLoad.includes(id)) return null;
        count[id] = (count[id] || 0) + 1;
        return `w${id}#${count[id]}`;
      },
      decode: async (url) => { if (failDecode.includes(url)) throw new Error('bad image'); },
      revoke: (url) => revoked.push(url),
    },
  };
}

test('refresh captures each window once, in turn, and reports each fresh screenshot', async () => {
  const f = fakes();
  const shots = createShots(f.deps);
  const fresh = [];
  await shots.refresh([1, 2], (id, url) => fresh.push([id, url]));
  assert.deepEqual(f.loads, [1, 2]);
  assert.deepEqual(fresh, [[1, 'w1#1'], [2, 'w2#1']]);
  assert.equal(shots.url(2), 'w2#1');
});

test('a new screenshot replaces the old one, which is released', async () => {
  const f = fakes();
  const shots = createShots(f.deps);
  await shots.refresh([1]);
  await shots.refresh([1]);
  assert.equal(shots.url(1), 'w1#2');
  assert.deepEqual(f.revoked, ['w1#1']);
});

test('a failed capture or a broken image keeps the previous screenshot', async () => {
  const f = fakes({ failDecode: ['w1#2'] });
  const shots = createShots(f.deps);
  await shots.refresh([1]);
  await shots.refresh([1]);
  assert.equal(shots.url(1), 'w1#1');
  assert.deepEqual(f.revoked, ['w1#2']); // the broken one is released, not leaked

  const g = fakes({ failLoad: [5] });
  const other = createShots(g.deps);
  await other.refresh([5]);
  assert.equal(other.url(5), undefined);
});

test('a refresh while one is running is skipped, so captures never pile up', async () => {
  const f = fakes();
  const shots = createShots(f.deps);
  await Promise.all([shots.refresh([1, 2]), shots.refresh([1, 2])]);
  assert.deepEqual(f.loads, [1, 2]);
});

test('prune releases screenshots of windows that are gone', async () => {
  const f = fakes();
  const shots = createShots(f.deps);
  await shots.refresh([1, 2]);
  shots.prune([2]);
  assert.equal(shots.url(1), undefined);
  assert.equal(shots.url(2), 'w2#1');
  assert.deepEqual(f.revoked, ['w1#1']);
});
