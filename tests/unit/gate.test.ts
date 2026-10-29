// The near gate: the child at the mirror is answered, crowd chatter further away is not. The party
// is made up here: a crowd of eight voices talking at once, and a child's voice louder on top.
import { createNearGate, rms } from "../../src/nearGate.ts";

const RATE = 16000;
let seed = 1;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// A buzzy "voice" at pitch f0: harmonics that fall off like a voice, a little vibrato, and words
// (syllables at `beat` per second, every third one silent).
function voice(f0: number, seconds: number, beat: number): Float32Array {
  const out = new Float32Array(RATE * seconds);
  const offset = random();
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const f = f0 * (1 + 0.03 * Math.sin(2 * Math.PI * 5 * t));
    phase += (2 * Math.PI * f) / RATE;
    let x = 0;
    for (let k = 1; k <= 20 && k * f < RATE / 2; k++) x += Math.sin(k * phase) / k ** 1.2;
    const b = t * beat + offset;
    out[i] = x * Math.sin(Math.PI * (b % 1)) ** 2 * ((b | 0) % 3 === 2 ? 0 : 1);
  }
  return out;
}

const scaled = (x: Float32Array, level: number) => {
  const k = level / rms(x);
  return x.map((v) => v * k);
};
const add = (a: Float32Array, b: Float32Array, at: number) => {
  const out = a.slice();
  for (let i = 0; i < b.length && at + i < out.length; i++) out[at + i] += b[i];
  return out;
};

let bad = 0;
const ok = (c: boolean, w: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${w}`);
  bad += c ? 0 : 1;
};

// The crowd: eight voices, 20 s, at a steady party level.
let crowd = new Float32Array(RATE * 20);
for (let v = 0; v < 8; v++) crowd = add(crowd, voice(100 + random() * 160, 20, 2 + random() * 1.5), 0);
crowd = scaled(crowd, 0.02);

for (const overDb of [12, 9]) {
  const gate = createNearGate(7);
  // The room: 4 s of listening to the crowd, frame by frame.
  for (let at = 0; at + 512 <= 4 * RATE; at += 512) gate.frame(rms(crowd, at, at + 512));
  // The child: 2 s of talk, louder than the crowd, as the detector hands it over (0.3 s before, 0.7 s after).
  const child = scaled(voice(280, 2, 3), 0.02 * 10 ** (overDb / 20));
  const heard = add(crowd.subarray(5 * RATE, 8 * RATE), child, 0.3 * RATE);
  const judged = gate.judge(heard);
  ok(judged.near, `a child ${overDb} dB over the crowd: +${judged.aboveDb?.toFixed(1)} dB, answered`);
  // Chatter alone: 2 s stretches of the crowd that the detector might pick up.
  let ignored = 0;
  let total = 0;
  for (let at = 4 * RATE; at + 2 * RATE <= crowd.length; at += RATE / 2) {
    total++;
    ignored += gate.judge(crowd.subarray(at, at + 2 * RATE)).near ? 0 : 1;
  }
  ok(ignored >= 0.9 * total, `crowd chatter: ${ignored} of ${total} stretches ignored`);
}

// Someone further away, as loud as the chatter: not answered.
{
  const gate = createNearGate(7);
  for (let at = 0; at + 512 <= 4 * RATE; at += 512) gate.frame(rms(crowd, at, at + 512));
  const far = scaled(voice(220, 2, 3), 0.02);
  const judged = gate.judge(add(crowd.subarray(5 * RATE, 8 * RATE), far, 0.3 * RATE));
  ok(!judged.near, `a voice as loud as the crowd: +${judged.aboveDb?.toFixed(1)} dB, ignored`);
}

const fresh = createNearGate(7);
ok(fresh.judge(new Float32Array(16000)).near, "no room measured yet: everything is answered");
const off = createNearGate(0);
for (let i = 0; i < 100; i++) off.frame(0.1);
const quiet = off.judge(new Float32Array(16000).fill(0.01));
ok(quiet.near && quiet.aboveDb !== undefined && quiet.aboveDb < 0, `MIC_NEAR_DB=0: answered anyway, level still reported (${quiet.aboveDb?.toFixed(0)} dB)`);
process.exit(bad ? 1 : 0);
