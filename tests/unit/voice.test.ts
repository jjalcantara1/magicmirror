// Checks the deepest-voice picker and the octave layer with voice-like test sounds of known pitch.
process.env.GROQ_API_KEY = "test";
const { findDeepestVoice } = await import("../../server/providers/tts.ts");
import { octaveBelow, stretch } from "../../src/stretch.ts";

const RATE = 24000;
// A buzzy "voice": 30 harmonics falling off like a voice, 5 Hz vibrato, words with pauses between.
function voice(f0: number, seconds = 3): Float32Array {
  const out = new Float32Array(RATE * seconds);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const f = f0 * (1 + 0.03 * Math.sin(2 * Math.PI * 5 * t) + 0.05 * Math.sin(2 * Math.PI * 0.4 * t));
    phase += (2 * Math.PI * f) / RATE;
    let x = 0;
    for (let k = 1; k <= 30 && k * f < RATE / 2; k++) x += Math.sin(k * phase + k * k * 0.3) / k ** 1.2;
    const word = Math.sin(Math.PI * ((t * 2.5) % 1)) ** 2 * (((t * 2.5) | 0) % 3 === 2 ? 0 : 1); // every third beat silent
    out[i] = 0.2 * x * word + 0.002 * (Math.random() - 0.5);
  }
  return out;
}
// 16-bit WAV with an extra LIST chunk and an open data size, like some TTS servers send.
function wav(samples: Float32Array): ArrayBuffer {
  const list = 26;
  const buf = new ArrayBuffer(12 + 24 + 8 + list + 8 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 0xffffffff, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "LIST"); v.setUint32(40, list, true);
  str(44 + list, "data"); v.setUint32(48 + list, 0xffffffff, true);
  samples.forEach((s, i) => v.setInt16(52 + list + i * 2, Math.max(-32768, Math.min(32767, Math.round(s * 32767))), true));
  return buf;
}

process.env.GROQ_API_KEY = "test";
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
const near = (got: number, want: number) => Math.abs(got - want) / want < 0.06;

// 1. Picks the lowest of three voices.
const pitch: Record<string, number> = { troy: 118, daniel: 96, austin: 132 };
let requests = 0;
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  requests++;
  const { voice: name } = JSON.parse(String(init.body));
  return new Response(wav(voice(pitch[name])), { status: 200 });
}) as typeof fetch;
let t = performance.now();
const result = await findDeepestVoice(["troy", "daniel", "austin"], "m");
console.log("measured:", result.pitches, `in ${Math.round(performance.now() - t)} ms`);
check(result.voice === "daniel", "picks daniel, the lowest");
for (const [name, f] of Object.entries(pitch)) check(near(result.pitches[name], f), `${name}: ${result.pitches[name]} Hz, made at ${f}`);
check(requests === 3, "one request per voice");

// 2. The octave layer is an octave below the deepened voice, as long, with no clicks.
const base = voice(120);
const deep = stretch(base, 0.7, RATE); // the worker's step; played at rate 0.7 later
const low = octaveBelow(deep, RATE);
check(low.length === deep.length, `octave layer as long as the voice (${low.length} = ${deep.length})`);
globalThis.fetch = (async (_u: string, init: RequestInit) => {
  const { voice: name } = JSON.parse(String(init.body));
  return new Response(wav(name === "low" ? low : deep), { status: 200 });
}) as typeof fetch;
const pair = await findDeepestVoice(["main", "low"], "m");
console.log("main vs octave layer (before playback slows both by 0.7):", pair.pitches);
check(near(pair.pitches.main, 120) && near(pair.pitches.low, 60), "main keeps 120 Hz, the layer is 60 Hz");
const jump = (a: Float32Array) => { let m = 0; for (let i = 1; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1])); return m; };
console.log(`biggest sample step: voice ${jump(deep).toFixed(3)}, octave layer ${jump(low).toFixed(3)}`);
check(jump(low) <= jump(deep) * 1.2, "no clicks in the octave layer");
t = performance.now();
octaveBelow(stretch(voice(110, 6), 0.7, RATE), RATE);
console.log(`stretch + octave for 6 s of audio: ${Math.round(performance.now() - t)} ms`);

// 3. A refused voice makes the whole pick fail, so the server keeps its default.
globalThis.fetch = (async () => new Response("terms", { status: 400 })) as typeof fetch;
check(await findDeepestVoice(["troy"], "m").then(() => false, (e: Error) => /400/.test(e.message)), "a Groq refusal rejects the pick");
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
