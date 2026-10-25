import "./maskFace.css";
import type { Effect, Face, FaceState, Mood } from "./face.ts";

// The Queen's magic mirror, drawn for small children: a theatre mask, purple above and lit
// yellow-green from below, with a big grin, floating in smoke. The page fills the screen; the
// real mirror frame is round the screen.
// Brows, lids, eyes, cheeks, lips and head all move, so the mirror can grin, wink and gasp.
const f = (x: number) => x.toFixed(1);

// The mask, its back light and the smoke share these viewBox units, centred on the screen.
const VIEWBOX = "-150 -205 300 410";
const VB_H = 410;
// The glass is the whole screen. resize() sets its half width and half height in viewBox units.
const GLASS = { cy: 0, rx: 118, ry: 166 };
// The mask is drawn in its own units (about 186 wide, 243 tall) and scaled into the glass.
const MASK_PLACE = "translate(0 4) scale(0.83)";

const EYE_X = [-46, 46]; // viewer's left eye, viewer's right eye
const EYE_Y = -20;
const EYE_W = 24; // half the width of an eye
const LID_TOP = -30; // curve height of the upper edge of an open eye
const LID_BOTTOM = 12; // curve height of the lower edge of an open eye
const MOUTH_Y = 66;

// Concave top with corners pointing up and out, high cheekbones, a broad jaw and a broad, rounded chin.
const MASK =
  "M-93,-120 C-62,-101 -31,-96 0,-96 C31,-96 62,-101 93,-120 " +
  "C92,-96 84,-56 82,-34 C82,-24 86,-18 86,-6 C86,14 74,52 64,78 C52,104 30,125 0,126 " +
  "C-30,125 -52,104 -64,78 C-74,52 -86,14 -86,-6 C-86,-18 -82,-24 -82,-34 C-84,-56 -92,-96 -93,-120Z";
// The dark inside edge of the mask, seen along the dipped top.
const TOP_RIM = "M-93,-120 C-62,-101 -31,-96 0,-96 C31,-96 62,-101 93,-120 C62,-97 31,-90 0,-90 C-31,-90 -62,-97 -93,-120Z";
// Purple runs down from the forehead between the brows and narrows to a rounded point just above
// the nose tip.
const NOSE_BAND = "M-16,-140 L16,-140 L16,-60 C15,-38 12,-12 9,6 C7,18 4,27 0,31 C-4,27 -7,18 -9,6 C-12,-12 -15,-38 -16,-60Z";

const curve = (cx: number, h: number) =>
  `M${cx - EYE_W},${EYE_Y} C${cx - 12},${f(EYE_Y + h)} ${cx + 12},${f(EYE_Y + h)} ${cx + EYE_W},${EYE_Y}`;
// The part of the eye between the lids.
const opening = (cx: number, up: number, down: number) =>
  `${curve(cx, up)} C${cx + 12},${f(EYE_Y + down)} ${cx - 12},${f(EYE_Y + down)} ${cx - EYE_W},${EYE_Y}Z`;
// A lid covers the eye from its edge to a little past the open eye's edge, so no dark fringe shows.
const lid = (cx: number, h: number, edge: number) =>
  `${curve(cx, h)} L${cx + EYE_W + 2},${EYE_Y} C${cx + 12},${f(EYE_Y + edge)} ${cx - 12},${f(EYE_Y + edge)} ${cx - EYE_W - 2},${EYE_Y}Z`;
// Purple ring round the eye, as on the mask in the film. The open eye is cut out of it.
// It rides up with the lower lid, so a smiling eye has a crescent under it, not a pool.
const socketPath = (cx: number, side: number, lift: number) => {
  const x = cx + side * 2;
  const y = EYE_Y - 2 + lift;
  return `M${x - 36},${y} A36,25 0 1,0 ${x + 36},${y} A36,25 0 1,0 ${x - 36},${y}Z`;
};
// A thick dark upper lid, thin at the ends.
function lashPath(cx: number, side: number, up: number): string {
  const ix = cx - side * EYE_W;
  const ox = cx + side * EYE_W;
  const a = cx - side * 12;
  const b = cx + side * 12;
  return (
    `M${ix},${EYE_Y} C${a},${f(EYE_Y + up + 1.5)} ${b},${f(EYE_Y + up + 1.5)} ${ox},${EYE_Y} ` +
    `L${f(ox + side)},${f(EYE_Y - 1)} C${b + side * 2},${f(EYE_Y + up - 7)} ${a},${f(EYE_Y + up - 5)} ${ix},${EYE_Y}Z`
  );
}

// A star with n points, outer radius r1 and inner radius r2, centred on 0,0.
function starPath(n: number, r1: number, r2: number): string {
  let d = "";
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? r2 : r1;
    d += `${i ? "L" : "M"}${f(r * Math.cos(a))},${f(r * Math.sin(a))}`;
  }
  return `${d}Z`;
}
const HEART = "M0,7.5 C-3,5 -10,1 -10,-3.5 C-10,-7 -7,-9 -4.5,-9 C-2.2,-9 -0.6,-7.6 0,-5.8 C0.6,-7.6 2.2,-9 4.5,-9 C7,-9 10,-7 10,-3.5 C10,1 3,5 0,7.5Z";

// Dark eyes with a soft spark that looks around. Excited eyes get stars, loving eyes get hearts.
const eye = (cx: number, i: number) => `
      <g clip-path="url(#bm-eye-${i})">
        <rect x="${cx - 26}" y="${EYE_Y - 26}" width="52" height="40" fill="url(#bm-hole)"/>
        <g class="iris">
          <circle r="8" fill="url(#bm-iris)"/>
          <g class="g-spark">
            <path d="M3,-8 l1,2.8 2.8,1 -2.8,1 -1,2.8 -1,-2.8 -2.8,-1 2.8,-1Z" fill="#fff"/>
            <circle cx="-3.6" cy="3.4" r="1.3" fill="#fff"/>
          </g>
          <path class="g-star" d="${starPath(5, 13, 5.4)}" fill="#fff4b8" stroke="#ffc94a" stroke-width="1" stroke-linejoin="round"/>
          <g class="g-heart">
            <path d="${HEART}" fill="#ffb84a" stroke="#ffe9a8" stroke-width="0.8"/>
            <ellipse cx="-4.6" cy="-4.6" rx="2" ry="1.3" fill="#fff" opacity="0.9"/>
          </g>
        </g>
      </g>
      <path class="lid-up" fill="url(#bm-skin)"/>
      <path class="lid-low" fill="url(#bm-skin)"/>
      <path class="socket" fill="url(#bm-socket)" fill-rule="evenodd"/>
      <path class="lid-line" fill="none" stroke="#2b1a4c" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/>
      <path class="crease" fill="none" stroke="#55459a" stroke-width="3" stroke-linecap="round" opacity="0.35"/>
      <path class="lash" fill="#1c0f30"/>`;

const MASK_SVG = `
<svg class="mask" viewBox="${VIEWBOX}" aria-hidden="true">
  <defs>
    <radialGradient id="bm-skin" cx="0" cy="40" r="150" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e4ea8e"/>
      <stop offset="0.32" stop-color="#d5db76"/>
      <stop offset="0.58" stop-color="#c9cf68"/>
      <stop offset="0.82" stop-color="#a9b34a"/>
      <stop offset="1" stop-color="#8e9a3d"/>
    </radialGradient>
    <radialGradient id="bm-purple" cx="0" cy="-72" r="115" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7464b8"/>
      <stop offset="0.45" stop-color="#5a4a8e"/>
      <stop offset="0.8" stop-color="#463780"/>
      <stop offset="1" stop-color="#3d2f6b"/>
    </radialGradient>
    <radialGradient id="bm-temple">
      <stop offset="0.35" stop-color="#43357a"/>
      <stop offset="1" stop-color="#43357a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bm-socket">
      <stop offset="0.45" stop-color="#4e3d96" stop-opacity="0.97"/>
      <stop offset="0.72" stop-color="#4e3d96" stop-opacity="0.88"/>
      <stop offset="0.87" stop-color="#4e3d96" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#4e3d96" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bm-shade" cx="0" cy="12" r="135" gradientUnits="userSpaceOnUse">
      <stop offset="0.66" stop-color="#3a2a5a" stop-opacity="0"/>
      <stop offset="1" stop-color="#3a2a5a" stop-opacity="0.45"/>
    </radialGradient>
    <radialGradient id="bm-light">
      <stop offset="0" stop-color="#f3f6b4" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#f3f6b4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bm-lilac">
      <stop offset="0" stop-color="#9a8ad0" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#9a8ad0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bm-olive">
      <stop offset="0" stop-color="#76822c" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#76822c" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bm-nostril">
      <stop offset="0" stop-color="#55601a" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#55601a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bm-blush">
      <stop offset="0" stop-color="#ffb55c" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffb55c" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bm-hole" cx="0.5" cy="0.6" r="0.6">
      <stop offset="0" stop-color="#34205e"/>
      <stop offset="1" stop-color="#0a0416"/>
    </radialGradient>
    <radialGradient id="bm-iris">
      <stop offset="0" stop-color="#fffbe8"/>
      <stop offset="0.5" stop-color="#fffbe8" stop-opacity="0.95"/>
      <stop offset="0.65" stop-color="#f2eecb" stop-opacity="0.45"/>
      <stop offset="0.85" stop-color="#e4e0ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bm-aura">
      <stop offset="0.6" stop-color="#b9a0ff" stop-opacity="0.28"/>
      <stop offset="0.8" stop-color="#9d80f0" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#9d80f0" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bm-rim" x1="0" y1="-120" x2="0" y2="123" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#d8c8ff"/>
      <stop offset="0.4" stop-color="#a890f0"/>
      <stop offset="0.6" stop-color="#e2ec90"/>
      <stop offset="1" stop-color="#f4f8c0"/>
    </linearGradient>
    <linearGradient id="bm-lip-up" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9a8656"/>
      <stop offset="1" stop-color="#73653a"/>
    </linearGradient>
    <linearGradient id="bm-lip-low" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#857548"/>
      <stop offset="1" stop-color="#a99a5e"/>
    </linearGradient>
    <linearGradient id="bm-teeth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e4def0"/>
    </linearGradient>
    <clipPath id="bm-clip"><path d="${MASK}"/></clipPath>
    <clipPath id="bm-eye-0"><path d="${opening(EYE_X[0], LID_TOP, LID_BOTTOM)}"/></clipPath>
    <clipPath id="bm-eye-1"><path d="${opening(EYE_X[1], LID_TOP, LID_BOTTOM)}"/></clipPath>
    <clipPath id="bm-mouth"><path class="cavity-clip"/></clipPath>
  </defs>
  <g class="rig">
  <ellipse cx="0" cy="6" rx="102" ry="132" fill="url(#bm-aura)"/>
  <g transform="${MASK_PLACE}">
    <g class="head">
      <path d="${MASK}" fill="none" stroke="url(#bm-rim)" stroke-width="10" stroke-opacity="0.14" stroke-linejoin="round"/>
      <path d="${MASK}" fill="none" stroke="url(#bm-rim)" stroke-width="5" stroke-opacity="0.3" stroke-linejoin="round"/>
      <path d="${MASK}" fill="url(#bm-skin)"/>
      <ellipse cx="-52" cy="-50" rx="26" ry="12" fill="url(#bm-light)" opacity="0.75"/>
      <ellipse cx="52" cy="-50" rx="26" ry="12" fill="url(#bm-light)" opacity="0.75"/>
      <ellipse cx="-56" cy="20" rx="28" ry="16" transform="rotate(-18 -56 20)" fill="url(#bm-light)" opacity="0.75"/>
      <ellipse cx="56" cy="20" rx="28" ry="16" transform="rotate(18 56 20)" fill="url(#bm-light)" opacity="0.75"/>
      <ellipse cx="0" cy="104" rx="26" ry="16" fill="url(#bm-light)" opacity="0.8"/>
      <ellipse cx="-62" cy="54" rx="14" ry="32" transform="rotate(-30 -62 54)" fill="url(#bm-olive)"/>
      <ellipse cx="62" cy="54" rx="14" ry="32" transform="rotate(30 62 54)" fill="url(#bm-olive)"/>
      <ellipse cx="0" cy="47" rx="16" ry="6" fill="url(#bm-olive)"/>
      <g clip-path="url(#bm-clip)">
        <ellipse cx="-98" cy="-14" rx="30" ry="64" fill="url(#bm-temple)"/>
        <ellipse cx="98" cy="-14" rx="30" ry="64" fill="url(#bm-temple)"/>
        <path d="${NOSE_BAND}" fill="url(#bm-purple)"/>
        <ellipse cx="0" cy="8" rx="7" ry="22" fill="url(#bm-lilac)"/>
        <path class="brow" fill="url(#bm-purple)"/>
        <path class="brow" fill="url(#bm-purple)"/>
        <path class="brow-line" fill="#22153f"/>
        <path class="brow-line" fill="#22153f"/>
        <path d="${MASK}" fill="url(#bm-shade)"/>
      </g>
      <ellipse cx="0" cy="38" rx="10" ry="7" fill="url(#bm-light)"/>
      <ellipse cx="-7.5" cy="44.5" rx="4.5" ry="2.6" fill="url(#bm-nostril)"/>
      <ellipse cx="7.5" cy="44.5" rx="4.5" ry="2.6" fill="url(#bm-nostril)"/>
      ${eye(EYE_X[0], 0)}
      ${eye(EYE_X[1], 1)}
      <ellipse class="blush" cx="-56" cy="30" rx="18" ry="11" fill="url(#bm-blush)"/>
      <ellipse class="blush" cx="56" cy="30" rx="18" ry="11" fill="url(#bm-blush)"/>
      <path class="cheek-line" fill="none" stroke="#7d8a2e" stroke-width="2.2" stroke-linecap="round"/>
      <path class="cheek-line" fill="none" stroke="#7d8a2e" stroke-width="2.2" stroke-linecap="round"/>
      <path d="${TOP_RIM}" fill="#1b1335"/>
      <path d="${MASK}" fill="none" stroke="url(#bm-rim)" stroke-width="1" stroke-opacity="0.45"/>
      <path class="lip-up" fill="url(#bm-lip-up)"/>
      <path class="lip-low" fill="url(#bm-lip-low)"/>
      <path class="cavity" fill="#1e0818" stroke="#3a1230" stroke-width="1.6" stroke-linejoin="round"/>
      <g clip-path="url(#bm-mouth)">
        <ellipse class="tongue" ry="9" fill="#d0607e"/>
        <path class="teeth" fill="url(#bm-teeth)"/>
      </g>
      <g class="twink" opacity="0">
        <circle r="10" fill="url(#bm-light)"/>
        <path d="M0,-13 L2.2,-2.2 13,0 2.2,2.2 0,13 -2.2,2.2 -13,0 -2.2,-2.2Z" fill="#fffbe2"/>
      </g>
    </g>
  </g>
  </g>
</svg>`;

// A soft back light behind the mask.
const BACKLIGHT_SVG = `
<svg class="backlight" viewBox="${VIEWBOX}" aria-hidden="true">
  <defs>
    <radialGradient id="bg-halo">
      <stop offset="0.5" stop-color="#a888f0" stop-opacity="0.45"/>
      <stop offset="0.75" stop-color="#8460d0" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#7a54c8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bg-halo-hot">
      <stop offset="0.45" stop-color="#eaff9e" stop-opacity="0.8"/>
      <stop offset="0.72" stop-color="#bdf072" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#bdf072" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse class="halo" cx="0" cy="4" rx="112" ry="148" fill="url(#bg-halo)"/>
</svg>`;

const TAU = Math.PI * 2;
const FRAME_MS = 33; // ~30 fps: the laptop also runs the voice

const clamp = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// 0 -> 1 -> 0 between a and b.
const bump = (u: number, a: number, b: number) => (u <= a || u >= b ? 0 : 0.5 - 0.5 * Math.cos(((u - a) / (b - a)) * TAU));
// Rises over 0..a, holds, falls over b..1.
const env = (u: number, a: number, b: number) => Math.min(smooth(u / a), smooth((1 - u) / (1 - b)));
// An eased curve through flat [u, value, u, value, ...] keys.
function keys(u: number, k: readonly number[]): number {
  if (u <= k[0]) return k[1];
  for (let i = 2; i < k.length; i += 2) {
    if (u < k[i]) return lerp(k[i - 1], k[i + 1], smooth((u - k[i - 2]) / (k[i] - k[i - 2])));
  }
  return k[k.length - 1];
}
// Like clamp, but eases into the limits, so stacked motions round off instead of sticking flat.
function soft(x: number, lo: number, hi: number): number {
  const m = (hi - lo) * 0.15;
  if (x > hi - m) return hi - m + m * Math.tanh((x - hi + m) / m);
  if (x < lo + m) return lo + m - m * Math.tanh((lo + m - x) / m);
  return x;
}
// A blink: quick to close, slower to open.
function blinkCurve(s: number, dur = 0.18): number {
  const p = s / dur;
  return p <= 0 || p >= 1 ? 0 : p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
}

// Each pose is a set of targets for the face rig. L and R are as the viewer sees them.
const POSE_KEYS = ["browL", "browR", "slantL", "slantR", "lidL", "lidR", "lowL", "lowR", "smile", "smirk", "jaw", "shape", "blush", "lookX", "lookY", "tilt", "hx", "hy", "scale", "squash"] as const;
type Key = (typeof POSE_KEYS)[number];
type Pose = Record<Key, number>;
// brow: -1 low .. 1 high. slant: + inner ends up (kind), - inner ends down (cheeky). lid: upper lid
// closed 0..1. low: lower lid up 0..1 (smiling eyes). smile, smirk, shape: -1..1. jaw: open with no
// sound 0..1. look: -1..1. tilt: degrees. hx, hy: head shift in viewBox units. scale: head size - 1.
// squash: + wider and shorter, - taller and thinner.
const CALM: Pose = { browL: 0.2, browR: 0.2, slantL: 0.1, slantR: 0.1, lidL: 0.15, lidR: 0.15, lowL: 0.12, lowR: 0.12, smile: 0.35, smirk: 0, jaw: 0, shape: 0, blush: 0, lookX: 0, lookY: 0, tilt: 0, hx: 0, hy: 0, scale: 0, squash: 0 };
const pose = (p: Partial<Pose>): Pose => ({ ...CALM, ...p });
const IDX = Object.fromEntries(POSE_KEYS.map((k, i) => [k, i])) as Record<Key, number>;

// Every key follows its target on a spring: [frequency in Hz, damping]. Damping below 1 overshoots
// a little, so a new expression pops and settles like a cartoon.
const SPRINGS: Record<Key, readonly [number, number]> = {
  browL: [3.2, 0.42], browR: [3.2, 0.42], slantL: [3, 0.5], slantR: [3, 0.5],
  lidL: [6, 0.8], lidR: [6, 0.8], lowL: [4.5, 0.65], lowR: [4.5, 0.65],
  smile: [3, 0.5], smirk: [2.6, 0.55], jaw: [5, 0.5], shape: [4, 0.6], blush: [1.2, 1],
  lookX: [5.5, 0.72], lookY: [5.5, 0.72], tilt: [1.8, 0.45],
  hx: [2, 0.5], hy: [2.4, 0.38], scale: [2.6, 0.4], squash: [4, 0.3],
};
const STIFF = POSE_KEYS.map((k) => (TAU * SPRINGS[k][0]) ** 2);
const DAMP = POSE_KEYS.map((k) => 2 * SPRINGS[k][1] * TAU * SPRINGS[k][0]);
// What can be drawn. Lids, lips and squash stop hard at their limits; the rest ease in (SOFT).
const LIMIT: Record<Key, readonly [number, number]> = {
  browL: [-1, 1.5], browR: [-1, 1.5], slantL: [-1, 1], slantR: [-1, 1], lidL: [0, 1], lidR: [0, 1], lowL: [0, 1], lowR: [0, 1],
  smile: [-1, 1.1], smirk: [-1, 1], jaw: [0, 1], shape: [-1, 1], blush: [0, 1], lookX: [-1.1, 1.1], lookY: [-1.1, 1.1],
  tilt: [-9, 9], hx: [-8, 8], hy: [-12, 14], scale: [-0.2, 0.15], squash: [-0.08, 0.08],
};
const SOFT = POSE_KEYS.map((k) => /^(brow|look|tilt|hx|hy|scale)/.test(k));

// Grins keep their teeth without a jaw opening, so lip sync can close the mouth between syllables.
const STATE_POSE: Record<FaceState, Pose> = {
  // Asleep, the mask sinks back into the glass, so waking can grow it in gently.
  asleep: pose({ browL: -0.1, browR: -0.1, lidL: 1, lidR: 1, lowL: 0, lowR: 0, smile: 0.2, tilt: -3, hy: 4, scale: -0.12 }),
  waking: pose({ browL: 0.9, browR: 0.9, slantL: 0.25, slantR: 0.25, lidL: 0, lidR: 0, lowL: 0.15, lowR: 0.15, smile: 1, jaw: 0.3, shape: 0.5, blush: 0.3 }),
  listening: pose({ browL: 0.35, browR: 0.3, lidL: 0.08, lidR: 0.08, lowL: 0.2, lowR: 0.2, smile: 0.72, tilt: 2 }),
  thinking: pose({ browL: 0.85, browR: -0.1, slantL: 0, slantR: -0.3, lidL: 0.05, lidR: 0.12, smile: 0.4, smirk: -0.2, shape: -0.7, lookX: -0.55, lookY: -0.65, tilt: -2 }),
  speaking: pose({ browL: 0.3, browR: 0.3, lowL: 0.18, lowR: 0.18, smile: 0.5 }),
};

const MOOD_POSE: Record<Mood, Pose> = {
  happy: pose({ browL: 0.5, browR: 0.5, slantL: 0.2, slantR: 0.2, lidL: 0, lidR: 0, lowL: 0.62, lowR: 0.62, smile: 0.95, blush: 0.45 }),
  laugh: pose({ browL: 0.6, browR: 0.6, slantL: 0.3, slantR: 0.3, lidL: 0.3, lidR: 0.3, lowL: 1, lowR: 1, smile: 1, jaw: 0.3, shape: 0.3, blush: 0.5 }),
  surprised: pose({ browL: 1, browR: 1, slantL: 0.25, slantR: 0.25, lidL: 0, lidR: 0, lowL: 0, lowR: 0, smile: 0.05, jaw: 0.7, shape: -0.85, hy: -1.5, scale: 0.01 }),
  sly: pose({ browL: 0.95, browR: -0.35, slantL: -0.2, slantR: -0.6, lidL: 0.45, lidR: 0.5, lowL: 0.2, lowR: 0.2, smile: 0.7, smirk: 0.8, lookX: 0.6, tilt: 2 }),
  wink: pose({ browL: 0.5, browR: 0.2, slantL: 0.15, slantR: 0, lidL: 0.05, lidR: 0.05, lowL: 0.4, lowR: 0.4, smile: 0.85, smirk: 0.4, blush: 0.35, tilt: 1.5 }),
  // Spooky is a giggly ghost: narrow eyes and a toothy grin, but level brows, as V brows read as a villain.
  spooky: pose({ browL: 0.15, browR: 0.15, slantL: 0.05, slantR: 0.05, lidL: 0.25, lidR: 0.25, lowL: 0.32, lowR: 0.32, smile: 0.9, smirk: 0.3, jaw: 0.1, shape: 0.7, blush: 0.2, hy: 2 }),
  gentle: pose({ browL: 0.3, browR: 0.3, slantL: 0.3, slantR: 0.3, lidL: 0.05, lidR: 0.05, lowL: 0.5, lowR: 0.5, smile: 0.65, blush: 0.4, tilt: 2 }),
  excited: pose({ browL: 0.85, browR: 0.85, slantL: 0.3, slantR: 0.3, lidL: 0, lidR: 0, lowL: 0.08, lowR: 0.08, smile: 1, jaw: 0.25, shape: 0.5, blush: 0.35 }),
  love: pose({ browL: 0.45, browR: 0.45, slantL: 0.5, slantR: 0.5, lidL: 0, lidR: 0, lowL: 0.1, lowR: 0.1, smile: 0.75, blush: 0.75, tilt: 1 }),
};

// Smoke speed and brightness, and new green wisps per second, for each state.
const SMOKE: Record<FaceState, { speed: number; alpha: number; flames: number }> = {
  asleep: { speed: 0.35, alpha: 0.25, flames: 0 },
  waking: { speed: 2.2, alpha: 0.9, flames: 60 },
  listening: { speed: 1, alpha: 0.7, flames: 18 },
  thinking: { speed: 3, alpha: 0.85, flames: 30 },
  speaking: { speed: 1.2, alpha: 0.75, flames: 22 },
};

// What a performance draws besides the pose keys: a blink, and the twinkle beside a winking eye.
type Direct = Pose & { blink: number; twinkle: number };
// A short performance. u is its progress 0..1 and s the seconds since it started. It adds to the
// spring targets (o), so a step pops and settles, or straight to the drawn face (d), so a bounce
// keeps its rhythm. Every curve starts and ends at 0, so performances can overlap and stop (the
// wake starts where the head is).
type Run = (u: number, s: number, o: Pose, d: Direct) => void;
type Perf = readonly [seconds: number, run: Run];

const WINK_LID = [0, 0, 0.12, 1, 0.55, 1, 0.75, 0];
const WINK: Perf = [1.1, (u, _s, o, d) => {
  const e = keys(u, WINK_LID);
  o.lidR += 1.2 * e;
  o.lowR += 0.5 * e;
  o.browR -= 0.3 * e;
  o.browL += 0.35 * e;
  o.smirk += 0.45 * e;
  o.smile += 0.15 * e;
  o.tilt += 3.5 * env(u, 0.15, 0.7);
  d.hy += 3 * bump(u, 0.1, 0.5); // a little nod with it
  d.twinkle = Math.max(d.twinkle, bump(u, 0.1, 0.8));
}];

// Three "ho"s: the head bounces, shakes a little and the jaw drops on each.
const HOHO: Perf = [0.95, (u, _s, o, d) => {
  const e = env(u, 0.08, 0.8);
  const ho = Math.sin(u * Math.PI * 3);
  const b = Math.abs(ho);
  d.hy -= 3.5 * b * e;
  d.squash += (0.025 - 0.05 * b) * e; // stretch going up, squash at the bottom
  d.jaw += 0.3 * b * e;
  d.tilt += 2 * ho * e;
  o.blush += 0.1 * e;
}];

// A hop: a quick crouch first, stretch on the way up, squash on landing.
const hop = (height: number): Run => (u, _s, o, d) => {
  d.hy += height * (0.3 * bump(u, 0, 0.2) - bump(u, 0.12, 0.68));
  d.squash += 0.03 * bump(u, 0, 0.2) - 0.035 * bump(u, 0.12, 0.42) + 0.04 * bump(u, 0.58, 0.92);
  o.browL += 0.15 * bump(u, 0.1, 0.75);
  o.browR += 0.15 * bump(u, 0.1, 0.75);
};

const BIG_HOP = hop(7);

// A gasp: a tiny crouch, then the head pops bigger and taller and settles (keys in seconds).
const POP_SCALE = [0, 0, 0.08, -0.01, 0.2, 0.04, 0.38, -0.008, 0.56, 0];
const POP_SQUASH = [0, 0, 0.08, 0.025, 0.2, -0.025, 0.34, 0.015, 0.52, 0];
const POP_HY = [0, 0, 0.08, 2, 0.2, -3, 0.4, 0.5, 0.6, 0];
const POP_BROW = [0, 0, 0.08, -0.3, 0.2, 0.3, 0.45, 0];
function pop(s: number, d: Direct) {
  d.scale += keys(s, POP_SCALE);
  d.squash += keys(s, POP_SQUASH);
  d.hy += keys(s, POP_HY);
  const b = keys(s, POP_BROW);
  d.browL += b;
  d.browR += b;
}

// Groucho eyebrows: two quick lifts of both brows.
function groucho(s: number, from: number, d: Direct) {
  const x = s - from;
  if (x <= 0 || x >= 0.8) return;
  const w = 0.6 * Math.max(0, Math.sin(x * TAU * 2.5));
  d.browL += w;
  d.browR += w;
}

// In and out with a soft "aah", eyes going dreamy. The lower lids rise, not the upper ones, so the
// heart glints stay whole.
const SIGH: Perf = [1.8, (u, _s, o, d) => {
  const inhale = bump(u, 0, 0.6);
  const out = bump(u, 0.4, 0.95);
  o.scale += 0.035 * inhale;
  d.hy -= 2.5 * inhale;
  o.browL += 0.25 * inhale;
  o.browR += 0.25 * inhale;
  o.slantL += 0.2 * out;
  o.slantR += 0.2 * out;
  o.jaw += 0.22 * out;
  o.shape -= 0.9 * out;
  o.lowL += 0.12 * bump(u, 0.35, 1);
  o.lowR += 0.12 * bump(u, 0.35, 1);
  d.squash += 0.025 * bump(u, 0.5, 1);
  o.tilt += 2 * env(u, 0.2, 0.7);
}];

// The "ooo" of a silly ghost: lips round, brows up and worried, the head dips and comes back up.
const OOO: Perf = [1.5, (u, _s, o, d) => {
  const e = env(u, 0.2, 0.55);
  o.shape -= 1.6 * e;
  o.smile -= 0.7 * e;
  o.jaw += 0.22 * e;
  o.browL += 0.3 * e;
  o.browR += 0.3 * e;
  o.slantL += 0.5 * e;
  o.slantR += 0.5 * e;
  d.hy += 5 * bump(u, 0, 1);
  o.tilt -= 2 * bump(u, 0, 1);
}];

// When a mood starts: a one-shot entrance.
const MOOD_IN: Record<Mood, Perf> = {
  happy: [0.9, (u, s, o, d) => {
    BIG_HOP(u, s, o, d);
    o.lowL += 0.3 * env(u, 0.1, 0.5);
    o.lowR += 0.3 * env(u, 0.1, 0.5);
    o.blush += 0.35 * bump(u, 0, 1);
  }],
  laugh: [0.7, (u, _s, o, d) => {
    d.hy -= 5 * bump(u, 0, 0.7);
    d.scale += 0.05 * bump(u, 0, 0.6);
    o.tilt -= 4 * bump(u, 0, 1);
  }],
  surprised: [0.9, (u, s, o, d) => {
    pop(s, d);
    o.browL += 0.25 * env(u, 0.05, 0.5);
    o.browR += 0.25 * env(u, 0.05, 0.5);
  }],
  sly: [1.4, (u, s, o, d) => {
    const e = env(u, 0.3, 0.9);
    o.lookX += 0.4 * e;
    o.tilt += 2 * e;
    groucho(s, 0.45, d);
  }],
  wink: WINK,
  spooky: OOO,
  gentle: [1.2, (u, _s, o) => {
    o.tilt += 1.2 * env(u, 0.3, 0.7);
    o.lidL += 0.6 * bump(u, 0.15, 0.75); // a slow soft blink
    o.lidR += 0.6 * bump(u, 0.15, 0.75);
    o.smile += 0.1 * env(u, 0.3, 0.7);
  }],
  excited: [0.8, (u, s, _o, d) => {
    pop(s, d);
    d.hy -= 4 * bump(u, 0.2, 0.75); // and a hop
  }],
  love: SIGH,
};
// Spring kicks (key, speed) at the start of a mood, for a jolt the springs bounce back from.
const MOOD_KICK: Partial<Record<Mood, readonly (readonly [Key, number])[]>> = {
  laugh: [["browL", 8], ["browR", 8]],
  wink: [["tilt", 12]],
};
// While a mood is held, a performance again every few seconds: [first after, every min, every max, performance].
const MOOD_AGAIN: Partial<Record<Mood, readonly [number, number, number, Perf]>> = {
  happy: [2.2, 2.4, 3.4, [0.6, hop(3.5)]],
  laugh: [0.4, 1.4, 1.8, HOHO],
  surprised: [2.6, 2.6, 3.6, [0.6, (u, _s, o, d) => {
    d.scale += 0.03 * bump(u, 0, 0.6);
    d.squash -= 0.02 * bump(u, 0, 0.6);
    o.browL += 0.25 * bump(u, 0, 1);
    o.browR += 0.25 * bump(u, 0, 1);
  }]],
  sly: [2.6, 2.6, 3.6, [0.9, (u, s, o, d) => {
    groucho(s, 0.05, d);
    o.lookX += 0.3 * env(u, 0.2, 0.8);
  }]],
  wink: [3.8, 3.8, 5, WINK],
  spooky: [3.2, 3, 4, OOO],
  excited: [0.7, 0.8, 1.2, [0.55, hop(4)]],
  love: [4.5, 4.5, 6, SIGH],
};
// How big the syllable nods and the talking sway are in each mood: the calm ones move less.
const BEAT: Partial<Record<Mood, number>> = { gentle: 0.4, love: 0.5, spooky: 0.7, laugh: 1.2, excited: 1.2 };
// While a mood is held: slow motion on top of its pose.
function moodHold(m: Mood, t: number, o: Pose) {
  switch (m) {
    case "happy":
      o.tilt += 2.5 * Math.sin(t * 2.2);
      o.blush += 0.12 * Math.sin(t * 3);
      break;
    case "laugh":
      o.hx += 1.5 * Math.sin(t * 1.5);
      break;
    case "surprised":
      o.tilt += 1.5 * Math.sin(t * 1.1);
      break;
    case "sly":
      o.lookX += 0.25 * Math.sin(t * 1.3);
      o.tilt += 1.5 * Math.sin(t * 1.3);
      break;
    case "wink":
      o.tilt += 1.5 * Math.sin(t * 1.4);
      break;
    case "spooky": // a slow "ooo-ooo" figure of eight
      o.hx += 4 * Math.sin(t * 1.4);
      o.tilt += 3.5 * Math.sin(t * 1.4);
      o.hy += 2.5 * Math.sin(t * 2.8 - 1);
      o.lookX += 0.45 * Math.sin(t * 1.4 - 0.6);
      break;
    case "gentle":
      o.tilt += 1.8 * Math.sin(t * 0.9);
      o.hx += 2 * Math.sin(t * 0.9 + 0.5);
      break;
    case "excited":
      o.tilt += 2 * Math.sin(t * 2.6);
      break;
    case "love":
      o.tilt += 3 * Math.sin(t * 1.1);
      o.hx += 2.5 * Math.sin(t * 1.1 + 0.4);
      o.lookY -= 0.15;
      break;
  }
}

// Little things the mirror does while it waits for a child to speak: [how often, performance].
const LOOK_LR = [0, 0, 0.15, -0.95, 0.4, -0.95, 0.55, 0.95, 0.8, 0.95, 1, 0];
const FIDGETS: readonly (readonly [number, Perf])[] = [
  // eyebrow wiggle: left, right, left, right
  [1, [1.4, (u, _s, o) => {
    const l = bump(u, 0, 0.3) + bump(u, 0.5, 0.8);
    const r = bump(u, 0.25, 0.55) + bump(u, 0.75, 1);
    o.browL += 0.85 * l;
    o.browR += 0.85 * r;
    o.slantL -= 0.3 * l;
    o.slantR -= 0.3 * r;
    o.tilt += 3 * (r - l);
    o.smile += 0.15 * env(u, 0.2, 0.8);
  }]],
  // a curious head tilt with one brow up
  [1, [1.9, (u, _s, o) => {
    const e = env(u, 0.2, 0.75);
    o.tilt -= 8 * e;
    o.hx -= 3 * e;
    o.browR += 0.8 * e;
    o.slantR -= 0.25 * e;
    o.browL -= 0.1 * e;
    o.lookX += 0.25 * e;
    o.lookY -= 0.3 * e;
    o.smirk -= 0.2 * e;
  }]],
  // look left and right, as if checking who is there; the head turns with the eyes, so it reads from afar
  [1, [2.1, (u, _s, o) => {
    const x = keys(u, LOOK_LR);
    o.lookX += 1.1 * x;
    o.hx += 7 * x;
    o.tilt -= 5 * x;
    o.browL += 0.2 * Math.abs(x);
    o.browR += 0.2 * Math.abs(x);
  }]],
  // the eyes roll round in a circle, and the head circles with them
  [1, [1.5, (u, _s, o) => {
    const e = env(u, 0.15, 0.85);
    const a = u * TAU;
    o.lookX += 0.9 * Math.sin(a) * e;
    o.lookY -= 0.9 * Math.cos(a) * e;
    o.hx += 3 * Math.sin(a) * e;
    o.hy -= 2.5 * Math.cos(a) * e;
    o.browL += 0.3 * e;
    o.browR += 0.3 * e;
    o.tilt += 3 * Math.sin(a) * e;
  }]],
  // a cheeky side smirk with a glance
  [1, [1.7, (u, _s, o) => {
    const e = env(u, 0.2, 0.8);
    o.smirk += e;
    o.smile += 0.1 * e;
    o.lookX += 0.9 * e;
    o.browL += 0.6 * e;
    o.slantL -= 0.3 * e;
    o.lidL += 0.15 * e;
    o.lidR += 0.25 * e;
    o.tilt += 4 * e;
    o.hx += 2 * e;
  }]],
  // a double blink
  [1, [0.75, (u, s, o, d) => {
    d.blink = Math.max(d.blink, blinkCurve(s), blinkCurve(s - 0.3));
    o.browL += 0.2 * bump(u, 0, 1);
    o.browR += 0.2 * bump(u, 0, 1);
  }]],
  // a little "ooh" pucker, still smiling and blushing so it never looks blank
  [1, [1.4, (u, _s, o) => {
    const e = env(u, 0.2, 0.75);
    o.shape -= 1.4 * e;
    o.jaw += 0.12 * e;
    o.smile -= 0.3 * e;
    o.blush += 0.25 * e;
    o.browL += 0.45 * e;
    o.browR += 0.45 * e;
    o.slantL += 0.2 * e;
    o.slantR += 0.2 * e;
    o.lowL -= 0.1 * e;
    o.lowR -= 0.1 * e;
    o.scale += 0.02 * e;
    o.lookY -= 0.25 * e;
  }]],
  // and now and then a wink
  [0.35, WINK],
];
const FIDGET_WEIGHT = FIDGETS.reduce((sum, [w]) => sum + w, 0);

// The mask grows in gently from its sleeping size with its eyes shut (fast growth would loom at a
// small child), bounces just past full size, then the eyes and brows fly open with a big grin.
// It starts from where the head is (scale, hy), so nothing jumps. Keys in seconds.
const WAKE_BOUNCE = [0, 0, 0.3, 0, 0.6, 0.045, 0.82, -0.01, 1, 0];
const WAKE_SQUASH = [0, 0, 0.12, 0.025, 0.38, -0.03, 0.62, 0.035, 0.82, -0.01, 1, 0];
const WAKE_RISE = [0, 0, 0.3, 0, 0.6, -2.5, 0.85, 0.5, 1.05, 0];
const WAKE_OPEN = 0.55;
// main.ts moves on to thinking 1.2 s after waking, so the entrance fits in that.
const wakeFrom = (scale: number, hy: number): Perf => [1.2, (_u, s, o, d) => {
  const grow = 1 - smooth(s / 0.6);
  d.scale += scale * grow + keys(s, WAKE_BOUNCE);
  d.squash += keys(s, WAKE_SQUASH);
  d.hy += hy * grow + keys(s, WAKE_RISE);
  if (s < WAKE_OPEN) {
    o.lidL += 1;
    o.lidR += 1;
    o.browL -= 1;
    o.browR -= 1;
    o.smile -= 0.6;
    o.jaw -= 0.3;
  }
  d.blink = Math.max(d.blink, blinkCurve(s - WAKE_OPEN - 0.3));
  o.tilt += 4 * bump(s, WAKE_OPEN, 1.2);
}];
// "Hmm": a quick tilt and a brow up as thinking starts.
const HMM: Perf = [0.8, (u, s, o, d) => {
  d.squash += 0.035 * bump(u, 0, 0.4);
  o.tilt -= 3 * env(u, 0.2, 0.6);
  o.browL += 0.35 * bump(u, 0, 0.7);
  d.blink = Math.max(d.blink, blinkCurve(s - 0.05));
}];
// "Your turn": brows up, a little lean and a nod when the mirror stops talking.
const YOUR_TURN: Perf = [0.9, (u, _s, o, d) => {
  o.browL += 0.35 * bump(u, 0, 1);
  o.browR += 0.35 * bump(u, 0, 1);
  o.scale += 0.025 * bump(u, 0, 1);
  o.tilt += 3 * bump(u, 0, 1);
  d.hy += 2 * bump(u, 0.05, 0.4);
}];
// A pleased smile and a nod when the child stops talking.
const PLEASED: Perf = [1.1, (u, _s, o, d) => {
  const e = env(u, 0.15, 0.55);
  o.smile += 0.3 * e;
  o.lowL += 0.4 * e;
  o.lowR += 0.4 * e;
  o.blush += 0.3 * e;
  o.browL += 0.25 * e;
  o.browR += 0.25 * e;
  o.slantL += 0.2 * e;
  o.slantR += 0.2 * e;
  o.tilt += 3 * e;
  d.hy += 3 * bump(u, 0.05, 0.35);
  d.squash += 0.03 * bump(u, 0.05, 0.35);
}];
// "Mm-hmm": a slow nod with a smile on the child's syllables, so they see the mirror is listening.
const MMHMM: Perf = [0.6, (u, _s, o, d) => {
  const n = bump(u, 0, 0.65);
  d.hy += 7 * n;
  d.squash += 0.03 * n; // the face foreshortens as it nods
  o.smile += 0.12 * bump(u, 0, 1);
  o.lowL += 0.15 * bump(u, 0, 1);
  o.lowR += 0.15 * bump(u, 0, 1);
}];
// A quick smile with the eyes while talking; these moods have their own eyes, or star and heart glints it would hide.
const NO_EYE_SMILE: readonly Mood[] = ["laugh", "surprised", "spooky", "sly", "wink", "excited", "love"];
const EYE_SMILE: Perf = [0.7, (u, _s, o) => {
  // Lift the lower lids to a smile, but never shut eyes that already smile.
  o.lowL += Math.max(0, 0.62 - o.lowL) * bump(u, 0, 1);
  o.lowR += Math.max(0, 0.62 - o.lowR) * bump(u, 0, 1);
  o.smile += 0.1 * bump(u, 0, 1);
  o.browL += 0.1 * bump(u, 0, 1);
  o.browR += 0.1 * bump(u, 0, 1);
}];
// Falling asleep: a big cartoon yawn with the eyes squeezed shut, a sleepy peek, then the eyes close
// and the head sinks.
const YAWN_OPEN = [0, 0, 0.3, 1, 0.6, 1, 0.82, 0];
const YAWN_EYES = [0, 0.6, 0.22, 0, 0.62, 0, 0.72, 0.45, 0.9, 0]; // how far the eyes are open
const YAWN_SIZE = [0, 1, 0.75, 1, 1, 0]; // the head keeps its size until it sinks back at the end
const YAWN: Perf = [2.6, (u, _s, o) => {
  const open = keys(u, YAWN_OPEN);
  const awake = keys(u, YAWN_EYES);
  o.jaw += 0.8 * open;
  o.shape -= 0.8 * open;
  o.smile -= 0.1 * open;
  o.lidL -= 0.85 * awake;
  o.lidR -= 0.85 * awake;
  o.lowL += 0.5 * open;
  o.lowR += 0.5 * open;
  o.browL += 0.3 * open;
  o.browR += 0.3 * open;
  o.slantL += 0.25 * open;
  o.slantR += 0.25 * open;
  o.squash -= 0.025 * open;
  o.hy -= 4 * open; // the head tips back
  o.scale += 0.09 * keys(u, YAWN_SIZE) + 0.03 * open;
  o.tilt += 3 * open;
}];

// The lower edge of the purple over each eye is the brow: it rises from the nose and peaks
// above the outer half of the eye, like the mask in the film.
function arch(side: number, raise: number, slant: number) {
  const up = raise * 15;
  // Slant tips the whole arch, so a cheeky or a kind brow reads from across the room.
  const iy = -46 - up - slant * 15;
  const cy1 = -73 - up - slant * 12;
  const cy2 = -73 - up + slant * 4;
  const oy = -32 - up * 0.6 + slant * 6;
  const ix = side * 14;
  const ox = side * 92;
  const a = `M${ix},${f(iy)} C${side * 32},${f(cy1)} ${side * 86},${f(cy2)} ${ox},${f(oy)}`;
  return { a, ix, iy, ox, oy, cy1, cy2 };
}

function browCap(side: number, raise: number, slant: number): string {
  const { a, ix, iy, ox, oy } = arch(side, raise, slant);
  return `${a} L${ox + side * 20},${f(oy)} L${ox + side * 20},-140 L${side * 4},-140 L${side * 4},${f(iy)} L${ix},${f(iy)}Z`;
}

function browLine(side: number, raise: number, slant: number): string {
  const { a, ix, iy, cy1, cy2, ox, oy } = arch(side, raise, slant);
  return `${a} L${ox},${f(oy - 5)} C${side * 86},${f(cy2 - 13)} ${side * 32},${f(cy1 - 13)} ${ix},${f(iy - 7)}Z`;
}

type Puff = { a: number; r: number; y: number; size: number; spin: number; rise: number; sprite: number };
// Positions are in viewBox units, from the centre of the glass box.
type Spark = { x: number; y: number; life: number; size: number };
type Flame = { x: number; y: number; drift: number; age: number; life: number; size: number; sprite: number };
type Twinkle = { x: number; y: number; age: number; life: number; size: number; sprite: number };
type Swirl = { a: number; r: number; spin: number; turn: number; size: number; sprite: number };

function canvas2d(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

function sprite(rgb: string, size = 64): HTMLCanvasElement {
  const [c, g] = canvas2d(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgb(${rgb} / 0.9)`);
  grad.addColorStop(0.4, `rgb(${rgb} / 0.35)`);
  grad.addColorStop(1, `rgb(${rgb} / 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

// A twinkle: a soft dot with four thin rays.
function starSprite(rgb: string, size = 48): HTMLCanvasElement {
  const [c, g] = canvas2d(size);
  const m = size / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, m * 0.5);
  grad.addColorStop(0, "rgb(255 255 255 / 1)");
  grad.addColorStop(0.25, `rgb(${rgb} / 0.7)`);
  grad.addColorStop(1, `rgb(${rgb} / 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.fillStyle = `rgb(${rgb} / 0.9)`;
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    g.beginPath();
    g.moveTo(m - dx * m, m - dy * m);
    g.lineTo(m + dy * size * 0.04, m + dx * size * 0.04);
    g.lineTo(m + dx * m, m + dy * m);
    g.lineTo(m - dy * size * 0.04, m - dx * size * 0.04);
    g.fill();
  }
  return c;
}

// A soft curl of smoke with a bright edge. It is blurred once here, so each frame only copies it.
function swirlSprite(rgb: string, edge: string, size = 160): HTMLCanvasElement {
  const [c, g] = canvas2d(size);
  const k = size / 160;
  const path = () => {
    g.beginPath();
    g.moveTo(40 * k, 126 * k);
    g.bezierCurveTo(30 * k, 82 * k, 112 * k, 100 * k, 104 * k, 60 * k);
    g.bezierCurveTo(98 * k, 32 * k, 60 * k, 36 * k, 68 * k, 60 * k);
  };
  g.lineCap = "round";
  g.filter = `blur(${9 * k}px)`;
  g.strokeStyle = `rgb(${rgb} / 0.38)`;
  g.lineWidth = 26 * k;
  path();
  g.stroke();
  g.filter = `blur(${3 * k}px)`;
  g.strokeStyle = `rgb(${edge} / 0.6)`;
  g.lineWidth = 6 * k;
  path();
  g.stroke();
  return c;
}

function newPuff(anywhere: boolean): Puff {
  return {
    a: Math.random() * TAU,
    r: 0.38 + Math.random() * 0.6, // part of the glass half width
    y: anywhere ? Math.random() : 1.15,
    size: 55 + Math.random() * 65,
    spin: (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.22),
    rise: 0.02 + Math.random() * 0.035,
    sprite: Math.floor(Math.random() * 3),
  };
}

function newTwinkle(): Twinkle {
  const a = Math.random() * TAU;
  const d = 0.5 + Math.random() * 0.45;
  return {
    x: Math.cos(a) * d * GLASS.rx,
    y: GLASS.cy + Math.sin(a) * d * GLASS.ry,
    age: 0,
    life: 1.2 + Math.random() * 2,
    size: 7 + Math.random() * (Math.random() < 0.2 ? 16 : 8),
    sprite: Math.random() < 0.7 ? 0 : 1,
  };
}

// The head turns, tilts and squashes round this point, between the mouth and the chin (viewBox units).
const PIVOT_Y = 60;
const WINK_SPARK = "translate(84 -44)"; // beside the outer corner of the winking eye
const GLINT_POP = [0, 0, 0.15, 1.25, 0.3, 1]; // star and heart glints, seconds after the mood starts

type Act = { tag: string; t0: number; dur: number; run: Run };

export function createMaskFace(root: HTMLElement): Face {
  root.classList.add("mirror");
  // Set before the first layout, so the mask starts faded instead of fading out from full.
  root.dataset.state = "asleep";
  root.innerHTML = `<div class="glass"></div><canvas class="smoke"></canvas><div class="stage">${BACKLIGHT_SVG}${MASK_SVG}</div>`;
  const canvas = root.querySelector<HTMLCanvasElement>(".smoke")!;
  const stage = root.querySelector<HTMLDivElement>(".stage")!;
  const ctx = canvas.getContext("2d")!;
  const flash = document.querySelector<HTMLDivElement>("#flash")!;
  const one = <T extends Element>(cls: string) => root.querySelector<T>(cls)!;
  const all = (cls: string) => [...root.querySelectorAll<SVGElement>(cls)];
  const rigEl = one<SVGGElement>(".rig");
  const brows = all(".brow");
  const browLines = all(".brow-line");
  const irises = all(".iris");
  const starGlints = all(".g-star");
  const heartGlints = all(".g-heart");
  const twink = one<SVGGElement>(".twink");
  const lidsUp = all(".lid-up");
  const lidsLow = all(".lid-low");
  const lashes = all(".lash");
  const sockets = all(".socket");
  const creases = all(".crease");
  const lidLines = all(".lid-line");
  const blushes = all(".blush");
  const cheekLines = all(".cheek-line");
  const lipUp = one<SVGPathElement>(".lip-up");
  const lipLow = one<SVGPathElement>(".lip-low");
  const cavity = one<SVGPathElement>(".cavity");
  const cavityClip = one<SVGPathElement>(".cavity-clip");
  const teeth = one<SVGPathElement>(".teeth");
  const tongue = one<SVGEllipseElement>(".tongue");
  const puffSprites = [sprite("105 65 195"), sprite("70 48 165"), sprite("140 75 195")];
  const flameSprites = [sprite("215 240 110"), sprite("165 225 85")];
  const stars = [starSprite("255 238 180"), starSprite("215 245 150")];
  const swirlSprites = [
    swirlSprite("150 105 245", "215 190 255"),
    swirlSprite("110 80 225", "180 140 255"),
    swirlSprite("185 120 235", "235 205 255"),
  ];
  // Curls drift round the mask, mostly beside and below it.
  const swirls: Swirl[] = Array.from({ length: 10 }, (_, i) => ({
    a: (i / 10) * TAU + Math.random() * 0.5,
    r: 0.8 + Math.random() * 0.14,
    spin: (i % 2 ? 1 : -1) * (0.05 + Math.random() * 0.05),
    turn: Math.random() * TAU,
    size: 120 + Math.random() * 50,
    sprite: i % 3,
  }));

  const puffs = Array.from({ length: 32 }, () => newPuff(true));
  const twinkles = Array.from({ length: 22 }, () => {
    const t = newTwinkle();
    t.age = Math.random() * t.life;
    return t;
  });
  let sparks: Spark[] = [];
  let flames: Flame[] = [];
  let flamesDue = 0;
  let smoke = SMOKE.asleep;
  let burst = 0;
  let last = performance.now();
  const timers = new Map<string, number>();

  let state: FaceState = "asleep";
  let mood: Mood | undefined;
  // The rig: each key's value and speed, the targets it springs to, and what is drawn.
  const rig: Pose = { ...STATE_POSE.asleep };
  const vel = new Float64Array(POSE_KEYS.length);
  const tgt: Pose = { ...CALM };
  const d: Direct = { ...CALM, blink: 0, twinkle: 0 };
  const p: Pose = { ...CALM };
  // For stop(): what a stopped act was drawing this frame.
  const stopO: Pose = { ...CALM };
  const stopD: Direct = { ...CALM, blink: 0, twinkle: 0 };
  const acts: Act[] = [];
  let mouthTarget = 0;
  let shapeTarget = 0;
  let speech = 0; // smoothed mouth level from the voice
  let speechShape = 0;
  let speechAvg = 0; // slow average, to find the stressed syllables
  let nextBeat = 0;
  let beatSide = 1;
  let blinkAt = -1;
  let nextBlink = 2;
  let glanceX = 0;
  let glanceY = 0;
  let nextGlance = 0;
  let nextFidget = 0;
  let lastFidget = -1;
  let nextMoodAgain = Infinity;
  let nextEyeSmile = 0;
  let twinkOn = false;
  let moodFrom = 0;
  // The child's voice.
  let heard = 0;
  let heardAt = -1;
  let hearLevel = 0;
  let hearAvg = 0;
  let childOn = false;
  let childFrom = 0;
  let childLast = 0;
  let nextHearNod = 0;
  let attention = 0; // 0..1, leaning in while the child talks
  let thinkFrom = 0; // the "hmm" face waits until the pleased smile has shown

  const now = () => performance.now() / 1000;
  const kick = (key: Key, speed: number) => (vel[IDX[key]] += speed);
  const play = (tag: string, [dur, run]: Perf, at = now()) => acts.push({ tag, t0: at, dur, run });
  // Runs an act at s seconds into stopD.
  function sample(act: Act, s: number) {
    for (const k of POSE_KEYS) stopO[k] = stopD[k] = 0;
    act.run(s / act.dur, s, stopO, stopD);
  }
  function stop(tag: string, t: number) {
    const h = 0.02;
    for (let i = acts.length - 1; i >= 0; i--) {
      const act = acts[i];
      if (act.tag !== tag) continue;
      acts.splice(i, 1);
      const s = Math.max(0, t - act.t0);
      if (s >= act.dur) continue;
      // What the act drew straight onto the face would vanish in one frame, so hand where it was,
      // and how fast it moved, to the springs, which ease it back.
      sample(act, s + h);
      for (let j = 0; j < POSE_KEYS.length; j++) vel[j] += stopD[POSE_KEYS[j]] / h;
      sample(act, s);
      for (let j = 0; j < POSE_KEYS.length; j++) {
        const k = POSE_KEYS[j];
        rig[k] += stopD[k];
        vel[j] -= stopD[k] / h;
      }
    }
  }
  function pleased(t: number) {
    play("react", PLEASED, t);
    thinkFrom = t + 0.8;
  }
  // A weighted random fidget, never the last one again.
  function pickFidget(): number {
    let pick = Math.random() * (FIDGET_WEIGHT - (lastFidget >= 0 ? FIDGETS[lastFidget][0] : 0));
    let i = -1;
    for (let j = 0; j < FIDGETS.length; j++) {
      if (j === lastFidget) continue;
      i = j;
      if ((pick -= FIDGETS[j][0]) <= 0) break;
    }
    return i;
  }

  function flag(cls: string, ms: number) {
    root.classList.add(cls);
    clearTimeout(timers.get(cls));
    timers.set(cls, window.setTimeout(() => root.classList.remove(cls), ms));
  }

  // Sparks burst in a ring round a point: the smoke is behind the mask, so any on the face would be hidden.
  function addSparks(n: number, cy = GLASS.cy, rx = 100, ry = 140) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const d = 0.65 + Math.random() * 0.35;
      sparks.push({ x: Math.cos(a) * rx * d, y: cy + Math.sin(a) * ry * d, life: 1 + Math.random(), size: 8 + Math.random() * 12 });
    }
  }

  // Sets the spring targets (tgt) and direct offsets (d) for this frame.
  function perform(t: number, dt: number) {
    const pondering = state === "thinking" && t >= thinkFrom;
    const base = mood ? MOOD_POSE[mood] : state === "thinking" && !pondering ? STATE_POSE.listening : STATE_POSE[state];
    for (const k of POSE_KEYS) {
      tgt[k] = base[k];
      d[k] = 0;
    }
    d.blink = 0;
    d.twinkle = 0;

    // The mirror's own voice: nods, a little squash and brow pops on stressed syllables.
    speech = lerp(speech, mouthTarget, 1 - Math.exp(-dt * (mouthTarget > speech ? 30 : 14)));
    speechShape = lerp(speechShape, shapeTarget, 1 - Math.exp(-dt * 12));
    speechAvg = lerp(speechAvg, speech, 1 - Math.exp(-dt * 3));
    const energy = Math.min(1, speechAvg * 2.2);
    const beat = (mood && BEAT[mood]) || 1;
    if (state === "speaking" && speech - speechAvg > 0.22 && t > nextBeat) {
      beatSide = -beatSide;
      kick("hy", beat * (50 + Math.random() * 40));
      kick("squash", beat * (0.5 + Math.random() * 0.4));
      kick("browL", 6 + Math.random() * 6);
      kick("browR", 6 + Math.random() * 6);
      kick("tilt", beat * beatSide * (15 + Math.random() * 20));
      nextBeat = t + 0.35;
    }

    // The child's voice: lean in while they talk, nod on their syllables, smile when they stop.
    const level = state === "listening" && t - heardAt < 0.25 ? heard : 0;
    hearLevel = lerp(hearLevel, level, 1 - Math.exp(-dt * (level > hearLevel ? 25 : 8)));
    hearAvg = lerp(hearAvg, hearLevel, 1 - Math.exp(-dt * 2.5));
    if (level > 0.12) {
      if (!childOn) {
        // "Oh!": drop any fidget, so the mirror never looks away from a child who starts talking.
        childFrom = t;
        stop("fidget", t);
        kick("browL", 10);
        kick("browR", 10);
        kick("scale", 0.6);
        nextHearNod = t + 0.3;
      }
      childOn = true;
      childLast = t;
    } else if (childOn && t - childLast > 0.6) {
      childOn = false;
      if (t - childFrom > 0.8) pleased(t);
      nextFidget = t + 3 + Math.random() * 2;
    }
    if (childOn && hearLevel - hearAvg > 0.12 && t > nextHearNod) {
      beatSide = -beatSide;
      play("react", MMHMM, t);
      kick("tilt", beatSide * 10);
      kick("browL", 8);
      kick("browR", 8);
      nextHearNod = t + 0.8 + Math.random() * 0.3;
    }
    attention = lerp(attention, childOn ? 1 : 0, 1 - Math.exp(-dt * (childOn ? 6 : 2.5)));

    // Breathing, and slow motion for each state.
    const asleep = state === "asleep";
    const breath = Math.sin(t * (asleep ? 1.1 : 1.6));
    tgt.scale += breath * (asleep ? 0.012 : 0.007);
    tgt.hy -= breath * (asleep ? 1.2 : 0.7);
    if (state === "listening") {
      tgt.tilt += 1.5 * Math.sin(t * 0.6);
      tgt.hx += 1.5 * Math.sin(t * 0.45);
    } else if (pondering && !mood) {
      // "Hmmm": eyes circle up to the side, lips purse side to side, the head rocks.
      tgt.lookX += 0.4 * Math.cos(t * 1.6);
      tgt.lookY += 0.3 * Math.sin(t * 1.6);
      tgt.smirk += 0.55 * Math.sin(t * 2.4);
      tgt.tilt += 3.5 * Math.sin(t * 1.2);
      tgt.hx += 2 * Math.sin(t * 1.2);
      tgt.browL += 0.15 * Math.sin(t * 2.4 + 1);
    } else if (state === "speaking") {
      tgt.tilt += 2 * beat * Math.sin(t * 1.3);
      tgt.hx += 2.5 * beat * Math.sin(t * 0.8);
      // The brows dance with the voice, each to its own beat.
      tgt.browL += energy * (0.25 + 0.15 * Math.sin(t * 2.9));
      tgt.browR += energy * (0.25 + 0.15 * Math.sin(t * 2.3 + 2));
      tgt.hy += energy;
      if (t > nextEyeSmile) {
        if (!mood || !NO_EYE_SMILE.includes(mood)) play("talk", EYE_SMILE, t);
        nextEyeSmile = t + 3 + Math.random() * 3;
      }
    }
    if (mood) {
      moodHold(mood, t, tgt);
      const again = MOOD_AGAIN[mood];
      if (again && t > nextMoodAgain) {
        play("mood", again[3], t);
        nextMoodAgain = t + again[1] + Math.random() * (again[2] - again[1]);
      }
    }

    // Glances at the audience.
    const lively = state === "listening" || state === "speaking";
    if (lively && t > nextGlance) {
      glanceX = (Math.random() - 0.5) * 0.7;
      glanceY = (Math.random() - 0.5) * 0.4;
      nextGlance = t + 1.2 + Math.random() * 2.3;
    }
    if (lively) {
      tgt.lookX += glanceX;
      tgt.lookY += glanceY;
    }

    // Idle fidgets, never the same one twice running.
    if (state === "listening" && !childOn && t > nextFidget) {
      const i = pickFidget();
      lastFidget = i;
      play("fidget", FIDGETS[i][1], t);
      nextFidget = t + Math.max(FIDGETS[i][1][0] + 1, 3 + Math.random() * 4);
    }

    if (attention > 0.001) {
      const a = attention;
      tgt.scale += 0.05 * a;
      tgt.hy += 1.5 * a;
      tgt.browL += 0.35 * a;
      tgt.browR += 0.35 * a;
      tgt.lidL = lerp(tgt.lidL, 0, a);
      tgt.lidR = lerp(tgt.lidR, 0, a);
      tgt.lowL = lerp(tgt.lowL, 0.06, a);
      tgt.lowR = lerp(tgt.lowR, 0.06, a);
      tgt.lookX *= 1 - a;
      tgt.lookY *= 1 - a;
    }

    // An act that has not started yet runs at 0, where it adds nothing (or, for the wake, where the
    // head already is). Frame times can be a little behind the clock an act was started with.
    for (let i = acts.length - 1; i >= 0; i--) {
      const act = acts[i];
      const s = Math.max(0, t - act.t0);
      if (s >= act.dur) acts.splice(i, 1);
      else act.run(s / act.dur, s, tgt, d);
    }
  }

  // Moves every key towards its target on its spring. Small steps keep it steady after a slow frame.
  function stepSprings(dt: number) {
    const n = Math.ceil(dt * 120);
    const h = dt / n;
    for (let step = 0; step < n; step++) {
      for (let i = 0; i < POSE_KEYS.length; i++) {
        const k = POSE_KEYS[i];
        vel[i] += (STIFF[i] * (tgt[k] - rig[k]) - DAMP[i] * vel[i]) * h;
        rig[k] += vel[i] * h;
      }
    }
  }

  function animateFace(t: number, dt: number) {
    perform(t, dt);
    if (dt > 0) stepSprings(dt);
    for (let i = 0; i < POSE_KEYS.length; i++) {
      const k = POSE_KEYS[i];
      p[k] = (SOFT[i] ? soft : clamp)(rig[k] + d[k], LIMIT[k][0], LIMIT[k][1]);
    }

    const slow = mood === "gentle"; // gentle eyes blink slowly
    if (t > nextBlink) {
      blinkAt = t;
      nextBlink = t + (slow ? 2.2 + Math.random() * 1.3 : Math.random() < 0.15 ? 0.35 : 2 + Math.random() * 4);
    }
    const blink = state === "asleep" ? 0 : Math.max(d.blink, blinkCurve(t - blinkAt, slow ? 0.45 : 0.18));

    const sx = (1 + p.scale) * (1 + p.squash);
    const sy = (1 + p.scale) * (1 - p.squash);
    rigEl.setAttribute("transform", `translate(${f(p.hx)} ${f(p.hy + PIVOT_Y)}) rotate(${f(p.tilt)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(0 ${-PIVOT_Y})`);

    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const cx = EYE_X[i];
      const raise = i ? p.browR : p.browL;
      const slant = i ? p.slantR : p.slantL;
      brows[i].setAttribute("d", browCap(side, raise, slant));
      browLines[i].setAttribute("d", browLine(side, raise, slant));

      // The upper lid comes down and the lower lid comes up. Where they meet, the closed eye is a
      // sleepy curve (upper lid wins) or a happy arc (lower lid wins).
      const lidDown = Math.max(i ? p.lidR : p.lidL, blink);
      const low = i ? p.lowR : p.lowL;
      let up = lerp(LID_TOP, LID_BOTTOM, lidDown);
      let down = lerp(LID_BOTTOM, LID_TOP, low);
      if (up >= down) up = down = lerp(LID_BOTTOM, LID_TOP, low / (lidDown + low));
      const open = clamp((down - up) / (LID_BOTTOM - LID_TOP), 0, 1);
      lidsUp[i].setAttribute("d", lid(cx, up, LID_TOP - 6));
      lidsLow[i].setAttribute("d", lid(cx, down, LID_BOTTOM + 6));
      // The violet ring fades as the eye closes, so a closed or smiling eye sits on lit skin. Its hole
      // is a little smaller than the open eye, so the ring edge always lies on dark.
      const m = (up + down) / 2;
      sockets[i].setAttribute("d", `${socketPath(cx, side, (Math.min(down, LID_BOTTOM) - LID_BOTTOM) * 0.35)} ${opening(cx, Math.min(up + 1.2, m), Math.max(down - 1.2, m))}`);
      sockets[i].setAttribute("opacity", f(Math.min(1, 0.15 + 1.6 * open)));
      lashes[i].setAttribute("d", lashPath(cx, side, up));
      lidLines[i].setAttribute("d", curve(cx, down));
      creases[i].setAttribute("d", curve(cx, up - 7));
      // The spark rides up with the lower lid, so a smiling eye shows all of it, not half.
      const iy = Math.min(EYE_Y - 6 + p.lookY * 7, EYE_Y + down * 0.75 - 10);
      irises[i].setAttribute("transform", `translate(${f(cx + p.lookX * 12)} ${f(iy)})`);
      blushes[i].setAttribute("opacity", f(p.blush));
      // Star eyes twinkle; heart eyes beat. Both pop in when the mood starts. CSS shows them only
      // for their mood.
      if (mood === "excited") {
        const k = keys(t - moodFrom, GLINT_POP) * (0.95 + 0.15 * Math.sin(t * 7 + i * 0.8));
        starGlints[i].setAttribute("transform", `rotate(${f(14 * Math.sin(t * 2.5 + i))}) scale(${k.toFixed(2)})`);
      } else if (mood === "love") {
        const ph = (t * 1.3) % 1;
        const k = keys(t - moodFrom, GLINT_POP) * (1 + 0.13 * (bump(ph, 0, 0.18) + 0.6 * bump(ph, 0.22, 0.4)));
        heartGlints[i].setAttribute("transform", `scale(${k.toFixed(2)})`);
      }
    }
    if (d.twinkle > 0.001 || twinkOn) {
      twinkOn = d.twinkle > 0.001;
      twink.setAttribute("opacity", d.twinkle.toFixed(2));
      twink.setAttribute("transform", `${WINK_SPARK} rotate(${f((t * 120) % 360)}) scale(${(0.3 + 0.9 * d.twinkle).toFixed(2)})`);
    }

    // Mouth: the voice opens it and shapes it; the pose sets the smile. A big smile drops the lower
    // lip with no sound, so the grin shows its teeth like the mask in the film.
    const open = clamp(p.jaw + speech * (1 - p.jaw * 0.6), 0, 1);
    const shape = lerp(p.shape, clamp(p.shape * 0.4 + speechShape), Math.min(1, speech * 4));
    const round = Math.max(0, -shape);
    const w = 40 + Math.max(0, shape) * 6 - round * 16 + Math.max(0, p.smile) * 6;
    const dx = p.smirk * 4;
    const lx = dx - w;
    const rx = dx + w;
    const ly = MOUTH_Y - p.smile * 12 + p.smirk * 4;
    const ry = MOUTH_Y - p.smile * 12 - p.smirk * 10;
    const kx = 0.55 + round * 0.4; // fuller curves make an O when the lips round
    const c1 = f(dx - w * kx);
    const c2 = f(dx + w * kx);
    const mid = MOUTH_Y + p.smile * 3; // the middle stays while the corners move
    const grin = Math.max(0, p.smile - 0.4) * 38 * (1 - round);
    const upY = mid - open * (3 + round * 7);
    const loY = mid + Math.min(48, grin + open * (38 + round * 8)); // the chin sets the limit
    const L = `${f(lx)},${f(ly)}`;
    const R = `${f(rx)},${f(ry)}`;
    const upperInner = `C${c1},${f(upY)} ${c2},${f(upY)} ${R}`;
    const lowerInnerBack = `C${c2},${f(loY)} ${c1},${f(loY)} ${L}`;
    const hole = `M${L} ${upperInner} ${lowerInnerBack}Z`;
    lipUp.setAttribute(
      "d",
      `M${L} C${f(dx - w * 0.6)},${f(upY - 6.5)} ${f(dx - 8)},${f(upY - 7)} ${f(dx)},${f(upY - 6)} ` +
        `C${f(dx + 8)},${f(upY - 7)} ${f(dx + w * 0.6)},${f(upY - 6.5)} ${R} C${c2},${f(upY)} ${c1},${f(upY)} ${L}Z`,
    );
    lipLow.setAttribute("d", `M${L} C${c1},${f(loY + 8)} ${c2},${f(loY + 8)} ${R} ${lowerInnerBack}Z`);
    cavity.setAttribute("d", hole);
    cavityClip.setAttribute("d", hole);
    const tooth = 11 - round * 5 + grin * 0.2;
    teeth.setAttribute("d", `M${L} ${upperInner} L${f(rx)},${f(ry + tooth * 0.5)} C${c2},${f(upY + tooth)} ${c1},${f(upY + tooth)} ${f(lx)},${f(ly + tooth * 0.5)}Z`);
    tongue.setAttribute("cx", f(dx));
    // The tongue hides below the lip until the mouth opens.
    const holeBottom = 0.75 * loY + 0.125 * (ly + ry);
    tongue.setAttribute("cy", f(holeBottom + 9 - open * 15));
    tongue.setAttribute("rx", f(w * 0.5));

    // Small dimples at the mouth corners when it smiles.
    const dimple = Math.min(0.35, Math.max(0, p.smile - 0.4) * 0.9);
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const cx = i ? rx : lx;
      const cy = i ? ry : ly;
      cheekLines[i].setAttribute("d", `M${f(cx + side * 2)},${f(cy - 4)} Q${f(cx + side * 6)},${f(cy)} ${f(cx + side * 3)},${f(cy + 4)}`);
      cheekLines[i].setAttribute("opacity", f(dimple));
    }
  }

  // The canvas covers the screen at half resolution. It draws in the stage's viewBox units, from
  // the centre of the screen, where the stage is.
  let w = 1;
  let h = 1;
  let u = 1;
  function resize() {
    h = Math.max(1, Math.round(canvas.clientHeight / 2));
    w = Math.max(1, Math.round(canvas.clientWidth / 2));
    u = Math.max(1, stage.clientHeight / 2) / VB_H;
    GLASS.rx = w / 2 / u;
    GLASS.ry = h / 2 / u;
    Object.assign(canvas, { width: w, height: h });
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  function drawSmoke(now: number, dt: number) {
    const X = (x: number) => w / 2 + x * u;
    const Y = (y: number) => h / 2 + y * u;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    burst = Math.max(0, burst - dt * 0.6);
    const speed = smoke.speed * (1 + burst * 2);
    const glow = Math.min(1, smoke.alpha * (1 + burst));
    for (const p of puffs) {
      p.a += p.spin * dt * speed;
      p.y -= p.rise * dt * speed;
      if (p.y < -0.15) Object.assign(p, newPuff(false));
      const x = Math.cos(p.a) * p.r * GLASS.rx;
      const y = GLASS.cy + Math.sin(p.a) * p.r * 0.45 + (p.y - 0.5) * GLASS.ry * 2;
      const size = p.size * u * (1 + burst);
      const edgeFade = Math.min(1, (1.15 - p.y) * 3, (p.y + 0.15) * 3);
      ctx.globalAlpha = glow * edgeFade * 0.22;
      ctx.drawImage(puffSprites[p.sprite], X(x) - size / 2, Y(y) - size / 2, size, size);
    }
    for (const sw of swirls) {
      sw.a += sw.spin * dt * speed;
      sw.turn += sw.spin * 2.5 * dt * speed;
      const x = Math.cos(sw.a) * GLASS.rx * sw.r * 0.85;
      const y = GLASS.cy + 12 + Math.sin(sw.a) * GLASS.ry * sw.r * 0.8;
      const size = sw.size * u * (1 + burst * 0.5);
      ctx.globalAlpha = glow * 0.75;
      ctx.save();
      ctx.translate(X(x), Y(y));
      ctx.rotate(sw.turn);
      ctx.drawImage(swirlSprites[sw.sprite], -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    // Green wisps curl up past the jaw, as if lighting the face from below.
    flamesDue += smoke.flames * (1 + burst) * dt;
    for (; flamesDue >= 1; flamesDue--) {
      const a = Math.PI * (0.05 + Math.random() * 0.9);
      flames.push({ x: Math.cos(a) * 86, y: 4 + Math.sin(a) * 106, drift: Math.cos(a) * 12, age: 0, life: 0.8 + Math.random() * 1, size: 14 + Math.random() * 16, sprite: Math.random() < 0.55 ? 0 : 1 });
    }
    flames = flames.filter((fl) => (fl.age += dt) < fl.life);
    for (const fl of flames) {
      const k = fl.age / fl.life;
      fl.y -= dt * (28 + 24 * k);
      fl.x += dt * (fl.drift + Math.sin(now / 160 + fl.life * 40) * 12);
      const size = fl.size * u * (1 - k * 0.6);
      ctx.globalAlpha = Math.sin(Math.PI * k) * 0.45;
      ctx.drawImage(flameSprites[fl.sprite], X(fl.x) - size * 0.45, Y(fl.y) - size, size * 0.9, size * 2);
    }
    for (const tw of twinkles) {
      tw.age += dt;
      if (tw.age > tw.life) Object.assign(tw, newTwinkle());
      const size = tw.size * u;
      ctx.globalAlpha = Math.sin((Math.PI * tw.age) / tw.life) ** 2 * Math.min(1, smoke.alpha * 1.2);
      ctx.drawImage(stars[tw.sprite], X(tw.x) - size / 2, Y(tw.y) - size / 2, size, size);
    }
    sparks = sparks.filter((s) => (s.life -= dt * 0.8) > 0);
    for (const s of sparks) {
      const size = s.size * u * (0.6 + 0.4 * Math.sin(now / 90 + s.x));
      ctx.globalAlpha = Math.min(1, s.life);
      ctx.drawImage(stars[0], X(s.x) - size / 2, Y(s.y - (1 - s.life) * 20) - size / 2, size, size);
    }
    ctx.restore();
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
  animateFace(performance.now() / 1000, 0); // so the first paint already has brows, lids and lips
  requestAnimationFrame(frame);

  function showMood(next: Mood | undefined) {
    mood = next;
    root.dataset.mood = next ?? "";
  }

  return {
    setState(next) {
      const prev = state;
      const t = now();
      state = next;
      root.dataset.state = next;
      smoke = SMOKE[next];
      if (next !== "speaking") {
        showMood(undefined);
        stop("mood", t);
      }
      if (next === prev) return;
      nextEyeSmile = t + 2.5 + Math.random() * 2;
      // "react" and "talk" acts are short and left to finish on their own.
      stop("fidget", t);
      stop("state", t);
      nextFidget = t + 1.5 + Math.random() * 1.5;
      if (childOn && next === "thinking") pleased(t);
      childOn = false;
      switch (next) {
        case "waking":
          burst = 1.2; // the mirror appears in a gust of smoke
          addSparks(30);
          // The entrance grows the head from here, so the springs start at the awake size.
          play("state", wakeFrom(rig.scale, rig.hy), t);
          rig.scale = rig.hy = vel[IDX.scale] = vel[IDX.hy] = 0;
          break;
        case "thinking":
          play("state", HMM, Math.max(t, thinkFrom));
          break;
        case "listening":
          if (prev === "speaking" || prev === "thinking") play("state", YOUR_TURN, t);
          break;
        case "asleep":
          play("state", YAWN, t);
          break;
      }
    },
    setMouth(open, shape) {
      mouthTarget = open;
      shapeTarget = shape;
    },
    setMood(next) {
      showMood(next);
      const t = now();
      moodFrom = t;
      // Hide the glints until the next frame pops them in.
      for (const g of next === "excited" ? starGlints : next === "love" ? heartGlints : []) g.setAttribute("transform", "scale(0)");
      stop("mood", t);
      play("mood", MOOD_IN[next], t);
      for (const [key, speed] of MOOD_KICK[next] ?? []) kick(key, speed);
      const again = MOOD_AGAIN[next];
      nextMoodAgain = again ? t + again[0] : Infinity;
      if (next === "spooky") addSparks(14); // a "hee-hee" twinkle, not a threat
      if (next === "excited") {
        addSparks(40);
        burst = Math.max(burst, 0.5);
      }
      if (next === "love") addSparks(12);
    },
    hear(level) {
      heard = level;
      heardAt = now();
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
      }
    },
  };
}
