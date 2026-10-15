import test from 'node:test';
import assert from 'node:assert/strict';
import { batteryTone, batteryTrend, formatClock, macStats } from '../../tabletpanel/web/js/status.js';

test('formatClock follows the configured time and date formats', () => {
  const fi = { timeFormat: 'H:i', dateFormat: 'd.m.Y' };
  assert.deepEqual(formatClock(new Date(2026, 9, 14, 9, 5), fi), { time: '09:05', date: '14.10.2026' });
  assert.deepEqual(formatClock(new Date(2026, 2, 5, 23, 59), fi), { time: '23:59', date: '05.03.2026' });
  const us = { timeFormat: 'g:i A', dateFormat: 'D, M j' };
  assert.deepEqual(formatClock(new Date(2026, 2, 5, 0, 7), us), { time: '12:07 AM', date: 'Thu, Mar 5' });
  assert.deepEqual(formatClock(new Date(2026, 2, 5, 13, 30), { timeFormat: 'h:i a', dateFormat: 'n/j/y' }),
    { time: '01:30 pm', date: '3/5/26' });
  // A backslash keeps the next character as it is.
  assert.equal(formatClock(new Date(2026, 2, 5), { dateFormat: '\\d\\a\\y j' }).date, 'day 5');
});

test('formatClock defaults to 24-hour time and the device locale\'s date', () => {
  const d = new Date(2026, 2, 5, 9, 5);
  assert.deepEqual(formatClock(d), { time: '09:05', date: d.toLocaleDateString() });
  assert.deepEqual(formatClock(d, {}), { time: '09:05', date: d.toLocaleDateString() });
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
