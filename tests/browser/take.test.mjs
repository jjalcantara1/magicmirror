// How Groq is asked for a line, with Groq, speech-to-text and the AI faked:
// 1. a slow AI: the first sentence goes to Groq at once; the rest follows when the AI sends it;
// 2. a long reply: the first sentence alone, the rest in takes of at most 200 characters, all asked
//    for side by side, played in order even when a later take comes back first, with breaths between;
// 3. N pressed while the rest of a line is held: no Groq request is spent on it;
// 4. Groq refusing: the reply still ends and the mirror listens again.
// Also the D panel's timing breakdown.
import { fixture, launch, MIRROR } from "./helper.mjs";
import { createServer } from "node:http";

// The same voice, cut to 45% of its length, so the test can tell takes apart by length.
function shorter(wav, share) {
  const at = wav.indexOf("data") + 8;
  const size = Math.floor((wav.readUInt32LE(at - 4) * share) / 2) * 2;
  const out = Buffer.concat([wav.subarray(0, at), wav.subarray(at, at + size)]);
  out.writeUInt32LE(out.length - 8, 4);
  out.writeUInt32LE(size, at - 4);
  return out;
}
const LONG_WAV = fixture("groq-like.wav");
const SHORT_WAV = shorter(LONG_WAV, 0.45);

// The slow AI: the first words at once, the rest 2.5 s later.
let slowFirstAt = 0;
let slowText = ["", ""];
const slow = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ delta: slowText[0] })}\n\n`);
    slowFirstAt = Date.now();
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ delta: slowText[1] })}\n\n`);
      res.end('data: {"done":true,"provider":"slow","firstTokenMs":5}\n\n');
    }, 2500);
  });
}).listen(5199);

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
const errors = [];
const tts = []; // { text, at }
let ttsFail = false;
let mode = "slow";
let chats = 0;
// 20 words (the most a reply may have), but more than Groq's 200 characters after the first sentence.
const LONG = [
  "[[mood:grand]] Magnificent! Extraordinary! Spectacular! ",
  "Your marvellous costume is absolutely unbelievable, wonderfully frightening and incredibly imaginative! ",
  "[[mood:wink]] Unquestionably, the enchanted looking-glass congratulates everybody!",
];
await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
  export const utils = { encodeWAV: () => new ArrayBuffer(44) };
  export const MicVAD = { async new(o) { let t; return {
    start() { clearTimeout(t); t = setTimeout(() => o.onSpeechEnd(new Float32Array(16000)), 1500); },
    pause() { clearTimeout(t); } }; } };
  export default { utils, MicVAD };` }));
await context.route("**/api/tts", async (route) => {
  const text = JSON.parse(route.request().postData()).text;
  tts.push({ text, at: Date.now() });
  if (ttsFail) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "rate limited for 50 s more" }) });
  // Long reply: the first take comes back slowly, the second quickly and shorter.
  if (mode === "long" && text.startsWith("[cheerful] Magnificent")) await new Promise((r) => setTimeout(r, 1200));
  const body = mode === "long" && text.includes("Spectacular") ? SHORT_WAV : LONG_WAV;
  route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body });
});
await context.route("**/api/stt", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Hello mirror!", ms: 5, provider: "fake" }) }));
await context.route("**/api/chat", (route) => {
  chats++;
  if (mode === "slow") return route.continue({ url: "http://127.0.0.1:5199/chat" });
  const deltas =
    mode === "long" ? LONG
    : mode === "mixed" ? ["[[mood:happy]] Hello! 你好，小朋友！ ", "What a spooky costume!"]
    : mode === "chinese" ? ["[[mood:happy]] 你好！", "小朋友，万圣节快乐！"]
    : ["[[mood:happy]] Hello, brave friend! ", "What is your costume?"];
  route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: deltas.map((d) => `data: ${JSON.stringify({ delta: d })}\n\n`).join("") + 'data: {"done":true,"provider":"mock","firstTokenMs":5}\n\n' });
});
// When each voice sound starts and how long it plays, in page time (ms).
await context.addInitScript(() => {
  window.__sounds = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
    if (this.buffer?.duration > 0.3 && this.playbackRate.value < 1) {
      const at = performance.now() + (when - this.context.currentTime) * 1000;
      if (!window.__sounds.some((s) => Math.abs(s.at - at) < 40)) window.__sounds.push({ at, len: (this.buffer.duration / this.playbackRate.value) * 1000 });
    }
    return start.call(this, when, ...rest);
  };
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(MIRROR);
await page.waitForTimeout(4000);
await page.keyboard.press("d");
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
const panel = async () => (await page.textContent("#debug")) ?? "";
const stateNow = async () => (await panel()).match(/^state\s*(\S+)/m)?.[1];
async function until(test, ms = 15000) {
  for (let t = 0; t < ms; t += 50) {
    if (await test()) return true;
    await page.waitForTimeout(50);
  }
  return false;
}

// 1. A slow AI.
slowText = ["[[mood:happy]] Hello there, brave friend! ", "[[mood:wink]] My frame is gold. What is your costume?"];
await page.keyboard.press("g");
await until(() => slowFirstAt > 0);
await until(async () => tts.some((t) => t.text.includes("My frame is gold")) && (await stateNow()) === "LISTENING", 12000);
const first = tts.find((t) => t.text.includes("Hello there"));
const rest = tts.find((t) => t.text.includes("My frame is gold"));
console.log("slow AI requests:", tts.slice(1).map((t) => `${t.text} (+${t.at - slowFirstAt} ms)`).join(" | "));
ok(first?.text === "[cheerful] Hello there, brave friend!" && first.at - slowFirstAt < 300, `slow AI: the first sentence goes to Groq at once (${first && first.at - slowFirstAt} ms)`);
ok(rest?.text === "[playful] My frame is gold. What is your costume?" && rest.at - slowFirstAt >= 2400, "slow AI: the rest is one more take, in its own tone");
const timing = (await panel()).match(/^reply\s*(.*)$/m)?.[1] ?? "";
console.log("reply line:", timing);
ok(/after the child stopped \(silence 6\d\d · hearing \d+ · AI \d+ · voice \d+ ms\)/.test(timing), "D panel: the time to reply, step by step");

// 2. A long reply.
mode = "long";
const before = tts.length;
const soundsBefore = await page.evaluate(() => window.__sounds.length);
await until(async () => chats >= 2 && tts.length >= before + 3 && (await stateNow()) === "LISTENING", 15000);
const takes = tts.slice(before);
console.log("long reply takes:", takes.map((t) => `+${t.at - takes[0].at} ms ${t.text.length}: ${t.text}`).join("\n  "));
ok(takes[0]?.text === "[cheerful] Magnificent! Extraordinary!", "long reply: the first sentence alone");
ok(takes.length === 3 && takes.every((t) => t.text.length <= 200 && /[.!?]$/.test(t.text)), "long reply: the rest in takes within 200 characters, each ending with a whole sentence");
ok(takes.every((t) => t.at - takes[0].at < 300), "long reply: all takes asked for side by side, not one after another");
const sounds = (await page.evaluate(() => window.__sounds)).slice(soundsBefore);
console.log("sounds:", sounds.map((s) => `${Math.round(s.at)}+${Math.round(s.len)}`).join(", "));
ok(sounds.length === 3 && sounds[1].len < sounds[0].len * 0.6 && sounds[2].len > sounds[1].len * 1.5, "long reply: played in order, though the second take came back first");
const breaths = sounds.slice(1).map((s, i) => s.at - (sounds[i].at + sounds[i].len));
ok(breaths.length === 2 && breaths.every((b) => b > 250 && b < 420), `long reply: a breath between the takes (${breaths.map(Math.round).join(", ")} ms)`);

// 3. N while the rest of a line is held.
mode = "slow";
slowFirstAt = 0;
slowText = ["[[mood:happy]] Ooh, a pumpkin hat! I love it so much. ", "[[mood:wink]] I would wear one too."];
await until(() => slowFirstAt > 0, 15000);
await page.waitForTimeout(300);
await page.keyboard.press("n");
await page.waitForTimeout(2000);
ok(tts.some((t) => t.text.includes("pumpkin hat")) && !tts.some((t) => t.text.includes("I love it")), "N while the rest was held: no Groq request spent on it");
ok(await until(async () => (await stateNow()) === "LISTENING", 8000), "N: the opening plays again and the mirror listens");

// 4. Groq refusing.
mode = "fast";
ttsFail = true;
const chatsBefore = chats;
const refusedBefore = tts.length;
await until(() => chats > chatsBefore && tts.length > refusedBefore + 1, 10000);
const back = await until(async () => (await stateNow()) === "LISTENING" && /Groq:/.test(await panel()), 10000);
await page.waitForTimeout(300);
const speech = (await panel()).match(/^speech\s*(.*)$/m)?.[1] ?? "";
console.log("speech line:", speech, "| requests:", JSON.stringify(tts.slice(refusedBefore).map((t) => t.text)));
ok(back, "Groq refusing: the reply still ends and the mirror listens again");
ok(tts.length - refusedBefore === 2 && /Groq: rate limited/.test(speech), "Groq refusing: one request per take, then the backup is tried");

// 5. Replies in another script.
ttsFail = false;
for (const [m, expect, what] of [
  ["mixed", (t) => t.join(" ") === "[cheerful] Hello! What a spooky costume!" && !t.some((x) => /[\u3000-\u9fff\uff00-\uffef]/.test(x)), "a reply with Chinese in it: only the English is said"],
  ["chinese", (t) => t.length === 1 && t[0] === "[playful] Oops! A smudge on my glass! Can you ask me again?", "a reply all in Chinese: the mirror asks again instead"],
]) {
  await until(async () => (await stateNow()) === "LISTENING", 10000);
  mode = m;
  const from = tts.length;
  const c0 = chats;
  await until(async () => chats > c0 && tts.length > from && (await stateNow()) === "LISTENING", 10000);
  await page.waitForTimeout(300);
  const said = tts.slice(from).map((t) => t.text);
  console.log(m, JSON.stringify(said));
  ok(expect(said), what);
}

console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
slow.close();
