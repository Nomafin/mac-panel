// Small helpers shared by the page's features.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Calls fn at most once per `ms`; the last call in a burst always runs (trailing).
export function makeThrottle(fn, ms, clock) {
  clock = clock || { now: () => Date.now(), setTimeout: (f, d) => setTimeout(f, d) };
  let last = -Infinity;
  let scheduled = false;
  let pendingArgs = null;
  return function (...args) {
    const wait = last + ms - clock.now();
    if (wait <= 0 && !scheduled) {
      last = clock.now();
      fn(...args);
      return;
    }
    pendingArgs = args;
    if (!scheduled) {
      scheduled = true;
      clock.setTimeout(() => {
        scheduled = false;
        last = clock.now();
        const a = pendingArgs;
        pendingArgs = null;
        fn(...a);
      }, Math.max(0, wait));
    }
  };
}

// Restarts a one-shot CSS animation class on an element.
export function replay(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// A "no" wiggle for a tap the Mac refused.
export const shake = (el) => replay(el, 'shake');
