// The Mac's QR scanner window for importing 2FA accounts (opened from the menu bar). It runs in a
// Hammerspoon window, reads QR codes from the webcam with jsQR, and hands the text to Hammerspoon
// through a WebKit message handler, so the secrets never touch the network.

const SCAN_MS = 250;
const SAME_TEXT_MS = 3000; // a code held in view is sent once, not four times a second
const IDLE_MS = 3 * 60000;
const DONE_CLOSE_MS = 3000;
const ERROR_SHOW_MS = 3000;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// progress: null before the first code; then the export being scanned and what it added so far.
// result: Hammerspoon's reply to one code. A part already seen is ignored.
export function trackPart(progress, result) {
  let p = progress;
  if (!p || p.batchId !== result.batchId || p.size !== result.batchSize) {
    p = { batchId: result.batchId, size: result.batchSize, seen: [], imported: 0, duplicates: 0, skipped: 0 };
  }
  if (!p.seen.includes(result.batchIndex)) {
    p = {
      ...p,
      seen: [...p.seen, result.batchIndex],
      imported: p.imported + result.imported,
      duplicates: p.duplicates + result.duplicates,
      skipped: p.skipped + result.skipped,
    };
  }
  return { progress: p, done: p.seen.length >= p.size };
}

export function statusText(progress, done) {
  if (!progress) return 'Hold the export QR code up to the camera';
  if (!done) return `${progress.seen.length} of ${progress.size} parts scanned. Show the next code`;
  const notes = [];
  if (progress.duplicates) notes.push(`${progress.duplicates} already here`);
  if (progress.skipped) notes.push(`${progress.skipped} counter-based skipped`);
  const extra = notes.length ? ` (${notes.join(', ')})` : '';
  if (progress.imported) return `Imported ${plural(progress.imported, 'account')}${extra}`;
  return notes.length ? `No new accounts${extra}` : 'No accounts in this code';
}

export function errorText(error) {
  return {
    not_otp: "That's not an authenticator QR code",
    invalid: "That QR code couldn't be read as a 2FA code",
    keychain_unreadable: "The saved accounts can't be read from the Keychain. See the Hammerspoon console",
    save_failed: "Couldn't save to the Keychain",
  }[error] || 'Import failed';
}

function startScanner() {
  const video = document.getElementById('video');
  const statusEl = document.getElementById('status');
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const post = (msg) => window.webkit.messageHandlers.scan.postMessage(msg);
  let progress = null;
  let finished = false;
  let busy = false;
  let last = { text: '', at: 0 };
  let stream = null;
  let errorTimer = null;
  let idleTimer = null;

  function say(text, kind = '') {
    statusEl.textContent = text;
    statusEl.className = 'status ' + kind;
  }

  function close() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    post({ type: 'close' });
  }

  function keepAlive() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(close, IDLE_MS);
  }

  window.scanResult = (r) => {
    busy = false;
    clearTimeout(errorTimer);
    if (!r.ok) {
      say(errorText(r.error), 'error');
      errorTimer = setTimeout(() => say(statusText(progress, false)), ERROR_SHOW_MS);
      return;
    }
    const t = trackPart(progress, r);
    progress = t.progress;
    keepAlive();
    say(statusText(progress, t.done), t.done ? 'done' : '');
    if (t.done) {
      finished = true;
      setTimeout(close, DONE_CLOSE_MS);
    }
  };

  function scan() {
    if (finished || busy || video.readyState < 2) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    g.drawImage(video, 0, 0, w, h);
    const code = window.jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    if (!code || !code.data) return;
    const now = Date.now();
    if (code.data === last.text && now - last.at < SAME_TEXT_MS) return;
    last = { text: code.data, at: now };
    busy = true;
    post({ type: 'text', text: code.data });
  }

  say(statusText(null, false));
  keepAlive();
  navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } })
    .then((s) => {
      stream = s;
      video.srcObject = s;
      setInterval(scan, SCAN_MS);
    })
    .catch(() => say('No camera access. Allow it in System Settings → Privacy & Security → Camera → Hammerspoon, then try again', 'error'));
}

if (typeof window !== 'undefined' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scan) {
  startScanner();
}
