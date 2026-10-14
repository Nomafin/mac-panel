// The Spotify panel, and the album art as the page's only light: its glow and accent colour.
import { makeThrottle } from './util.js';

const DEFAULT_ACCENT = '#9db4ff';
const PROGRESS_TICK_MS = 250;

export function formatTime(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const s = total % 60;
  return Math.floor(total / 60) + ':' + (s < 10 ? '0' : '') + s;
}

// Position now, given the state received at `receivedAt` (client clock; Mac and tablet clocks differ).
export function estimatePosition(sp, receivedAt, now) {
  if (!sp || !sp.track) return 0;
  const base = sp.positionMs || 0;
  if (sp.state !== 'playing') return base;
  return Math.min(base + Math.max(0, now - receivedAt), sp.track.durationMs || Infinity);
}

export function seekFraction(clientX, rect) {
  if (!rect.width) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

// [hue 0–360, saturation 0–1, lightness 0–1]
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

// The album's accent: the hue family with the most saturated mid-tone weight, lifted so it
// reads on black. Returns null for greyscale art.
export function pickAccent(rgba) {
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, x: 0, y: 0, s: 0 }));
  const pixelCount = rgba.length / 4;
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const [hue, sat, light] = rgbToHsl(rgba[i], rgba[i + 1], rgba[i + 2]);
    const w = sat * (1 - Math.abs(light - 0.5) * 1.6);
    if (w <= 0.05) continue;
    const b = buckets[Math.floor(hue / 30) % 12];
    const rad = (hue * Math.PI) / 180;
    b.w += w; b.x += Math.cos(rad) * w; b.y += Math.sin(rad) * w; b.s += sat * w;
    total += w;
  }
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w === 0 || total / pixelCount < 0.02) return null;
  let hue = (Math.atan2(best.y, best.x) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { h: hue, s: Math.min(0.85, Math.max(0.45, best.s / best.w)), l: 0.68 };
}

export function accentCss(a) {
  return `hsl(${Math.round(a.h)} ${Math.round(a.s * 100)}% ${Math.round(a.l * 100)}%)`;
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.3"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><rect x="5" y="6" width="2.4" height="12" rx="1"/><path d="M19 7.1v9.8a.9.9 0 0 1-1.4.75l-7.6-4.9a.9.9 0 0 1 0-1.5l7.6-4.9A.9.9 0 0 1 19 7.1z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><rect x="16.6" y="6" width="2.4" height="12" rx="1"/><path d="M5 7.1v9.8a.9.9 0 0 0 1.4.75l7.6-4.9a.9.9 0 0 0 0-1.5L6.4 6.35A.9.9 0 0 0 5 7.1z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6C14.3 16 15.5 17 17.5 17H21"/><path d="M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M14.3 8.4C15.1 7.5 16.1 7 17.5 7H21"/><path d="m18.5 4.5 2.5 2.5-2.5 2.5M18.5 14.5l2.5 2.5-2.5 2.5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19"/><path d="m16 3 3 3-3 3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5"/><path d="m8 21-3-3 3-3"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.3 3.6a.8.8 0 0 0 1.3-.6V5.5a.8.8 0 0 0-1.3-.6L8 8.5H5a1 1 0 0 0-1 1z"/><path d="M16.5 8.8a4.5 4.5 0 0 1 0 6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};


export function initMusic(ctx) {
  const { $, store } = ctx;
  const root = document.documentElement;
  const shell = $('shell');
  const spEl = $('spotify');
  const glows = [$('glow-a'), $('glow-b')];

  spEl.innerHTML = `
    <div class="sp-full">
      <div class="art-wrap" id="art-wrap">
        <img class="art" id="art-a" alt="" crossorigin="anonymous">
        <img class="art" id="art-b" alt="" crossorigin="anonymous">
      </div>
      <div class="meta" id="sp-meta">
        <div class="title" id="sp-title"></div>
        <div class="artist" id="sp-artist"></div>
        <div class="album" id="sp-album"></div>
      </div>
      <div class="scrub" id="sp-progress" aria-label="Seek">
        <div class="rail"><div class="fill" id="sp-fill"></div></div>
        <div class="times"><span id="sp-pos">0:00</span><span id="sp-dur">0:00</span></div>
      </div>
      <div class="transport">
        <button class="btn toggle" data-cmd="shuffle" id="sp-shuffle" aria-label="Shuffle">${ICONS.shuffle}</button>
        <button class="btn" data-cmd="previous" aria-label="Previous track">${ICONS.prev}</button>
        <button class="btn play" data-cmd="playpause" id="sp-play" aria-label="Play or pause">${ICONS.play}</button>
        <button class="btn" data-cmd="next" aria-label="Next track">${ICONS.next}</button>
        <button class="btn toggle" data-cmd="repeat" id="sp-repeat" aria-label="Repeat">${ICONS.repeat}</button>
      </div>
      <label class="volume">${ICONS.speaker}<input type="range" min="0" max="100" step="1" id="sp-vol" aria-label="Spotify volume"></label>
    </div>
    <div class="sp-idle">
      <p>Nothing playing in Spotify.</p>
      <button class="btn play" data-cmd="playpause" aria-label="Play">${ICONS.play}</button>
    </div>`;

  const arts = [$('art-a'), $('art-b')];
  const artWrap = $('art-wrap'), meta = $('sp-meta');
  const titleEl = $('sp-title'), artistEl = $('sp-artist'), albumEl = $('sp-album');
  const progEl = $('sp-progress'), fillEl = $('sp-fill'), posEl = $('sp-pos'), durEl = $('sp-dur');
  const playBtn = $('sp-play'), shuffleBtn = $('sp-shuffle'), repeatBtn = $('sp-repeat'), volEl = $('sp-vol');
  let volDragging = false;
  let volReleaseTimer = null;
  let shownTrackId = null;
  let shownArtUrl = null;
  let front = 0; // which art/glow layer is visible

  function setAccent(color) {
    root.style.setProperty('--accent', color || DEFAULT_ACCENT);
  }

  function sampleAccent(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 24, 24);
        const accent = pickAccent(g.getImageData(0, 0, 24, 24).data);
        if (url === shownArtUrl) setAccent(accent && accentCss(accent));
      } catch (_) { setAccent(null); }
    };
    img.onerror = () => setAccent(null);
    img.src = url;
  }

  // Track change: the one orchestrated moment. Art, ambient light and accent cross-fade together.
  function showArt(url) {
    if (url === shownArtUrl) return;
    shownArtUrl = url;
    const next = 1 - front;
    const img = arts[next];
    const reveal = () => {
      if (shownArtUrl !== url) return;
      arts[front].classList.remove('front');
      glows[front].classList.remove('on');
      img.classList.add('front');
      glows[next].style.backgroundImage = url ? `url("${url}")` : 'none';
      glows[next].classList.add('on');
      front = next;
    };
    if (!url) {
      img.removeAttribute('src');
      reveal();
      setAccent(null);
      return;
    }
    img.onload = reveal;
    img.onerror = reveal;
    img.src = url;
    sampleAccent(url);
  }

  function retitle(t) {
    titleEl.textContent = t.name;
    artistEl.textContent = t.artist;
    albumEl.textContent = t.album;
    meta.classList.remove('swap');
    void meta.offsetWidth; // restart the entrance
    meta.classList.add('swap');
  }

  function renderSpotify() {
    const sp = store.spotify;
    const running = !!(sp && sp.running);
    const hasTrack = running && sp.state !== 'stopped' && !!sp.track;
    shell.classList.toggle('no-spotify', !running);
    spEl.classList.toggle('idle', running && !hasTrack);
    document.body.classList.toggle('playing', hasTrack && sp.state === 'playing');
    document.body.classList.toggle('has-music', hasTrack);
    if (!hasTrack) {
      glows.forEach((g) => g.classList.remove('on'));
      shownArtUrl = null;
      shownTrackId = null;
      setAccent(null);
      return;
    }

    const t = sp.track;
    if (t.id !== shownTrackId) {
      shownTrackId = t.id;
      retitle(t);
    }
    showArt(t.artworkUrl || '');
    durEl.textContent = formatTime(t.durationMs);
    playBtn.innerHTML = sp.state === 'playing' ? ICONS.pause : ICONS.play;
    shuffleBtn.classList.toggle('on', !!sp.shuffle);
    repeatBtn.classList.toggle('on', !!sp.repeat);
    if (!volDragging) setVolume(sp.volume);
    tickProgress();
  }

  function setVolume(v) {
    volEl.value = v;
    volEl.style.setProperty('--v', v + '%');
  }

  function tickProgress() {
    const sp = store.spotify;
    if (!sp || !sp.track) return;
    const pos = estimatePosition(sp, store.spotifyAt, Date.now());
    const dur = sp.track.durationMs;
    fillEl.style.transform = `scaleX(${dur ? Math.min(1, pos / dur) : 0})`;
    posEl.textContent = formatTime(pos);
  }
  setInterval(tickProgress, PROGRESS_TICK_MS);

  spEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    const sp = store.spotify;
    if (!btn || !sp) return;
    const cmd = btn.dataset.cmd;
    if (cmd === 'playpause' && sp.track) { // optimistic
      sp.positionMs = estimatePosition(sp, store.spotifyAt, Date.now());
      store.spotifyAt = Date.now();
      sp.state = sp.state === 'playing' ? 'paused' : 'playing';
    } else if (cmd === 'shuffle') {
      sp.shuffle = !sp.shuffle;
    } else if (cmd === 'repeat') {
      sp.repeat = !sp.repeat;
    }
    renderSpotify();
    ctx.send('spotify.' + cmd);
  });

  progEl.addEventListener('pointerdown', (e) => {
    const sp = store.spotify;
    if (!sp || !sp.track || !sp.track.durationMs) return;
    const ms = Math.round(seekFraction(e.clientX, progEl.getBoundingClientRect()) * sp.track.durationMs);
    sp.positionMs = ms;
    store.spotifyAt = Date.now();
    tickProgress();
    ctx.send('spotify.seek', { ms });
  });

  const sendVolume = makeThrottle((value) => ctx.send('spotify.volume', { value }), 100);
  volEl.addEventListener('input', () => {
    volDragging = true;
    clearTimeout(volReleaseTimer);
    setVolume(Number(volEl.value));
    sendVolume(Number(volEl.value));
  });
  volEl.addEventListener('change', () => {
    const value = Number(volEl.value);
    if (store.spotify) store.spotify.volume = value;
    ctx.send('spotify.volume', { value });
    volReleaseTimer = setTimeout(() => { volDragging = false; }, 1000);
  });

  ctx.on('spotify', renderSpotify);
}
