// The sketch pad: draw or sign with a finger, then put it on the Mac's clipboard as an image.
import { shake } from './util.js';

const INK_WIDTH = 3.5;
const CROP_MARGIN = 12;
const EXPORT_SCALE = 2; // a crisp paste on Retina screens

// The drawn area plus a margin, in the pad's coordinates; null when nothing is drawn.
export function strokeBounds(strokes, margin) {
  const points = strokes.flat();
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - margin;
  const y = Math.min(...ys) - margin;
  return { x, y, w: Math.max(...xs) + margin - x, h: Math.max(...ys) + margin - y };
}

export function initPad(ctx) {
  const padEl = ctx.$('pad');
  const padCtx = padEl.getContext('2d');
  const padHint = ctx.$('pad-hint');
  const padToast = ctx.$('pad-toast');
  const strokes = [];
  let stroke = null;
  let padFrame = 0;

  function drawStrokes(g, list, color) {
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = INK_WIDTH;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const pts of list) {
      if (pts.length === 1) {
        g.beginPath();
        g.arc(pts[0].x, pts[0].y, INK_WIDTH / 2, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      // Smooth the finger's path: curve through the midpoints between samples.
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        g.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
      }
      const last = pts[pts.length - 1];
      g.lineTo(last.x, last.y);
      g.stroke();
    }
  }

  function redrawPad() {
    padFrame = 0;
    const dpr = window.devicePixelRatio || 1;
    padCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    padCtx.clearRect(0, 0, padEl.width, padEl.height);
    drawStrokes(padCtx, strokes, '#eeeaf4');
    padHint.hidden = strokes.length > 0;
  }

  function sizePad() {
    const dpr = window.devicePixelRatio || 1;
    padEl.width = Math.round(padEl.clientWidth * dpr);
    padEl.height = Math.round(padEl.clientHeight * dpr);
    redrawPad();
  }

  const padPoint = (e) => ({ x: e.offsetX, y: e.offsetY });
  padEl.addEventListener('pointerdown', (e) => {
    padEl.setPointerCapture(e.pointerId);
    stroke = [padPoint(e)];
    strokes.push(stroke);
    redrawPad();
  });
  padEl.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    events.forEach((ev) => stroke.push(padPoint(ev)));
    if (!padFrame) padFrame = requestAnimationFrame(redrawPad);
  });
  const endStroke = () => { stroke = null; };
  padEl.addEventListener('pointerup', endStroke);
  padEl.addEventListener('pointercancel', endStroke);

  ctx.$('pad-undo').addEventListener('click', () => { strokes.pop(); redrawPad(); });
  ctx.$('pad-clear').addEventListener('click', () => { strokes.length = 0; redrawPad(); });

  function padMessage(text) {
    padToast.textContent = text;
    padToast.hidden = false;
    padToast.classList.remove('show');
    void padToast.offsetWidth;
    padToast.classList.add('show');
  }

  // Black ink on transparent, cropped to the drawing, at 2× for a crisp paste.
  ctx.$('pad-copy').addEventListener('click', (e) => {
    const b = strokeBounds(strokes, CROP_MARGIN);
    if (!b) { shake(e.currentTarget); return; }
    const scale = EXPORT_SCALE;
    const out = document.createElement('canvas');
    out.width = Math.round(b.w * scale);
    out.height = Math.round(b.h * scale);
    const g = out.getContext('2d');
    g.setTransform(scale, 0, 0, scale, -b.x * scale, -b.y * scale);
    drawStrokes(g, strokes, '#000');
    const png = out.toDataURL('image/png').split(',')[1];
    ctx.send('pad.copy', { png }).then((r) => padMessage(r.ok ? 'Copied — paste it on the Mac' : 'Couldn\'t copy to the Mac'));
  });

  window.addEventListener('resize', () => { if (ctx.pages.current() === 2) sizePad(); });
  return { show: sizePad };
}
