import "./maskFace.css";
import type { Effect, Face, FaceState, Mood } from "./face.ts";

// The Queen's magic mirror, drawn for small children: a theatre mask, purple above and lit
// yellow-green from below, with a big grin, floating in smoke inside a gold oval frame with gems.
// Brows, lids, eyes, cheeks, lips and head all move, so the mirror can grin, wink and gasp.
const f = (x: number) => x.toFixed(1);

// Glass, smoke, mask and frame share this viewBox so they line up; only the mask floats.
const VIEWBOX = "-150 -205 300 410";
const VB_H = 410;
const GLASS = { cy: 8, rx: 118, ry: 166 };
const FRAME = { rx: 134, ry: 184 };
// The mask is drawn in its own units (about 186 wide, 243 tall) and scaled into the glass.
const MASK_PLACE = "translate(0 4) scale(0.83)";

const EYE_X = [-46, 46]; // viewer's left eye, viewer's right eye
const EYE_Y = -20;
const EYE_W = 24; // half the width of an eye
const LID_TOP = -30; // curve height of the upper edge of an open eye
const LID_BOTTOM = 12; // curve height of the lower edge of an open eye
const MOUTH_Y = 66;

// Concave top with corners pointing up and out, high cheekbones, tapering jaw, rounded chin.
const MASK =
  "M-93,-120 C-62,-101 -31,-96 0,-96 C31,-96 62,-101 93,-120 " +
  "C92,-96 84,-56 82,-34 C82,-24 86,-18 85,-6 C84,12 66,50 56,75 C42,100 24,122 0,123 " +
  "C-24,122 -42,100 -56,75 C-66,50 -84,12 -85,-6 C-86,-18 -82,-24 -82,-34 C-84,-56 -92,-96 -93,-120Z";
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
// Purple ring round the eye, strongest below and at the outer corner. The open eye is cut out of it.
// It rides up with the lower lid, so a smiling eye has a crescent under it, not a pool.
const socketPath = (cx: number, side: number, lift: number) => {
  const x = cx + side * 6;
  const y = EYE_Y - 2 + lift;
  return `M${x - 36},${y} A36,25 0 1,0 ${x + 36},${y} A36,25 0 1,0 ${x - 36},${y}Z`;
};
// A thick dark upper lid, thin at the ends, with a flick at the outer corner. The flick shrinks as
// the eye closes, so a closed or smiling eye has no kink at the corner.
function lashPath(cx: number, side: number, up: number, open: number): string {
  const ix = cx - side * EYE_W;
  const ox = cx + side * EYE_W;
  const a = cx - side * 12;
  const b = cx + side * 12;
  return (
    `M${ix},${EYE_Y} C${a},${f(EYE_Y + up + 1.5)} ${b},${f(EYE_Y + up + 1.5)} ${ox},${EYE_Y} ` +
    `L${f(ox + side * (1 + 8 * open))},${f(EYE_Y - 1 - 6 * open)} C${b + side * 2},${f(EYE_Y + up - 7)} ${a},${f(EYE_Y + up - 5)} ${ix},${EYE_Y}Z`
  );
}

// Dark eyes with a soft spark that looks around.
const eye = (cx: number, i: number) => `
      <g clip-path="url(#bm-eye-${i})">
        <rect x="${cx - 26}" y="${EYE_Y - 26}" width="52" height="40" fill="url(#bm-hole)"/>
        <g class="iris">
          <circle r="8" fill="url(#bm-iris)"/>
          <path d="M3,-8 l1,2.8 2.8,1 -2.8,1 -1,2.8 -1,-2.8 -2.8,-1 2.8,-1Z" fill="#fff"/>
          <circle cx="-3.6" cy="3.4" r="1.3" fill="#fff"/>
        </g>
      </g>
      <path class="lid-up" fill="url(#bm-skin)"/>
      <path class="lid-low" fill="url(#bm-skin)"/>
      <path class="socket" fill="url(#bm-socket)" fill-rule="evenodd"/>
      <path class="lid-line" fill="none" stroke="#2b1a4c" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/>
      <path class="crease" fill="none" stroke="#55459a" stroke-width="3" stroke-linecap="round" opacity="0.35"/>
      <path class="lash" fill="#1c0f30"/>`;

const GOLD_STOPS = `
      <stop offset="0" stop-color="#ffeeb0"/>
      <stop offset="0.2" stop-color="#e3a63e"/>
      <stop offset="0.4" stop-color="#935a14"/>
      <stop offset="0.56" stop-color="#f3c862"/>
      <stop offset="0.78" stop-color="#b07220"/>
      <stop offset="1" stop-color="#62390b"/>`;

// The crown effect: a gold filigree tiara with gems, sitting on the dipped top of the mask.
const tiaraSide = (s: number) => `
        <path d="M${s * 16},-100 C${s * 24},-118 ${s * 46},-118 ${s * 46},-104 C${s * 46},-96 ${s * 37},-95 ${s * 36},-101" fill="none" stroke="#4a2c06" stroke-width="5.5" stroke-linecap="round"/>
        <path d="M${s * 16},-100 C${s * 24},-118 ${s * 46},-118 ${s * 46},-104 C${s * 46},-96 ${s * 37},-95 ${s * 36},-101" fill="none" stroke="url(#bm-gold)" stroke-width="3" stroke-linecap="round"/>
        <path d="M${s * 54},-97 L${s * 58},-120 L${s * 62},-99Z" fill="url(#bm-gold)" stroke="#4a2c06" stroke-width="1.3" stroke-linejoin="round"/>
        <circle cx="${s * 58}" cy="-123" r="4" fill="#ff8ab4" stroke="#7a2048" stroke-width="1"/>
        <circle cx="${s * 31}" cy="-113" r="3.2" fill="#ff8ab4" stroke="#7a2048" stroke-width="1"/>`;
const TIARA = `
        <path d="M-70,-101 C-40,-90 40,-90 70,-101 L68,-94 C40,-83 -40,-83 -68,-94Z" fill="url(#bm-gold)" stroke="#4a2c06" stroke-width="1.4" stroke-linejoin="round"/>
        ${tiaraSide(-1)}${tiaraSide(1)}
        <path d="M-15,-90 C-17,-108 -7,-122 0,-146 C7,-122 17,-108 15,-90Z" fill="url(#bm-gold)" stroke="#4a2c06" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M0,-124 L8,-108 L0,-92 L-8,-108Z" fill="#6fdc5e" stroke="#155a1c" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M0,-124 L-8,-108 L0,-108Z" fill="#d4ffb8"/>
        <circle cx="0" cy="-149" r="4" fill="#ff8ab4" stroke="#7a2048" stroke-width="1"/>
        <circle cx="-2.5" cy="-114" r="1.6" fill="#fff"/>`;

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
      <stop offset="0" stop-color="#ff86a6" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#ff86a6" stop-opacity="0"/>
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
      <stop offset="0" stop-color="#b8707f"/>
      <stop offset="1" stop-color="#8a4a62"/>
    </linearGradient>
    <linearGradient id="bm-lip-low" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9a5670"/>
      <stop offset="1" stop-color="#c88392"/>
    </linearGradient>
    <linearGradient id="bm-teeth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e4def0"/>
    </linearGradient>
    <linearGradient id="bm-gold" x1="0" y1="0" x2="1" y2="1">${GOLD_STOPS}
    </linearGradient>
    <clipPath id="bm-clip"><path d="${MASK}"/></clipPath>
    <clipPath id="bm-eye-0"><path d="${opening(EYE_X[0], LID_TOP, LID_BOTTOM)}"/></clipPath>
    <clipPath id="bm-eye-1"><path d="${opening(EYE_X[1], LID_TOP, LID_BOTTOM)}"/></clipPath>
    <clipPath id="bm-mouth"><path class="cavity-clip"/></clipPath>
  </defs>
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
      <g class="jewel">
        <path d="M0,-90 L6,-80 L0,-70 L-6,-80Z" fill="url(#bm-gold)" stroke="#4a2c06" stroke-width="1"/>
        <path d="M0,-87 L4,-80 L0,-73 L-4,-80Z" fill="#5fd06a"/>
        <path d="M0,-87 L-4,-80 L0,-80Z" fill="#d4ffb8"/>
      </g>
      <path class="lip-up" fill="url(#bm-lip-up)"/>
      <path class="lip-low" fill="url(#bm-lip-low)"/>
      <path class="cavity" fill="#1e0818" stroke="#3a1230" stroke-width="1.6" stroke-linejoin="round"/>
      <g clip-path="url(#bm-mouth)">
        <ellipse class="tongue" ry="9" fill="#d0607e"/>
        <path class="teeth" fill="url(#bm-teeth)"/>
      </g>
      <g class="crown">${TIARA}</g>
    </g>
  </g>
</svg>`;

// A cut gem: four facets round a flat top, and a glint.
type GemColours = readonly [string, string, string, string];
const AMETHYST: GemColours = ["#f0d4ff", "#b06cf0", "#6a2bb5", "#3a1470"];
const EMERALD: GemColours = ["#e2ffb8", "#7ad65a", "#2f8a32", "#124818"];
function gem(x: number, y: number, w: number, h: number, c: GemColours): string {
  const t = 0.42;
  const quad = (sx: number, sy: number, fill: string) =>
    `<path d="M0,${sy * h} L${sx * w},0 L${f(sx * w * t)},0 L0,${f(sy * h * t)}Z" fill="${fill}"/>`;
  return `
  <g transform="translate(${x} ${y})">
    <path d="M0,${-h - 5} L${w + 5},0 L0,${h + 5} L${-w - 5},0Z" fill="url(#bf-gold)" stroke="#4a2a06" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M0,${-h} L${w},0 L0,${h} L${-w},0Z" fill="${c[3]}"/>
    ${quad(-1, -1, c[0])}${quad(1, -1, c[1])}${quad(-1, 1, c[1])}${quad(1, 1, c[2])}
    <path d="M0,${f(-h * t)} L${f(w * t)},0 L0,${f(h * t)} L${f(-w * t)},0Z" fill="${c[1]}"/>
    <path d="M0,${f(-h * t)} L${f(-w * t)},0 L0,0Z" fill="${c[0]}" opacity="0.7"/>
    <path d="M${f(-w * 0.3)},${f(-h * 0.62)} l1.6,3.4 3.4,1.6 -3.4,1.6 -1.6,3.4 -1.6,-3.4 -3.4,-1.6 3.4,-1.6Z" fill="#fff"/>
  </g>`;
}

// Gold scrollwork, drawn as a dark outline, gold, and a thin highlight.
const SCROLLS = [
  "M-17,-174 C-30,-192 -56,-190 -62,-175 C-66,-164 -55,-157 -48,-163 C-43,-168 -48,-175 -53,-171",
  "M-138,-12 C-150,-22 -151,-38 -142,-44 C-135,-48 -128,-41 -133,-35",
  "M-138,28 C-150,38 -151,54 -142,60 C-135,64 -128,57 -133,51",
  "M-12,191 C-23,202 -43,199 -45,188 C-46,180 -38,177 -34,182",
];
const scrollPaths = (stroke: string, width: number, extra = "") =>
  SCROLLS.map((d) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" ${extra}/>`).join("");

// A round gold stud holding a small gem.
const stud = (x: number, y: number) => `
      <circle cx="${x}" cy="${y}" r="7" fill="url(#bf-gold)" stroke="#3d2304" stroke-width="1.4"/>
      <circle cx="${x}" cy="${y}" r="3.8" fill="${AMETHYST[2]}"/>
      <circle cx="${x - 1}" cy="${y - 1}" r="2.2" fill="${AMETHYST[1]}"/>
      <circle cx="${x - 1.4}" cy="${y - 1.6}" r="0.9" fill="#fff"/>`;

const ring = (r: number, stroke: string, width: number, extra = "") =>
  `<ellipse cx="0" cy="${GLASS.cy}" rx="${f(FRAME.rx - r)}" ry="${f(FRAME.ry - r)}" fill="none" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
const glassRing = (inset: number, stroke: string, width: number, opacity: number) =>
  `<ellipse cx="0" cy="${GLASS.cy}" rx="${GLASS.rx - inset}" ry="${GLASS.ry - inset}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-opacity="${opacity}"/>`;

// The frame sits on top of the smoke and the mask. Its inner shadow and violet glow only touch the
// edge of the glass, so they never cover the face.
const FRAME_SVG = `
<svg class="frame" viewBox="${VIEWBOX}" aria-hidden="true">
  <defs>
    <linearGradient id="bf-gold" x1="0" y1="0" x2="1" y2="1">${GOLD_STOPS}
    </linearGradient>
    <linearGradient id="bf-gold-b" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#fff2c4"/>
      <stop offset="0.3" stop-color="#f2c45c"/>
      <stop offset="0.5" stop-color="#c08328"/>
      <stop offset="0.7" stop-color="#fbd77e"/>
      <stop offset="1" stop-color="#9a6018"/>
    </linearGradient>
    <g id="bf-half">
      ${scrollPaths("#3d2304", 6.5)}
      ${scrollPaths("url(#bf-gold-b)", 3.8)}
      ${scrollPaths("#fff3c4", 1.1, 'opacity="0.7"')}
      ${gem(-FRAME.rx, GLASS.cy, 10, 15, EMERALD)}
      ${stud(-84, -123)}${stud(-84, 139)}
    </g>
  </defs>
  ${glassRing(7, "#000", 14, 0.4)}
  <g class="rim-glow">
    ${glassRing(9, "#9a6cff", 14, 0.12)}
    ${glassRing(3, "#b58cff", 5, 0.4)}
  </g>
  ${ring(8, "url(#bf-gold)", 17)}
  ${ring(6, "url(#bf-gold-b)", 7)}
  ${ring(4.5, "#fff4c8", 1.4, 'opacity="0.75"')}
  ${ring(12.5, "#6b430e", 2, 'stroke-dasharray="1.5 4"')}
  ${ring(0, "#3d2304", 1.6)}
  ${ring(16, "#3d2304", 2.2)}
  ${ring(17.6, "#9c6ae6", 2.2)}
  <use href="#bf-half"/>
  <use href="#bf-half" transform="scale(-1 1)"/>
  ${gem(0, -180, 14, 18, AMETHYST)}
  ${gem(0, 189, 8, 9, AMETHYST)}
</svg>`;

const GLASS_SVG = `
<svg class="glass" viewBox="${VIEWBOX}" aria-hidden="true">
  <defs>
    <radialGradient id="bg-glass">
      <stop offset="0" stop-color="#140a26"/>
      <stop offset="0.7" stop-color="#080310"/>
      <stop offset="0.92" stop-color="#110826"/>
      <stop offset="1" stop-color="#2a1650"/>
    </radialGradient>
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
    <linearGradient id="bg-sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <ellipse cx="0" cy="${GLASS.cy}" rx="${GLASS.rx}" ry="${GLASS.ry}" fill="url(#bg-glass)"/>
  <path d="M-108,-60 C-104,-110 -72,-146 -26,-156 C-70,-136 -96,-104 -100,-52Z" fill="url(#bg-sheen)"/>
  <ellipse class="halo" cx="0" cy="4" rx="112" ry="148" fill="url(#bg-halo)"/>
</svg>`;

// Each pose is a set of targets for the face rig. L and R are as the viewer sees them.
const POSE_KEYS = ["browL", "browR", "slantL", "slantR", "lidL", "lidR", "lowL", "lowR", "smile", "smirk", "jaw", "shape", "blush", "lookX", "lookY", "tilt"] as const;
type Pose = Record<(typeof POSE_KEYS)[number], number>;
// brow: -1 low .. 1 high. slant: + inner ends up (kind), - inner ends down (cheeky). lid: upper lid
// closed 0..1. low: lower lid up 0..1 (smiling eyes). smile, smirk, shape: -1..1. jaw: open with no
// sound 0..1. look: -1..1. tilt: degrees.
const CALM: Pose = { browL: 0.2, browR: 0.2, slantL: 0.1, slantR: 0.1, lidL: 0.15, lidR: 0.15, lowL: 0.12, lowR: 0.12, smile: 0.35, smirk: 0, jaw: 0, shape: 0, blush: 0, lookX: 0, lookY: 0, tilt: 0 };
const pose = (p: Partial<Pose>): Pose => ({ ...CALM, ...p });

// Grins keep their teeth without a jaw opening, so lip sync can close the mouth between syllables.
const STATE_POSE: Record<FaceState, Pose> = {
  asleep: pose({ browL: -0.1, browR: -0.1, lidL: 1, lidR: 1, lowL: 0, lowR: 0, smile: 0.2 }),
  waking: pose({ browL: 0.9, browR: 0.9, slantL: 0.2, slantR: 0.2, lidL: 0, lidR: 0, lowL: 0, lowR: 0, smile: 0.2, jaw: 0.3, shape: -0.6 }),
  listening: pose({ browL: 0.35, browR: 0.3, lidL: 0.08, lidR: 0.08, lowL: 0.2, lowR: 0.2, smile: 0.72, tilt: 3 }),
  thinking: pose({ browL: 0.8, browR: -0.1, slantL: 0, slantR: -0.3, lidL: 0.05, lidR: 0.12, smile: 0.05, smirk: -0.4, shape: -0.5, lookX: -0.7, lookY: -0.8, tilt: -4 }),
  speaking: pose({ browL: 0.3, browR: 0.3, lowL: 0.18, lowR: 0.18, smile: 0.5 }),
};

const MOOD_POSE: Record<Mood, Pose> = {
  happy: pose({ browL: 0.45, browR: 0.45, slantL: 0.15, slantR: 0.15, lidL: 0, lidR: 0, lowL: 0.45, lowR: 0.45, smile: 0.9, blush: 0.45 }),
  laugh: pose({ browL: 0.6, browR: 0.6, slantL: 0.3, slantR: 0.3, lidL: 0.3, lidR: 0.3, lowL: 1, lowR: 1, smile: 1, jaw: 0.3, shape: 0.3, blush: 0.5 }),
  surprised: pose({ browL: 1, browR: 1, slantL: 0.2, slantR: 0.2, lidL: 0, lidR: 0, lowL: 0, lowR: 0, smile: 0, jaw: 0.75, shape: -0.8 }),
  sly: pose({ browL: 0.95, browR: -0.35, slantL: -0.2, slantR: -0.6, lidL: 0.45, lidR: 0.5, lowL: 0.2, lowR: 0.2, smile: 0.7, smirk: 0.8, lookX: 0.6, tilt: 4 }),
  wink: pose({ browL: 0.5, browR: 0.2, slantL: 0.15, slantR: 0, lidL: 0.05, lidR: 0.05, lowL: 0.4, lowR: 0.4, smile: 0.85, smirk: 0.4, blush: 0.35, tilt: 3 }),
  spooky: pose({ browL: -0.3, browR: -0.3, slantL: -0.9, slantR: -0.9, lidL: 0.13, lidR: 0.13, lowL: 0.2, lowR: 0.2, smile: 0.9, smirk: 0.3, jaw: 0.1, shape: 0.7, lookX: 0.5, tilt: -3 }),
  gentle: pose({ browL: 0.3, browR: 0.3, slantL: 0.3, slantR: 0.3, lidL: 0.05, lidR: 0.05, lowL: 0.5, lowR: 0.5, smile: 0.65, blush: 0.4, tilt: 5 }),
};

// Smoke speed and brightness, and new green wisps per second, for each state.
const SMOKE: Record<FaceState, { speed: number; alpha: number; flames: number }> = {
  asleep: { speed: 0.35, alpha: 0.25, flames: 0 },
  waking: { speed: 2.2, alpha: 0.9, flames: 60 },
  listening: { speed: 1, alpha: 0.7, flames: 18 },
  thinking: { speed: 3, alpha: 0.85, flames: 30 },
  speaking: { speed: 1.2, alpha: 0.75, flames: 22 },
};
const TAU = Math.PI * 2;
const FRAME_MS = 33; // ~30 fps: the laptop also runs the voice

const clamp = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// The lower edge of the purple over each eye is the brow: it rises from the nose and peaks
// above the outer half of the eye, like the mask in the film.
function arch(side: number, raise: number, slant: number) {
  const up = raise * 15;
  // Slant tips the whole arch, so a cheeky or a kind brow reads from across the room.
  const iy = -46 - up - slant * 15;
  const cy1 = -76 - up - slant * 12;
  const cy2 = -76 - up + slant * 4;
  const oy = -29 - up * 0.6 + slant * 6;
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
  return `${a} L${ox},${f(oy - 4)} C${side * 86},${f(cy2 - 9)} ${side * 32},${f(cy1 - 9)} ${ix},${f(iy)}Z`;
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
    r: 45 + Math.random() * 70,
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

export function createMaskFace(root: HTMLElement): Face {
  root.classList.add("mirror");
  // Set before the first layout, so the mask starts faded instead of fading out from full.
  root.dataset.state = "asleep";
  root.innerHTML = `<div class="stage">${GLASS_SVG}<canvas class="smoke"></canvas>${MASK_SVG}${FRAME_SVG}</div>`;
  const canvas = root.querySelector<HTMLCanvasElement>(".smoke")!;
  const ctx = canvas.getContext("2d")!;
  const flash = document.querySelector<HTMLDivElement>("#flash")!;
  const one = <T extends Element>(cls: string) => root.querySelector<T>(cls)!;
  const all = (cls: string) => [...root.querySelectorAll<SVGElement>(cls)];
  const head = one<SVGGElement>(".head");
  const brows = all(".brow");
  const browLines = all(".brow-line");
  const irises = all(".iris");
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
  const swirls: Swirl[] = Array.from({ length: 7 }, (_, i) => ({
    a: (i / 7) * TAU + Math.random() * 0.5,
    r: 0.8 + Math.random() * 0.14,
    spin: (i % 2 ? 1 : -1) * (0.05 + Math.random() * 0.05),
    turn: Math.random() * TAU,
    size: 120 + Math.random() * 50,
    sprite: i % 3,
  }));

  const puffs = Array.from({ length: 24 }, () => newPuff(true));
  const twinkles = Array.from({ length: 16 }, () => {
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

  // Sparks burst in a ring round a point: the smoke is behind the mask, so any on the face would be hidden.
  function addSparks(n: number, cy = GLASS.cy, rx = 100, ry = 140) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const d = 0.65 + Math.random() * 0.35;
      sparks.push({ x: Math.cos(a) * rx * d, y: cy + Math.sin(a) * ry * d, life: 1 + Math.random(), size: 8 + Math.random() * 12 });
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
    head.setAttribute("transform", `translate(0 ${f(nod + bounce)}) rotate(${f(rig.tilt + sway)} 0 0)`);

    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const cx = EYE_X[i];
      const raise = (i ? rig.browR : rig.browL) + browPop;
      const slant = i ? rig.slantR : rig.slantL;
      brows[i].setAttribute("d", browCap(side, raise, slant));
      browLines[i].setAttribute("d", browLine(side, raise, slant));

      // The upper lid comes down and the lower lid comes up. Where they meet, the closed eye is a
      // sleepy curve (upper lid wins) or a happy arc (lower lid wins).
      const lidDown = Math.max(i ? rig.lidR : rig.lidL, blink);
      const low = i ? rig.lowR : rig.lowL;
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
      lashes[i].setAttribute("d", lashPath(cx, side, up, open));
      lidLines[i].setAttribute("d", curve(cx, down));
      creases[i].setAttribute("d", curve(cx, up - 7));
      // The spark rides up with the lower lid, so a smiling eye shows all of it, not half.
      const iy = Math.min(EYE_Y - 6 + clamp(rig.lookY) * 5, EYE_Y + down * 0.75 - 10);
      irises[i].setAttribute("transform", `translate(${f(cx + clamp(rig.lookX) * 9)} ${f(iy)})`);
      blushes[i].setAttribute("opacity", f(rig.blush));
    }

    // Mouth: the voice opens it and shapes it; the pose sets the smile. A big smile drops the lower
    // lip with no sound, so the grin shows its teeth like the mask in the film.
    const open = clamp(rig.jaw + speech * (1 - rig.jaw * 0.6), 0, 1);
    const shape = lerp(rig.shape, clamp(rig.shape * 0.4 + speechShape), Math.min(1, speech * 4));
    const round = Math.max(0, -shape);
    const w = 40 + Math.max(0, shape) * 6 - round * 16 + Math.max(0, rig.smile) * 6;
    const dx = rig.smirk * 4;
    const lx = dx - w;
    const rx = dx + w;
    const ly = MOUTH_Y - rig.smile * 12 + rig.smirk * 4;
    const ry = MOUTH_Y - rig.smile * 12 - rig.smirk * 10;
    const kx = 0.55 + round * 0.4; // fuller curves make an O when the lips round
    const c1 = f(dx - w * kx);
    const c2 = f(dx + w * kx);
    const mid = MOUTH_Y + rig.smile * 3; // the middle stays while the corners move
    const grin = Math.max(0, rig.smile - 0.4) * 38 * (1 - round);
    const upY = mid - open * (3 + round * 7);
    const loY = mid + Math.min(48, grin + open * (38 + round * 8)); // the chin sets the limit
    const L = `${f(lx)},${f(ly)}`;
    const R = `${f(rx)},${f(ry)}`;
    const upperInner = `C${c1},${f(upY)} ${c2},${f(upY)} ${R}`;
    const lowerInnerBack = `C${c2},${f(loY)} ${c1},${f(loY)} ${L}`;
    const hole = `M${L} ${upperInner} ${lowerInnerBack}Z`;
    lipUp.setAttribute(
      "d",
      `M${L} C${f(dx - w * 0.6)},${f(upY - 9)} ${f(dx - 8)},${f(upY - 11)} ${f(dx)},${f(upY - 8)} ` +
        `C${f(dx + 8)},${f(upY - 11)} ${f(dx + w * 0.6)},${f(upY - 9)} ${R} C${c2},${f(upY)} ${c1},${f(upY)} ${L}Z`,
    );
    lipLow.setAttribute("d", `M${L} C${c1},${f(loY + 11)} ${c2},${f(loY + 11)} ${R} ${lowerInnerBack}Z`);
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
    const dimple = Math.min(0.35, Math.max(0, rig.smile - 0.4) * 0.9);
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const cx = i ? rx : lx;
      const cy = i ? ry : ly;
      cheekLines[i].setAttribute("d", `M${f(cx + side * 2)},${f(cy - 4)} Q${f(cx + side * 6)},${f(cy)} ${f(cx + side * 3)},${f(cy + 4)}`);
      cheekLines[i].setAttribute("opacity", f(dimple));
    }
  }

  // The canvas covers the stage box at half resolution; it draws in viewBox units.
  let w = 1;
  let h = 1;
  let u = 1;
  function resize() {
    h = Math.max(1, Math.round(canvas.clientHeight / 2));
    w = Math.max(1, Math.round(canvas.clientWidth / 2));
    u = h / VB_H;
    Object.assign(canvas, { width: w, height: h });
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  function drawSmoke(now: number, dt: number) {
    const X = (x: number) => w / 2 + x * u;
    const Y = (y: number) => h / 2 + y * u;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    // Smoke stays inside the glass; the frame covers the hard edge.
    ctx.beginPath();
    ctx.ellipse(X(0), Y(GLASS.cy), GLASS.rx * u, GLASS.ry * u, 0, 0, TAU);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    burst = Math.max(0, burst - dt * 0.6);
    const speed = smoke.speed * (1 + burst * 2);
    const glow = Math.min(1, smoke.alpha * (1 + burst));
    for (const p of puffs) {
      p.a += p.spin * dt * speed;
      p.y -= p.rise * dt * speed;
      if (p.y < -0.15) Object.assign(p, newPuff(false));
      const x = Math.cos(p.a) * p.r;
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
      if (next === "spooky") addSparks(14); // a "hee-hee" twinkle, not a threat
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
          addSparks(25, -110, 70, 30);
          break;
      }
    },
  };
}
