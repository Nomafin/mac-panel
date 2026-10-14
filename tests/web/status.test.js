import test from 'node:test';
import assert from 'node:assert/strict';
import { batteryTone, batteryTrend, formatClock, macStats } from '../../tabletpanel/web/js/status.js';

test('formatClock gives 24-hour time and a Finnish d.m.Y date', () => {
  assert.deepEqual(formatClock(new Date(2026, 9, 14, 9, 5)), { time: '09:05', date: '14.10.2026' });
  assert.deepEqual(formatClock(new Date(2026, 2, 5, 23, 59)), { time: '23:59', date: '05.03.2026' });
});

test('batteryTrend compares the oldest and newest level of the last 30 minutes', () => {
  const min = 60000;
  const s = (m, level) => ({ t: m * min, level });
  assert.equal(batteryTrend([s(0, 60), s(20, 62)], 20 * min), 'up');
  assert.equal(batteryTrend([s(0, 60), s(20, 58)], 20 * min), 'down');
  assert.equal(batteryTrend([s(0, 60), s(20, 60)], 20 * min), 'flat');
  // under 10 minutes of history: no verdict yet
  assert.equal(batteryTrend([s(0, 60), s(9, 58)], 9 * min), null);
  assert.equal(batteryTrend([], 0), null);
  // samples older than 30 minutes are ignored
  assert.equal(batteryTrend([s(0, 40), s(25, 60), s(50, 60)], 50 * min), 'flat');
});

test('batteryTone warns when the level falls on the charger, and when low off it', () => {
  assert.equal(batteryTone({ level: 80, plugged: true }, 'down'), 'warn');
  assert.equal(batteryTone({ level: 80, plugged: true }, 'up'), '');
  assert.equal(batteryTone({ level: 19, plugged: false }, null), 'low');
  assert.equal(batteryTone({ level: 19, plugged: true }, 'up'), '');
  assert.equal(batteryTone({ level: 50, plugged: false }, 'down'), '');
});

test('macStats formats CPU, memory and the MacBook battery', () => {
  assert.deepEqual(macStats({ cpu: 12, memory: 63, battery: { level: 84, onPower: true, charging: true } }),
    { parts: ['CPU 12%', 'Memory 63%', 'MacBook 84% ⚡'], low: false });
  assert.deepEqual(macStats({ cpu: null, memory: 63, battery: { level: 15, onPower: false, charging: false } }),
    { parts: ['Memory 63%', 'MacBook 15%'], low: true });
  assert.deepEqual(macStats({ cpu: 5, memory: 40 }), { parts: ['CPU 5%', 'Memory 40%'], low: false });
  assert.deepEqual(macStats(null), { parts: [], low: false });
});
