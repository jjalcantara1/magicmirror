import { createChunker } from "../../src/conversation.ts";
const split = (reply: string) => { const out: string[] = []; const c = createChunker((ch) => ch.text && out.push(ch.text)); for (const w of reply.split(/(?<= )/)) c.push(w); c.end(); return out; };
const cases: [string, string[]][] = [
  ["[[mood:grand]] You are the fairest of them all! [[mood:wink]] The Queen will be so grumpy. What is your costume?", ["You are the fairest of them all!", "The Queen will be so grumpy.", "What is your costume?"]],
  ["Ooh! A dinosaur, how wonderful! Roar for me!", ["Ooh! A dinosaur, how wonderful!", "Roar for me!"]],
  ["Well, well, my shiny golden frame has seen many brave pirates tonight, but you are the bravest! Take your treat!", ["Well, well, my shiny golden frame has seen many brave pirates tonight,", "but you are the bravest!", "Take your treat!"]],
];
let bad = 0;
for (const [reply, want] of cases) {
  const got = split(reply);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(ok ? "ok  " : "FAIL", JSON.stringify(got));
}
process.exit(bad ? 1 : 0);
