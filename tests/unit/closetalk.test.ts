// Ending a sentence by loudness, for a child talking straight into the mic at a loud party.
const { createCloseTalk } = await import("../../src/closeTalk.ts");
const { createNearGate } = await import("../../src/nearGate.ts");
let bad = 0;
const ok = (c: boolean, w: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${w}`);
  bad += c ? 0 : 1;
};
const ROOM = 0.01;
const CHILD = 0.1; // +20 dB: talking into the mic
const CROWD = 0.02; // +6 dB: chatter the speech detector still calls "speech"
const db = (x: number) => 10 ** (x / 20);

// Feeds levels until a verdict; returns the verdict and after how many ms.
function run(levels: number[], room: number | null = ROOM, nearDb = 12) {
  const close = createCloseTalk({ nearDb, endMs: 600 });
  close.start();
  for (let i = 0; i < levels.length; i++) {
    const v = close.frame(levels[i], room ?? undefined);
    if (v) return { v, ms: (i + 1) * 32 };
  }
  return { v: undefined, ms: levels.length * 32 };
}
const frames = (level: number, ms: number) => Array(Math.round(ms / 32)).fill(level);

let r = run([...frames(CHILD, 1500), ...frames(CROWD, 3000)]);
ok(r.v === "end" && r.ms >= 1500 + 576 && r.ms <= 1500 + 672, `the child stops, the crowd goes on: ends ${r.ms - 1500} ms after the child stopped`);
r = run([...frames(CHILD, 700), ...frames(CROWD, 300), ...frames(CHILD, 700), ...frames(CROWD, 3000)]);
ok(r.v === "end" && r.ms > 1700, "a short pause between words (300 ms) does not end it");
r = run(frames(CROWD, 5000));
ok(r.v === "drop" && r.ms >= 1984 && r.ms <= 2016, `only chatter: dropped after ${r.ms} ms, so it cannot swallow a child's sentence`);
r = run(frames(CHILD, 20_000));
ok(r.v === "end" && r.ms >= 11_968 && r.ms <= 12_032, `a child who never stops: ends at ${r.ms} ms`);
r = run([...frames(CHILD, 500), ...frames(ROOM, 3000)], null);
ok(r.v === undefined, "the room not measured yet: the speech detector decides alone");
r = run([...frames(ROOM * db(8), 1000), ...frames(CROWD, 3000)]);
ok(r.v === "drop", "a voice only 8 dB over the room is not a child at the mic (12 dB setting)");

const gate = createNearGate(12);
ok(gate.room() === undefined, "the room level is unknown at first");
for (let i = 0; i < 100; i++) gate.frame(i % 5 === 0 ? 0.05 : ROOM);
ok(Math.abs((gate.room() ?? 0) - ROOM) < 1e-9, "the room level is its quieter moments, not its loud ones");
process.exit(bad ? 1 : 0);
