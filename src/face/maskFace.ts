import "./maskFace.css";
import type { Effect, Face, FaceState } from "./face.ts";

// Original design: a pale theatrical mask with teal eye-glow and filigree, floating in smoke.
const SVG = `
<svg class="mask" viewBox="-120 -195 240 335" aria-hidden="true">
  <defs>
    <radialGradient id="mm-skin" cx="0" cy="-35" r="150" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f7f4ed"/>
      <stop offset="0.55" stop-color="#dfe5de"/>
      <stop offset="1" stop-color="#8eaaa2"/>
    </radialGradient>
    <radialGradient id="mm-eye">
      <stop offset="0" stop-color="#f4fffc"/>
      <stop offset="0.3" stop-color="#7cf5d8"/>
      <stop offset="0.7" stop-color="#1fb894" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#0a5a4a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mm-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3b8"/>
      <stop offset="1" stop-color="#d39a2b"/>
    </linearGradient>
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
    <g fill="none" stroke="#7d958e" stroke-width="3" stroke-linecap="round">
      <path d="M-65,-41 Q-41,-59 -15,-43"/>
      <path d="M65,-41 Q41,-59 15,-43"/>
    </g>
    <g transform="translate(-38,-16)"><g class="eye">
      <g class="open"><path d="M-24,0 Q0,-15 24,0 Q0,13 -24,0 Z" fill="#13201e"/><ellipse class="iris" rx="13" ry="7" fill="url(#mm-eye)"/></g>
      <path class="lid" d="M-24,0 Q0,9 24,0" stroke="#6f8780" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    </g></g>
    <g transform="translate(38,-16)"><g class="eye">
      <g class="open"><path d="M-24,0 Q0,-15 24,0 Q0,13 -24,0 Z" fill="#13201e"/><ellipse class="iris" rx="13" ry="7" fill="url(#mm-eye)"/></g>
      <path class="lid" d="M-24,0 Q0,9 24,0" stroke="#6f8780" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    </g></g>
    <path d="M-2,-10 C-6,12 -12,26 -10,32 C-4,36 4,36 10,32" stroke="#a7b7b1" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M-27,63 Q0,57 27,63" stroke="#9db0aa" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse class="mouth" cx="0" cy="66" rx="20" ry="2.5" fill="#142120"/>
  </g>
</svg>`;

// Smoke speed and brightness for each state.
const SMOKE: Record<FaceState, { speed: number; alpha: number }> = {
  asleep: { speed: 0.35, alpha: 0.22 },
  waking: { speed: 2.2, alpha: 0.9 },
  listening: { speed: 1, alpha: 0.65 },
  thinking: { speed: 3, alpha: 0.85 },
  speaking: { speed: 1.2, alpha: 0.7 },
};
const TAU = Math.PI * 2;
const FRAME_MS = 33; // ~30 fps: the GPU is shared with the Kokoro voice

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
  const mouth = root.querySelector<SVGEllipseElement>(".mouth")!;
  const flash = document.querySelector<HTMLDivElement>("#flash")!;
  const puffSprites = [sprite("70 230 190"), sprite("40 170 200")];
  const sparkSprite = sprite("255 240 190", 32);

  const puffs = Array.from({ length: 36 }, () => newPuff(true));
  let sparks: Spark[] = [];
  let smoke = SMOKE.asleep;
  let burst = 0;
  let mouthTarget = 0;
  let mouthNow = 0;
  let last = performance.now();
  const timers = new Map<string, number>();

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

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dtMs = now - last;
    if (dtMs < FRAME_MS) return;
    last = now;
    const dt = Math.min(dtMs, 100) / 1000;

    mouthNow += (mouthTarget - mouthNow) * 0.5;
    mouth.setAttribute("ry", (2.5 + mouthNow * 18).toFixed(1));
    mouth.setAttribute("rx", (20 + mouthNow * 4).toFixed(1));
    mouth.setAttribute("cy", (66 + mouthNow * 4).toFixed(1));

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
  requestAnimationFrame(frame);

  return {
    setState(state) {
      root.dataset.state = state;
      smoke = SMOKE[state];
    },
    setMouth(open) {
      mouthTarget = open;
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
