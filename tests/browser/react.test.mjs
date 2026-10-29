// The instant reaction: a "Hmm!" the moment the mirror starts thinking, from a clip recorded in
// advance, then the answer right after it. With Groq, hearing and the AI faked; the AI is slow here.
import { fixture, launch, MIRROR } from "./helper.mjs";
const { scriptedTakes, REACTIONS } = await import("../../src/lines.ts");

// The same voice cut short, so the test can tell a reaction (short) from an answer (long).
function shorter(wav, share) {
  const at = wav.indexOf("data") + 8;
  const size = Math.floor((wav.readUInt32LE(at - 4) * share) / 2) * 2;
  const out = Buffer.concat([wav.subarray(0, at), wav.subarray(at, at + size)]);
  out.writeUInt32LE(out.length - 8, 4);
  out.writeUInt32LE(size, at - 4);
  return out;
}
const LONG = fixture("groq-like.wav");
const SHORT = shorter(LONG, 0.3);
const isReaction = (text) => REACTIONS.some((r) => text.endsWith(r));

const browser = await launch();
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
const errors = [];

async function open(reactions) {
  const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
  const log = { tts: [], heard: [] };
  await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
    export const utils = { encodeWAV: () => new ArrayBuffer(44) };
    export const MicVAD = { async new(o) { window.__vad = { o, running: false }; return {
      start() { window.__vad.running = true; }, pause() { window.__vad.running = false; } }; } };
    window.__say = () => { if (!window.__vad?.running) return false; window.__vad.o.onSpeechEnd(new Float32Array(16000)); return true; };
    export default { utils, MicVAD };` }));
  await context.route("**/api/config", async (route) => {
    const res = await route.fetch();
    const config = await res.json();
    config.tts.reactions = reactions;
    route.fulfill({ response: res, json: config });
  });
  await context.route("**/api/tts", (route) => {
    const text = JSON.parse(route.request().postData()).text;
    log.tts.push({ text, at: Date.now() });
    route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: isReaction(text) ? SHORT : LONG });
  });
  await context.route("**/api/stt", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: log.heard.shift() ?? "", ms: 5, provider: "fake" }) }));
  // A slow AI: the answer starts 1.5 s after the question.
  await context.route("**/api/chat", (route) =>
    setTimeout(() => route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: ["[[mood:happy]] A witch! ", "Is your broom fast?"].map((d) => `data: ${JSON.stringify({ delta: d })}\n\n`).join("") + 'data: {"done":true,"provider":"mock","firstTokenMs":5}\n\n' }), 1500));
  // When voice sounds start (and how long they play), when the face starts thinking, and every chime note.
  await context.addInitScript(() => {
    window.__sounds = [];
    window.__thinking = [];
    window.__chimes = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
      if (this.buffer?.duration > 0.2 && this.playbackRate.value < 1) {
        const at = performance.now() + (when - this.context.currentTime) * 1000;
        if (!window.__sounds.some((s) => Math.abs(s.at - at) < 40)) window.__sounds.push({ at, len: (this.buffer.duration / this.playbackRate.value) * 1000 });
      }
      return start.call(this, when, ...rest);
    };
    const osc = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...a) {
      window.__chimes++;
      return osc.apply(this, a);
    };
    new MutationObserver(() => {
      if (document.querySelector('[data-state="thinking"]') && window.__thinking.length % 2 === 0) window.__thinking.push(performance.now());
      if (!document.querySelector('[data-state="thinking"]') && window.__thinking.length % 2 === 1) window.__thinking.push(-1);
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(MIRROR);
  await page.waitForTimeout(4000);
  await page.keyboard.press("d");
  const panel = async () => (await page.textContent("#debug")) ?? "";
  const stateNow = async () => (await panel()).match(/^state\s*(\S+)/m)?.[1];
  const until = async (test, ms = 10000) => { for (let t = 0; t < ms; t += 50) { if (await test()) return true; await page.waitForTimeout(50); } return false; };
  const say = async (text) => { log.heard.push(text); await until(() => page.evaluate(() => window.__vad?.running), 5000); return page.evaluate(() => window.__say()); };
  return { context, page, log, panel, stateNow, until, say };
}

// Reactions on (the default).
{
  const m = await open(true);
  const prepared = m.log.tts.filter((t) => isReaction(t.text)).map((t) => t.text);
  const takes = new Set(scriptedTakes(true));
  ok(prepared.length === REACTIONS.length && prepared.every((t) => takes.has(t)), `the reactions are recorded in advance, exactly as the start-up check pre-records them: ${prepared.join(" ")}`);
  await m.page.keyboard.press("g");
  await m.until(async () => (await m.stateNow()) === "LISTENING");
  const requestsBefore = m.log.tts.length;
  const soundsBefore = await m.page.evaluate(() => window.__sounds.length);
  const chimesBefore = await m.page.evaluate(() => window.__chimes);
  await m.say("I'm a witch!");
  await m.until(async () => (await m.stateNow()) === "THINKING");
  await m.until(async () => (await m.stateNow()) === "LISTENING", 15000);
  const sounds = (await m.page.evaluate(() => window.__sounds)).slice(soundsBefore);
  const thinkingAt = (await m.page.evaluate(() => window.__thinking)).filter((t) => t > 0).at(-1);
  const reply = m.log.tts.slice(requestsBefore).map((t) => t.text);
  console.log("sounds:", sounds.map((s) => `+${Math.round(s.at - thinkingAt)} ms, ${Math.round(s.len)} ms long`).join(" | "), "| requests:", JSON.stringify(reply));
  ok(sounds.length >= 2 && sounds[0].len < 700 && sounds[0].at - thinkingAt < 250, `a short reaction starts the moment the mirror thinks (+${Math.round(sounds[0]?.at - thinkingAt)} ms)`);
  ok(reply.length >= 1 && !reply.some(isReaction), "no Groq request for it at that moment: it was recorded in advance");
  const gap = sounds[1] && sounds[1].at - (sounds[0].at + sounds[0].len);
  ok(sounds[1]?.len > 1000 && gap >= 0 && gap < 2000, `then the answer, after the reaction (${Math.round(gap)} ms later)`);
  ok((await m.page.evaluate(() => window.__chimes)) === chimesBefore, "no chime when the mirror reacts");
  const first = (await m.panel()).match(/^react\s*(.*)$/m)?.[1] ?? "";
  ok(/^"(Hmm!|Aha!|Oh-ho!|Let me see!)" while the AI thinks$/.test(first), `the D panel (and the live log) show it: ${first}`);
  await m.say("I'm a ghost!");
  await m.until(async () => (await m.stateNow()) === "THINKING");
  await m.until(async () => (await m.stateNow()) === "LISTENING", 15000);
  const second = (await m.panel()).match(/^react\s*(.*)$/m)?.[1] ?? "";
  ok(second && second !== first, `never the same reaction twice running: ${second}`);
  await m.context.close();
}

// Reactions off: the soft chime instead.
{
  const m = await open(false);
  ok(!m.log.tts.some((t) => isReaction(t.text)), "REACTIONS=off: nothing recorded in advance");
  await m.page.keyboard.press("g");
  await m.until(async () => (await m.stateNow()) === "LISTENING");
  const chimesBefore = await m.page.evaluate(() => window.__chimes);
  await m.say("I'm a witch!");
  await m.until(async () => (await m.stateNow()) === "THINKING");
  await m.page.waitForTimeout(300);
  ok((await m.page.evaluate(() => window.__chimes)) - chimesBefore === 2, "the soft chime plays instead (two quiet notes)");
  await m.context.close();
}

console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
