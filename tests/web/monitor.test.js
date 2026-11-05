import test from 'node:test';
import assert from 'node:assert/strict';
import { highlighted, switchFailed } from '../../tabletpanel/web/js/monitor.js';

const state = { available: true, current: 17, inputs: [{ label: 'Mac', code: 17 }, { label: 'PC', code: 18 }] };

test('the tapped input is shown at once, then what the monitor reports', () => {
  assert.equal(highlighted(state, null, 1000), 17);
  assert.equal(highlighted(state, { code: 18, until: 5000 }, 1000), 18);
  assert.equal(highlighted(state, { code: 18, until: 5000 }, 6000), 17);
  assert.equal(highlighted({ ...state, current: undefined }, null, 1000), null);
});

test('a switch has failed when the monitor still shows another input after the wait', () => {
  assert.equal(switchFailed(state, { code: 18, until: 5000 }, 6000), true);
  assert.equal(switchFailed({ ...state, current: 18 }, { code: 18, until: 5000 }, 6000), false);
  assert.equal(switchFailed(state, { code: 18, until: 5000 }, 1000), false);
  assert.equal(switchFailed(state, null, 6000), false);
});
