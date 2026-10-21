// The page's ambient light: a ribbon of fine glowing strands drifting and twisting behind
// everything, in the album art's colours. Plain WebGL, drawn small and scaled up (the strands are
// soft, and the tablet's GPU is old). Without WebGL the page keeps the blurred-art glow instead.

const SCALE = 0.5; // drawing pixels per CSS pixel
const MAX_WIDTH = 640;
const FPS = 30;
const BLEND_MS = 1400; // matches the accent colour's transition in base.css
const MOOD_EASE_MS = 1500;
const LOOP_SECONDS = 240; // every motion repeats exactly in this time, so the phase can wrap

const MOODS = {
  playing: { speed: 1, light: 1 },
  paused: { speed: 0.3, light: 0.5 },
  idle: { speed: 0.25, light: 0.4 },
};

const DEFAULT_PALETTE = [{ h: 225, s: 0.75, l: 0.7 }, { h: 262, s: 0.6, l: 0.66 }, { h: 195, s: 0.6, l: 0.62 }];

// [r, g, b], 0..1
export function hslToRgb({ h, s, l }) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export function mixPalette(from, to, t) {
  const u = Math.min(1, Math.max(0, t));
  return from.map((c, i) => c.map((v, j) => v + (to[i][j] - v) * u));
}

export function moodFor(name) {
  return MOODS[name] || MOODS.idle;
}

export function shouldAnimate({ hidden, asleep, reducedMotion }) {
  return !hidden && !asleep && !reducedMotion;
}

export function canvasSize(cssWidth, cssHeight, scale, maxWidth) {
  const s = Math.min(scale, cssWidth ? maxWidth / cssWidth : scale);
  return [Math.max(1, Math.round(cssWidth * s)), Math.max(1, Math.round(cssHeight * s))];
}

export function frameDue(now, last, fps) {
  return now - last >= 1000 / fps - 1; // a millisecond of slack for rAF jitter
}

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// Every time term is a whole multiple of the phase T (0..2π over LOOP_SECONDS), so wrapping T
// is seamless and the float stays small enough for mediump GPUs.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_phase;
uniform float u_light;
uniform vec3 u_c0, u_c1, u_c2;

const int WIRES = 28;
const float WIDTH = 0.22;   // the ribbon, face-on
const float LINE = 0.0026;  // one strand's core

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float T = u_phase;
  float a = -0.36; // the ribbon runs from lower left to upper right
  vec2 p = vec2(cos(a) * uv.x - sin(a) * uv.y, sin(a) * uv.x + cos(a) * uv.y);
  float x = p.x;

  float centre = 0.14 * sin(0.9 * x + 23.0 * T) + 0.07 * sin(1.7 * x - 15.0 * T + 1.3) - 0.03;
  float twist = 2.4 * x + 19.0 * T + 0.8 * sin(0.7 * x - 8.0 * T);
  float spread = WIDTH * cos(twist);
  float facing = abs(sin(twist)); // 1 face-on, 0 edge-on

  vec3 colour = vec3(0.0);
  for (int i = 0; i < WIRES; i++) {
    float f = float(i) / float(WIRES - 1);
    float wobble = 0.006 * sin(9.0 * f + 3.0 * x + 11.0 * T);
    float d = abs(p.y - centre - (f - 0.5) * spread - wobble);
    float core = exp(-(d * d) / (LINE * LINE));
    float h = d / (6.0 * LINE);
    float halo = 0.05 / (1.0 + h * h);
    float k = 0.5 + 0.5 * sin(6.2832 * (0.5 * f + 0.12 * x) + 2.0 * T);
    vec3 c = mix(mix(u_c0, u_c1, k), u_c2, 0.5 + 0.5 * sin(twist + 3.0 * f));
    colour += c * (core * (0.35 + 0.25 * facing) + halo);
  }

  float side = 0.45 + 0.55 * smoothstep(-0.9, 0.6, uv.x); // calmer behind the tiles on the left
  vec3 lit = 1.0 - exp(-colour * u_light * side);
  gl_FragColor = vec4(lit, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function setup(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one triangle covers the screen
  const pos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  const u = (name) => gl.getUniformLocation(program, name);
  return { res: u('u_res'), phase: u('u_phase'), light: u('u_light'), c: [u('u_c0'), u('u_c1'), u('u_c2')] };
}

const toRgb = (palette) => (palette || DEFAULT_PALETTE).slice(0, 3).map(hslToRgb);

export function initRibbons(ctx) {
  const canvas = ctx.$('ribbons');
  const gl = canvas && canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  let uniforms = null;
  try { uniforms = gl && setup(gl); } catch (e) { console.warn('ribbons:', e.message); }
  if (!uniforms) return { setPalette() {}, setMood() {} };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const blend = { from: toRgb(null), to: toRgb(null), start: 0 };
  const mood = { from: moodFor('idle'), to: moodFor('idle'), start: 0 };
  let phase = 0;
  let raf = 0;
  let lastFrame = -Infinity;
  let lastTime = 0;

  function current(now) {
    const colours = mixPalette(blend.from, blend.to, reduced.matches ? 1 : (now - blend.start) / BLEND_MS);
    const t = reduced.matches ? 1 : Math.min(1, (now - mood.start) / MOOD_EASE_MS);
    const m = { speed: mood.from.speed + (mood.to.speed - mood.from.speed) * t, light: mood.from.light + (mood.to.light - mood.from.light) * t };
    return { colours, mood: m };
  }

  function draw(now) {
    const { colours, mood: m } = current(now);
    gl.uniform2f(uniforms.res, canvas.width, canvas.height);
    gl.uniform1f(uniforms.phase, phase);
    gl.uniform1f(uniforms.light, m.light);
    colours.forEach((c, i) => gl.uniform3fv(uniforms.c[i], c));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return m;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!frameDue(now, lastFrame, FPS)) return;
    lastFrame = now;
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    const m = draw(now);
    phase = (phase + (dt * m.speed * 2 * Math.PI) / LOOP_SECONDS) % (2 * Math.PI);
  }

  function animating() {
    return shouldAnimate({ hidden: document.hidden, asleep: !!(ctx.sleep && ctx.sleep.isAsleep()), reducedMotion: reduced.matches });
  }

  function sync() {
    const run = animating();
    if (run && !raf) {
      lastTime = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (!run) draw(performance.now()); // one still frame (reduced motion, or what shows on waking)
  }

  function resize() {
    [canvas.width, canvas.height] = canvasSize(window.innerWidth, window.innerHeight, SCALE, MAX_WIDTH);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (!raf) draw(performance.now());
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    document.body.classList.remove('ribbons');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      uniforms = setup(gl);
      document.body.classList.add('ribbons');
      resize();
      sync();
    } catch (e) { console.warn('ribbons:', e.message); }
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  setInterval(sync, 1000); // the sleep cover has no event

  document.body.classList.add('ribbons');
  resize();
  sync();

  return {
    // Up to three { h, s, l } colours from the album art; null for the default colours.
    setPalette(palette) {
      const now = performance.now();
      const next = toRgb(palette && palette.length ? palette : null);
      blend.from = current(now).colours;
      blend.to = next;
      blend.start = now;
      if (!raf) draw(now);
    },
    // 'playing', 'paused' or 'idle'
    setMood(name) {
      const next = moodFor(name);
      if (next === mood.to) return;
      const now = performance.now();
      mood.from = current(now).mood;
      mood.to = next;
      mood.start = now;
      if (!raf) draw(now);
    },
  };
}
