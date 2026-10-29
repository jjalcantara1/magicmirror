process.env.GROQ_API_KEY = "x";
const { findDeepestVoice } = await import("../../server/providers/tts.ts");
import { stretch, tightenPauses } from "../../src/stretch.ts";
const RATE = 24000;
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
const sec = (a: Float32Array) => a.length / RATE;
const hiss = (s: number) => new Float32Array(Math.round(s * RATE)).map(() => 0.0005 * (Math.random() - 0.5));
const tone = (s: number, fadeIn = 0) => new Float32Array(Math.round(s * RATE)).map((_, i) => 0.5 * Math.sin(i * 0.05) * Math.min(1, fadeIn ? (i / RATE / fadeIn) ** 2 : 1));
const join = (...parts: Float32Array[]) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

// 1. Pauses: 0.3 s lead, word, 0.8 s pause, word with a soft start, 0.15 s pause, word, 0.4 s tail.
const wordA = tone(0.5), wordB = tone(0.5, 0.08), wordC = tone(0.3);
const speech = join(hiss(0.3), wordA, hiss(0.8), wordB, hiss(0.15), wordC, hiss(0.4));
const tight = tightenPauses(speech, RATE);
console.log(`pauses: ${sec(speech).toFixed(2)} s -> ${sec(tight).toFixed(2)} s`);
check(Math.abs(sec(tight) - (0.04 + 0.5 + 0.4 + 0.5 + 0.15 + 0.3 + 0.04)) < 0.03, "lead and tail cut to 40 ms, the long pause to 0.4 s, the short pause kept");
const find = (needle: Float32Array) => { outer: for (let i = 0; i + needle.length <= tight.length; i++) { for (let k = 0; k < needle.length; k += 97) if (tight[i + k] !== needle[k]) continue outer; return i; } return -1; };
check(find(wordA) >= 0 && find(wordB) >= 0 && find(wordC) >= 0, "every word kept whole, the soft start of the second too");
check(tightenPauses(hiss(1), RATE).length === RATE, "all-quiet audio is left alone");

// 2. Speed: the worker stretches by pitch/speed and plays at the pitch rate.
const voice = (f0: number, s: number) => new Float32Array(Math.round(s * RATE)).map((_, i) => { let x = 0; for (let k = 1; k < 20; k++) x += Math.sin((2 * Math.PI * f0 * k * i) / RATE) / k; return 0.2 * x; });
const plain = voice(120, 3);
const pitch = 0.7;
for (const speed of [1]) {
  const made = stretch(plain, pitch / speed, RATE);
  const playSeconds = sec(made) / pitch;
  globalThis.fetch = (async () => {
    const v = new DataView(new ArrayBuffer(44 + made.length * 2));
    const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF"); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, made.length * 2, true); made.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(s * 32767), true));
    return new Response(v.buffer);
  }) as typeof fetch;
  process.env.GROQ_API_KEY = "x";
  const hz = (await findDeepestVoice(["v"], "m")).pitches.v * pitch;
  console.log(`speed ${speed}: 3.00 s of speech plays in ${playSeconds.toFixed(2)} s at ${hz.toFixed(0)} Hz`);
  check(Math.abs(playSeconds - 3 / speed) < 0.02 && Math.abs(hz - 84) < 4, `speed ${speed}: ${(3 / speed).toFixed(2)} s, pitch still 84 Hz`);
}
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
