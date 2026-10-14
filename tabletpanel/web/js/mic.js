// The mic mute button: shown while an app is using the Mac's microphone (a call).
import { shake } from './util.js';

export function initMic(ctx) {
  const micEl = ctx.$('mic');

  function render() {
    const m = ctx.store.mic;
    const show = !!(m && m.available && m.inUse);
    micEl.hidden = !show;
    if (!show) return;
    micEl.classList.toggle('muted', m.muted);
    micEl.setAttribute('aria-label', m.muted ? 'Unmute microphone' : 'Mute microphone');
    micEl.title = `${m.name}: ${m.muted ? 'muted' : 'live'}`;
  }

  function toggle() {
    const m = ctx.store.mic;
    if (!m || !m.available) return;
    const muted = !m.muted;
    m.muted = muted; // optimistic
    render();
    ctx.send('mic.set', { muted }).then((r) => {
      if (r.ok) return;
      if (ctx.store.mic) ctx.store.mic.muted = !muted;
      render();
      shake(micEl);
    });
  }

  micEl.addEventListener('click', toggle);
  ctx.on('mic', render);
  return { toggle };
}
