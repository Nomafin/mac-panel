// The status around the grid: clock and date, the tablet's battery, and the Mac's CPU/memory/battery.
import { esc } from './util.js';

const TREND_WINDOW_MS = 30 * 60000;
const TREND_MIN_SPAN_MS = 10 * 60000;
const BATTERY_POLL_MS = 60000;

const pad2 = (n) => String(n).padStart(2, '0');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The letters PHP's date() uses for the same things; any other character is kept as it is.
const TOKENS = {
  d: (d) => pad2(d.getDate()),
  j: (d) => String(d.getDate()),
  D: (d) => DAYS[d.getDay()],
  m: (d) => pad2(d.getMonth() + 1),
  n: (d) => String(d.getMonth() + 1),
  M: (d) => MONTHS[d.getMonth()],
  Y: (d) => String(d.getFullYear()),
  y: (d) => pad2(d.getFullYear() % 100),
  H: (d) => pad2(d.getHours()),
  G: (d) => String(d.getHours()),
  h: (d) => pad2(d.getHours() % 12 || 12),
  g: (d) => String(d.getHours() % 12 || 12),
  i: (d) => pad2(d.getMinutes()),
  A: (d) => (d.getHours() < 12 ? 'AM' : 'PM'),
  a: (d) => (d.getHours() < 12 ? 'am' : 'pm'),
};

function formatDate(d, format) {
  let out = '';
  for (let i = 0; i < format.length; i++) {
    const c = format[i];
    if (c === '\\' && i + 1 < format.length) out += format[++i];
    else out += TOKENS[c] ? TOKENS[c](d) : c;
  }
  return out;
}

// formats: the Mac's settings ({ timeFormat, dateFormat }); without a date format the date
// follows the tablet's language.
export function formatClock(d, formats = {}) {
  return {
    time: formatDate(d, formats.timeFormat || 'H:i'),
    date: formats.dateFormat ? formatDate(d, formats.dateFormat) : d.toLocaleDateString(),
  };
}

// Whether the battery level really rose or fell recently. Android's "charging" can't tell a charger
// that barely keeps up from one that charges. samples: [{t, level}], oldest first.
export function batteryTrend(samples, now) {
  const recent = samples.filter((s) => now - s.t <= TREND_WINDOW_MS);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (last.t - first.t < TREND_MIN_SPAN_MS) return null;
  if (last.level > first.level) return 'up';
  if (last.level < first.level) return 'down';
  return 'flat';
}

export function batteryTone({ level, plugged }, trend) {
  if (plugged && trend === 'down') return 'warn';
  if (!plugged && level < 20) return 'low';
  return '';
}

// The Mac status line: CPU, memory, and the MacBook's battery (amber when low and unplugged).
export function macStats(sys) {
  if (!sys) return { parts: [], low: false };
  const parts = [];
  if (sys.cpu != null) parts.push(`CPU ${sys.cpu}%`);
  if (sys.memory != null) parts.push(`Memory ${sys.memory}%`);
  const b = sys.battery;
  if (b) parts.push(`MacBook ${b.level}%${b.onPower ? ' ⚡' : ''}`);
  return { parts, low: !!(b && !b.onPower && b.level < 20) };
}

export function initStatus(ctx) {
  const { $ } = ctx;
  const timeEl = $('clock-time');
  const dateEl = $('clock-date');
  const battEl = $('battery');
  const macstatEl = $('macstat');
  const battery = { samples: [], plugged: null };

  function tickClock() {
    const { time, date } = formatClock(new Date(), ctx.store.settings || {});
    if (timeEl.textContent !== time) timeEl.textContent = time;
    if (dateEl.textContent !== date) dateEl.textContent = date;
  }

  // Only the tablet app can read the battery; a desktop browser shows no indicator.
  function readBattery() {
    if (window.TabletApp && window.TabletApp.battery) {
      try { return JSON.parse(window.TabletApp.battery()); } catch (_) { return null; }
    }
    return ctx.MOCK ? { level: 72, plugged: true } : null;
  }

  function tickBattery() {
    const b = readBattery();
    battEl.hidden = !b;
    if (!b) return;
    const now = Date.now();
    if (b.plugged !== battery.plugged) battery.samples = []; // a new charging session, a new trend
    battery.plugged = b.plugged;
    battery.samples.push({ t: now, level: b.level });
    battery.samples = battery.samples.filter((s) => now - s.t <= TREND_WINDOW_MS);
    const trend = b.plugged ? batteryTrend(battery.samples, now) : null;
    battEl.className = ('battery ' + batteryTone(b, trend)).trim();
    battEl.style.setProperty('--level', b.level / 100);
    battEl.querySelector('.pct').textContent = b.level + '%';
    battEl.querySelector('.trend').textContent = trend === 'up' ? '▴' : trend === 'down' ? '▾' : '';
    battEl.title = !b.plugged ? 'Tablet battery' : trend === 'down' ? 'Falling on the charger'
      : trend === 'up' ? 'Charging' : 'On the charger';
  }

  function renderSystem() {
    const { parts, low } = macStats(ctx.store.system);
    macstatEl.innerHTML = parts.map((p) => `<span>${esc(p)}</span>`).join('');
    macstatEl.classList.toggle('low', low);
  }

  tickClock();
  setInterval(tickClock, 1000);
  tickBattery();
  setInterval(tickBattery, BATTERY_POLL_MS);
  ctx.on('system', renderSystem);
  ctx.on('settings', tickClock);
}
