import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, makeThrottle } from '../../tabletpanel/web/js/util.js';

function fakeClock() {
  const c = {
    t: 0, timers: [],
    now: () => c.t,
    setTimeout: (f, d) => { c.timers.push({ at: c.t + d, f }); },
    advance(ms) {
      c.t += ms;
      const due = c.timers.filter((x) => x.at <= c.t);
      c.timers = c.timers.filter((x) => x.at > c.t);
      due.forEach((x) => x.f());
    },
  };
  return c;
}

test('esc escapes HTML special characters', () => {
  assert.equal(esc(`<b a="x">&'</b>`), '&lt;b a=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc('Café 😀'), 'Café 😀');
});

test('makeThrottle runs immediately, then coalesces into one trailing call with the last args', () => {
  const clock = fakeClock();
  const calls = [];
  const fn = makeThrottle((v) => calls.push([clock.t, v]), 100, clock);
  fn(1);
  clock.advance(30); fn(2);
  clock.advance(30); fn(3);
  clock.advance(40);
  assert.deepEqual(calls, [[0, 1], [100, 3]]);
  clock.advance(200); fn(4);
  assert.deepEqual(calls[2], [300, 4]);
});
