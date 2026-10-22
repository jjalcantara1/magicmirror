import "./maskFace.css";
import type { Effect, Face, FaceState, Mood } from "./face.ts";

// Original design in the spirit of the Queen's magic mirror: a pale mask with glowing eyes, floating
// in smoke. Brows, lids, eyes, cheeks, lips and head all move, so the mirror can grin, wink and gasp.
const EYE_X = [-36, 36]; // viewer's left eye, viewer's right eye
const EYE_Y = -14;
const EYE_W = 23; // half the width of an eye
const LID_TOP = -19; // curve height of the upper edge of an open eye
const LID_BOTTOM = 13; // curve height of the lower edge of an open eye
const MOUTH_Y = 63;
const f = (x: number) => x.toFixed(1);

const curve = (cx: number, h: number) => `M${cx - EYE_W},${EYE_Y} C${cx - 13},${f(EYE_Y + h)} ${cx + 13},${f(EYE_Y + h)} ${cx + EYE_W},${EYE_Y}`;
// The part of the eye between the lids.
const opening = (cx: number, up: number, down: number) => `${curve(cx, up)} C${cx + 13},${f(EYE_Y + down)} ${cx - 13},${f(EYE_Y + down)} ${cx - EYE_W},${EYE_Y}Z`;
// The socket shadow is an ellipse path; the open part of the eye is cut out of it, so the lids are shaded too.
const socketPath = (cx: number) => `M${cx - 36},${EYE_Y + 2} A36,27 0 1,0 ${cx + 36},${EYE_Y + 2} A36,27 0 1,0 ${cx - 36},${EYE_Y + 2}Z`;

const eye = (cx: number, i: number) => `
    <g clip-path="url(#mm-eye-${i})">
      <rect x="${cx - 27}" y="${EYE_Y - 18}" width="54" height="34" fill="#0c1917"/>
      <g class="iris"><circle r="11.5" fill="url(#mm-iris)"/><circle r="4.2" fill="#0a2a24"/><circle cx="-3.6" cy="-3.9" r="2.2" fill="#fff"/></g>
    </g>
    <path class="lid-up" fill="url(#mm-skin)"/>
    <path class="lid-low" fill="url(#mm-skin)"/>
    <path class="socket" fill="url(#mm-socket)" fill-rule="evenodd"/>
    <path class="crease" fill="none" stroke="#7d958e" stroke-width="1.4" stroke-linecap="round" opacity="0.5"/>
    <path class="lash" fill="none" stroke="#38554f" stroke-width="2.6" stroke-linecap="round"/>`;

const SVG = `
<svg class="mask" viewBox="-120 -195 240 335" aria-hidden="true">
  <defs>
    <radialGradient id="mm-skin" cx="0" cy="-35" r="150" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f7f4ed"/>
      <stop offset="0.55" stop-color="#dfe5de"/>
      <stop offset="1" stop-color="#8eaaa2"/>
    </radialGradient>
    <radialGradient id="mm-iris">
      <stop offset="0" stop-color="#f4fffc"/>
      <stop offset="0.35" stop-color="#7cf5d8"/>
      <stop offset="0.85" stop-color="#1fb894"/>
      <stop offset="1" stop-color="#0a5a4a"/>
    </radialGradient>
    <radialGradient id="mm-socket">
      <stop offset="0" stop-color="#2d5c54" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#2d5c54" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mm-hollow">
      <stop offset="0" stop-color="#2d5c54" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#2d5c54" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mm-blush">
      <stop offset="0" stop-color="#f08aa8" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#f08aa8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mm-lip" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b3a9b0"/>
      <stop offset="1" stop-color="#93868f"/>
    </linearGradient>
    <linearGradient id="mm-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3b8"/>
      <stop offset="1" stop-color="#d39a2b"/>
    </linearGradient>
    <clipPath id="mm-eye-0"><path d="${opening(EYE_X[0], LID_TOP, LID_BOTTOM)}"/></clipPath>
    <clipPath id="mm-eye-1"><path d="${opening(EYE_X[1], LID_TOP, LID_BOTTOM)}"/></clipPath>
    <clipPath id="mm-mouth"><path class="cavity-clip"/></clipPath>
  </defs>
  <g class="crown">
    <path d="M-58,-140 L-66,-180 L-36,-154 L-19,-190 L0,-158 L19,-190 L36,-154 L66,-180 L58,-140 Z" fill="url(#mm-gold)"/>
    <circle cx="0" cy="-150" r="6" fill="#5ff2d0"/>
    <circle cx="-34" cy="-147" r="4" fill="#e9608a"/>
    <circle cx="34" cy="-147" r="4" fill="#e9608a"/>
  </g>
  <g class="head">
    <path d="M0,-130 C67,-130 95,-77 93,-12 C91,53 57,113 0,125 C-57,113 -91,53 -93,-12 C-95,-77 -67,-130 0,-130 Z" fill="url(#mm-skin)"/>
    <g fill="none" stroke="#5fae9c" stroke-width="1.6" stroke-linecap="round" opacity="0.55">
      <path d="M0,-110 C-10,-97 -27,-99 -31,-87 C-35,-75 -21,-71 -15,-79"/>
      <path d="M0,-110 C10,-97 27,-99 31,-87 C35,-75 21,-71 15,-79"/>
      <path d="M-71,10 C-63,30 -47,30 -45,46 C-43,58 -57,60 -59,52"/>
      <path d="M71,10 C63,30 47,30 45,46 C43,58 57,60 59,52"/>
    </g>
    <ellipse cx="-66" cy="50" rx="22" ry="36" fill="url(#mm-hollow)"/>
    <ellipse cx="66" cy="50" rx="22" ry="36" fill="url(#mm-hollow)"/>
    <ellipse class="blush" cx="-52" cy="30" rx="17" ry="10" fill="url(#mm-blush)"/>
    <ellipse class="blush" cx="52" cy="30" rx="17" ry="10" fill="url(#mm-blush)"/>
    <path d="M-2,-10 C-6,12 -12,26 -10,32 C-4,36 4,36 10,32" stroke="#a7b7b1" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <g fill="none" stroke="#8fa8a1" stroke-width="1.6" stroke-linecap="round">
      <path class="cheek-line"/>
      <path class="cheek-line"/>
    </g>
    ${eye(EYE_X[0], 0)}
    ${eye(EYE_X[1], 1)}
    <path class="brow" fill="#5f7d76" stroke="#5f7d76" stroke-width="1.5" stroke-linejoin="round"/>
    <path class="brow" fill="#5f7d76" stroke="#5f7d76" stroke-width="1.5" stroke-linejoin="round"/>
    <path class="lip-up" fill="url(#mm-lip)"/>
    <path class="lip-low" fill="url(#mm-lip)"/>
    <path class="cavity" fill="#071311" stroke="#2c4a44" stroke-width="1.8" stroke-linejoin="round"/>
    <g clip-path="url(#mm-mouth)">
      <path class="teeth" fill="#e6f4ef"/>
      <ellipse class="tongue" ry="7" fill="#9a6170"/>
    </g>
  </g>
</svg>`;

// Each pose is a set of targets for the face rig. L and R are as the viewer sees them.
const POSE_KEYS = ["browL", "browR", "slantL", "slantR", "lidL", "lidR", "lowL", "lowR", "smile", "smirk", "jaw", "shape", "blush", "lookX", "lookY", "tilt"] as const;
type Pose = Record<(typeof POSE_KEYS)[number], number>;
// brow: -1 low .. 1 high. slant: + inner ends up (kind), - inner ends down (cheeky). lid: upper lid
// closed 0..1. low: lower lid up 0..1 (smiling eyes). smile, smirk, shape: -1..1. jaw: open with no
// sound 0..1. look: -1..1. tilt: degrees.
const CALM: Pose = { browL: 0.2, browR: 0.2, slantL: 0.1, slantR: 0.1, lidL: 0.15, lidR: 0.15, lowL: 0.12, lowR: 0.12, smile: 0.3, smirk: 0, jaw: 0, shape: 0, blush: 0, lookX: 0, lookY: 0, tilt: 0 };
const pose = (p: Partial<Pose>): Pose => ({ ...CALM, ...p });

const STATE_POSE: Record<FaceState, Pose> = {
  asleep: pose({ browL: -0.1, browR: -0.1, lidL: 1, lidR: 1, lowL: 0, lowR: 0, smile: 0.15 }),
  waking: pose({ browL: 0.9, browR: 0.9, slantL: 0.2, slantR: 0.2, lidL: 0, lidR: 0, lowL: 0, lowR: 0, smile: 0.2, jaw: 0.3, shape: -0.6 }),
  listening: pose({ browL: 0.35, browR: 0.3, lidL: 0.08, lidR: 0.08, smile: 0.35, tilt: 3 }),
  thinking: pose({ browL: 0.8, browR: -0.1, slantL: 0, slantR: -0.3, lidL: 0.25, lidR: 0.35, smile: 0.05, smirk: -0.4, shape: -0.5, lookX: -0.7, lookY: -0.8, tilt: -4 }),
  speaking: pose({ browL: 0.3, browR: 0.3, lowL: 0.18, lowR: 0.18, smile: 0.4 }),
};

const MOOD_POSE: Record<Mood, Pose> = {
  happy: pose({ browL: 0.45, browR: 0.45, slantL: 0.15, slantR: 0.15, lidL: 0.1, lidR: 0.1, lowL: 0.42, lowR: 0.42, smile: 0.9, blush: 0.35 }),
  laugh: pose({ browL: 0.6, browR: 0.6, slantL: 0.3, slantR: 0.3, lidL: 0.3, lidR: 0.3, lowL: 1, lowR: 1, smile: 1, jaw: 0.35, shape: 0.3, blush: 0.5 }),
  surprised: pose({ browL: 1, browR: 1, slantL: 0.2, slantR: 0.2, lidL: 0, lidR: 0, lowL: 0, lowR: 0, smile: 0, jaw: 0.6, shape: -0.8 }),
  sly: pose({ browL: 0.95, browR: -0.35, slantL: -0.2, slantR: -0.6, lidL: 0.45, lidR: 0.5, lowL: 0.2, lowR: 0.2, smile: 0.55, smirk: 0.8, lookX: 0.6, tilt: 4 }),
  wink: pose({ browL: 0.5, browR: 0.2, slantL: 0.15, slantR: 0, lidL: 0.1, lidR: 0.1, lowL: 0.4, lowR: 0.4, smile: 0.85, smirk: 0.4, blush: 0.25, tilt: 3 }),
  spooky: pose({ browL: -0.3, browR: -0.3, slantL: -0.9, slantR: -0.9, lidL: 0.3, lidR: 0.3, lowL: 0.2, lowR: 0.2, smile: 0.9, jaw: 0.14, shape: 0.7 }),
  gentle: pose({ browL: 0.3, browR: 0.3, slantL: 0.7, slantR: 0.7, lidL: 0.25, lidR: 0.25, lowL: 0.25, lowR: 0.25, smile: 0.45, blush: 0.2, tilt: 6 }),
};

// Smoke speed and brightness for each state.
const SMOKE: Record<FaceState, { speed: number; alpha: number }> = {
  asleep: { speed: 0.35, alpha: 0.22 },
  waking: { speed: 2.2, alpha: 0.9 },
  listening: { speed: 1, alpha: 0.65 },
  thinking: { speed: 3, alpha: 0.85 },
  speaking: { speed: 1.2, alpha: 0.7 },
};
const TAU = Math.PI * 2;
const FRAME_MS = 33; // ~30 fps: the laptop also runs the voice

const clamp = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function browPath(side: number, raise: number, slant: number): string {
  const up = raise * 11;
  const iy = -42 - up - slant * 10;
  const my = -53 - up - slant * 2;
  const oy = -42 - up * 0.75 + slant * 4;
  const ix = side * 14;
  const mx = side * 37;
  const ox = side * 61;
  return `M${ix},${f(iy - 3.6)} Q${mx},${f(my - 4.2)} ${ox},${f(oy - 0.6)} Q${mx},${f(my + 3)} ${ix},${f(iy + 3.6)}Z`;
}

type Puff = { a: number; r: number; y: number; size: number; spin: number; rise: number; sprite: number };
type Spark = { x: number; y: number; life: number; size: number };

function sprite(rgb: string, size = 64): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgb(${rgb} / 0.9)`);
  grad.addColorStop(0.4, `rgb(${rgb} / 0.35)`);
  grad.addColorStop(1, `rgb(${rgb} / 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function newPuff(anywhere: boolean): Puff {
  return {
    a: Math.random() * TAU,
    r: 0.26 + Math.random() * 0.32,
    y: anywhere ? Math.random() : 1.1,
    size: 0.2 + Math.random() * 0.25,
    spin: (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.22),
    rise: 0.015 + Math.random() * 0.035,
    sprite: Math.random() < 0.6 ? 0 : 1,
  };
}

export function createMaskFace(root: HTMLElement): Face {
  root.classList.add("mirror");
  root.innerHTML = `<canvas class="smoke"></canvas><div class="halo"></div>${SVG}`;
  const canvas = root.querySelector<HTMLCanvasElement>(".smoke")!;
  const ctx = canvas.getContext("2d")!;
  const flash = document.querySelector<HTMLDivElement>("#flash")!;
  const one = <T extends Element>(cls: string) => root.querySelector<T>(cls)!;
  const all = (cls: string) => [...root.querySelectorAll<SVGElement>(cls)];
  const head = one<SVGGElement>(".head");
  const brows = all(".brow");
  const irises = all(".iris");
  const lidsUp = all(".lid-up");
  const lidsLow = all(".lid-low");
  const lashes = all(".lash");
  const sockets = all(".socket");
  const creases = all(".crease");
  const blushes = all(".blush");
  const cheekLines = all(".cheek-line");
  const lipUp = one<SVGPathElement>(".lip-up");
  const lipLow = one<SVGPathElement>(".lip-low");
  const cavity = one<SVGPathElement>(".cavity");
  const cavityClip = one<SVGPathElement>(".cavity-clip");
  const teeth = one<SVGPathElement>(".teeth");
  const tongue = one<SVGEllipseElement>(".tongue");
  const puffSprites = [sprite("70 230 190"), sprite("40 170 200")];
  const sparkSprite = sprite("255 240 190", 32);

  const puffs = Array.from({ length: 36 }, () => newPuff(true));
  let sparks: Spark[] = [];
  let smoke = SMOKE.asleep;
  let burst = 0;
  let last = performance.now();
  const timers = new Map<string, number>();

  let state: FaceState = "asleep";
  let mood: Mood | undefined;
  const rig: Pose = { ...STATE_POSE.asleep };
  let mouthTarget = 0;
  let shapeTarget = 0;
  let speech = 0; // smoothed mouth level from the voice
  let speechShape = 0;
  let speechAvg = 0; // slow average, to find the stressed syllables
  let browPop = 0; // eyebrows jump on stressed syllables
  let nod = 0;
  let nextBeat = 0;
  let blinkAt = -1;
  let nextBlink = 2;
  let winkUntil = 0;
  let glanceX = 0;
  let glanceY = 0;
  let nextGlance = 0;

  function flag(cls: string, ms: number) {
    root.classList.add(cls);
    clearTimeout(timers.get(cls));
    timers.set(cls, window.setTimeout(() => root.classList.remove(cls), ms));
  }

  function addSparks(n: number, cy = 0.45, spread = 0.3) {
    for (let i = 0; i < n; i++) {
      sparks.push({ x: 0.5 + (Math.random() - 0.5) * spread, y: cy + (Math.random() - 0.5) * spread, life: 1 + Math.random(), size: 0.01 + Math.random() * 0.02 });
    }
  }

  function animateFace(t: number, dt: number) {
    const target = { ...(mood ? MOOD_POSE[mood] : STATE_POSE[state]) };
    const lively = state === "listening" || state === "speaking";
    if (lively && t > nextGlance) {
      glanceX = (Math.random() - 0.5) * 0.7;
      glanceY = (Math.random() - 0.5) * 0.4;
      nextGlance = t + 1.2 + Math.random() * 2.3;
      if (state === "listening" && Math.random() < 0.2) browPop = 0.45; // a curious eyebrow flick
    }
    if (lively) {
      target.lookX += glanceX;
      target.lookY += glanceY;
    }
    if (state === "thinking") {
      target.smirk += Math.sin(t * 2.6) * 0.35; // "hmm" lips
      target.lookX += Math.sin(t * 0.9) * 0.25;
    }
    if (mood === "wink" && t < winkUntil) {
      target.lidR = 0.3;
      target.lowR = 1;
    }
    const k = 1 - Math.exp(-dt * 7);
    for (const key of POSE_KEYS) rig[key] = lerp(rig[key], target[key], k);

    speech = lerp(speech, mouthTarget, 1 - Math.exp(-dt * (mouthTarget > speech ? 30 : 14)));
    speechShape = lerp(speechShape, shapeTarget, 1 - Math.exp(-dt * 12));
    speechAvg = lerp(speechAvg, speech, 1 - Math.exp(-dt * 3));
    if (speech - speechAvg > 0.22 && t > nextBeat) {
      browPop = 0.25 + Math.random() * 0.25;
      nod = 1.5 + Math.random() * 2;
      nextBeat = t + 0.35;
    }
    browPop *= Math.exp(-dt * 4);
    nod *= Math.exp(-dt * 5);

    if (t > nextBlink) {
      blinkAt = t;
      nextBlink = t + (Math.random() < 0.15 ? 0.35 : 2 + Math.random() * 4);
    }
    const phase = (t - blinkAt) / 0.18;
    const blink = state === "asleep" || phase >= 1 ? 0 : phase < 0.4 ? phase / 0.4 : 1 - (phase - 0.4) / 0.6;

    const sway = state === "speaking" ? Math.sin(t * 1.3) * 1.5 : Math.sin(t * 0.6) * 0.8;
    const bounce = mood === "laugh" && state === "speaking" ? -Math.abs(Math.sin(t * 9)) * 3 : 0;
    head.setAttribute("transform", `translate(0 ${f(nod + bounce)}) rotate(${f(rig.tilt + sway)} 0 20)`);

    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const cx = EYE_X[i];
      brows[i].setAttribute("d", browPath(side, (i ? rig.browR : rig.browL) + browPop, i ? rig.slantR : rig.slantL));

      // The upper lid comes down and the lower lid comes up. Where they meet, the closed eye is a
      // sleepy curve (upper lid wins) or a happy arc (lower lid wins).
      const lid = Math.max(i ? rig.lidR : rig.lidL, blink);
      const low = i ? rig.lowR : rig.lowL;
      let up = lerp(LID_TOP, LID_BOTTOM, lid);
      let down = lerp(LID_BOTTOM, LID_TOP, low);
      if (up >= down) up = down = lerp(LID_BOTTOM, LID_TOP, low / (lid + low));
      lidsUp[i].setAttribute("d", `${curve(cx, up)} L${cx + 27},${EYE_Y - 26} L${cx - 27},${EYE_Y - 26}Z`);
      lidsLow[i].setAttribute("d", `${curve(cx, down)} L${cx + 27},${EYE_Y + 18} L${cx - 27},${EYE_Y + 18}Z`);
      sockets[i].setAttribute("d", `${socketPath(cx)} ${opening(cx, up, down)}`);
      lashes[i].setAttribute("d", curve(cx, up));
      creases[i].setAttribute("d", curve(cx, up - 8));
      irises[i].setAttribute("transform", `translate(${f(cx + clamp(rig.lookX) * 8)} ${f(EYE_Y + clamp(rig.lookY) * 5)})`);
      blushes[i].setAttribute("opacity", f(rig.blush));
    }

    // Mouth: the voice opens it and shapes it; the pose sets the smile.
    const open = clamp(rig.jaw + speech * (1 - rig.jaw * 0.6), 0, 1);
    const shape = lerp(rig.shape, clamp(rig.shape * 0.4 + speechShape), Math.min(1, speech * 4));
    const round = Math.max(0, -shape);
    const w = 26 + Math.max(0, shape) * 6 - round * 10 + Math.max(0, rig.smile) * 2;
    const dx = rig.smirk * 3;
    const lx = dx - w;
    const rx = dx + w;
    const ly = MOUTH_Y - rig.smile * 8 + rig.smirk * 3;
    const ry = MOUTH_Y - rig.smile * 8 - rig.smirk * 8;
    const kx = 0.55 + round * 0.4; // fuller curves make an O when the lips round
    const c1 = f(dx - w * kx);
    const c2 = f(dx + w * kx);
    const mid = MOUTH_Y + rig.smile * 2; // the middle stays while the corners move
    const upY = mid - open * 3;
    const loY = mid + open * 30;
    const L = `${f(lx)},${f(ly)}`;
    const R = `${f(rx)},${f(ry)}`;
    const upperInner = `C${c1},${f(upY)} ${c2},${f(upY)} ${R}`;
    const lowerInnerBack = `C${c2},${f(loY)} ${c1},${f(loY)} ${L}`;
    const hole = `M${L} ${upperInner} ${lowerInnerBack}Z`;
    lipUp.setAttribute(
      "d",
      `M${L} C${f(dx - w * 0.6)},${f(upY - 10)} ${f(dx - 7)},${f(upY - 12)} ${f(dx)},${f(upY - 9)} ` +
        `C${f(dx + 7)},${f(upY - 12)} ${f(dx + w * 0.6)},${f(upY - 10)} ${R} C${c2},${f(upY)} ${c1},${f(upY)} ${L}Z`,
    );
    lipLow.setAttribute("d", `M${L} C${c1},${f(loY + 10)} ${c2},${f(loY + 10)} ${R} ${lowerInnerBack}Z`);
    cavity.setAttribute("d", hole);
    cavityClip.setAttribute("d", hole);
    const tooth = 7 - round * 3.5;
    teeth.setAttribute("d", `M${L} ${upperInner} L${f(rx)},${f(ry + tooth)} C${c2},${f(upY + tooth)} ${c1},${f(upY + tooth)} ${f(lx)},${f(ly + tooth)}Z`);
    tongue.setAttribute("cx", f(dx));
    tongue.setAttribute("cy", f(0.25 * (ly + ry) * 0.5 + 0.75 * loY - 2));
    tongue.setAttribute("rx", f(w * 0.55));

    // Smile lines from the nose to the mouth corners.
    const lines = Math.max(0, rig.smile - 0.4) * 0.8;
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const cx = i ? rx : lx;
      const cy = i ? ry : ly;
      cheekLines[i].setAttribute("d", `M${side * 17},34 Q${f(cx + side * 8)},${f(cy - 10)} ${f(cx + side * 4)},${f(cy + 2)}`);
      cheekLines[i].setAttribute("opacity", f(lines));
    }
  }

  function drawSmoke(now: number, dt: number) {
    // Half resolution: the puffs are soft, so nobody can see the difference.
    const w = Math.floor(innerWidth / 2);
    const h = Math.floor(innerHeight / 2);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    const m = Math.min(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    burst = Math.max(0, burst - dt * 0.6);
    const speed = smoke.speed * (1 + burst * 2);
    for (const p of puffs) {
      p.a += p.spin * dt * speed;
      p.y -= p.rise * dt * speed;
      if (p.y < -0.15) Object.assign(p, newPuff(false));
      const x = w / 2 + Math.cos(p.a) * p.r * m;
      const y = h / 2 + Math.sin(p.a) * p.r * m * 0.45 + (p.y - 0.5) * h;
      const size = p.size * m * (1 + burst);
      const edgeFade = Math.min(1, (1.1 - p.y) * 3, (p.y + 0.15) * 3);
      ctx.globalAlpha = Math.min(1, smoke.alpha * (1 + burst)) * edgeFade * 0.55;
      ctx.drawImage(puffSprites[p.sprite], x - size / 2, y - size / 2, size, size);
    }
    sparks = sparks.filter((s) => (s.life -= dt * 0.8) > 0);
    for (const s of sparks) {
      const size = s.size * m * (0.6 + 0.4 * Math.sin(now / 90 + s.x * 50));
      ctx.globalAlpha = Math.min(1, s.life);
      ctx.drawImage(sparkSprite, s.x * w - size / 2, (s.y - (1 - s.life) * 0.05) * h - size / 2, size, size);
    }
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dtMs = now - last;
    if (dtMs < FRAME_MS) return;
    last = now;
    const dt = Math.min(dtMs, 100) / 1000;
    animateFace(now / 1000, dt);
    drawSmoke(now, dt);
  }
  requestAnimationFrame(frame);

  return {
    setState(next) {
      state = next;
      root.dataset.state = next;
      smoke = SMOKE[next];
      if (next !== "speaking") mood = undefined;
      if (next === "waking") burst = 1.2; // the mirror appears in a gust of smoke
    },
    setMouth(open, shape) {
      mouthTarget = open;
      shapeTarget = shape;
    },
    setMood(next) {
      mood = next;
      if (next === "wink") winkUntil = performance.now() / 1000 + 0.7;
    },
    effect(name: Effect) {
      switch (name) {
        case "sparkle":
          addSparks(45);
          break;
        case "thunder":
          flash.classList.remove("on");
          void flash.offsetWidth; // restart the CSS animation
          flash.classList.add("on");
          burst = 0.8;
          break;
        case "smoke":
          burst = 1.5;
          break;
        case "glow":
          flag("fx-glow", 2500);
          break;
        case "crown":
          flag("fx-crown", 5000);
          addSparks(25, 0.12, 0.25);
          break;
      }
    },
  };
}
