// The C and H keys: from sleep, and in the middle of an AI reply. Groq, speech-to-text and the AI faked.
import { fixture, launch, MIRROR } from "./helper.mjs";
const { CUES } = await import("../../src/lines.ts");
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
const errors = [], tts = [], chats = [];
await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
  export const utils = { encodeWAV: () => new ArrayBuffer(44) };
  export const MicVAD = { async new(o) { let t; return {
    start() { clearTimeout(t); t = setTimeout(() => o.onSpeechEnd(new Float32Array(16000)), 1500); },
    pause() { clearTimeout(t); } }; } };
  export default { utils, MicVAD };` }));
await context.route("**/api/tts", (route) => { tts.push(JSON.parse(route.request().postData()).text); route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: fixture("groq-like.wav") }); });
await context.route("**/api/stt", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "I'm a vampire!", ms: 5, provider: "groq whisper-large-v3" }) }));
await context.route("**/api/chat", (route) => {
  chats.push(JSON.parse(route.request().postData()).turns);
  const deltas = ["[[mood:excited]] A vampire in my hall! ", "Your cape is magnificent. ", "Show me your spookiest laugh, and a treat is yours! ", "I am waiting, little bat!"];
  route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: deltas.map((d) => `data: ${JSON.stringify({ delta: d })}\n\n`).join("") + 'data: {"done":true,"provider":"mock","firstTokenMs":5}\n\n' });
});
await context.addInitScript(() => {
  window.__stops = 0;
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...a) { window.__stops++; return stop.apply(this, a); };
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(MIRROR);
await page.waitForTimeout(4000);
await page.keyboard.press("d");
const stateNow = async () => (await page.textContent("#debug")).match(/^state\s*(\S+)/m)?.[1];
const mood = () => page.evaluate(() => document.querySelector("[data-mood]")?.dataset.mood);
async function watch(until, ms = 8000) {
  const states = [];
  let moods = new Set();
  for (let t = 0; t < ms; t += 50) {
    await page.waitForTimeout(50);
    const s = await stateNow();
    if (states.at(-1) !== s) states.push(s);
    moods.add(await mood());
    if (await until(s)) break;
  }
  return { states, moods: [...moods].filter(Boolean) };
}
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
const CANDY = CUES.candy.lines;

// 1. C from sleep: wakes, says a treat line in an excited tone, shows the excited face, then listens.
await page.keyboard.press("c");
const c1 = await watch(async (s) => s === "LISTENING");
const candy1 = tts[0];
console.log("C from sleep:", c1.states.join(" > "), "|", candy1, "| moods", c1.moods.join(","));
ok(c1.states.join(">") === "WAKING>SPEAKING>LISTENING", "C wakes the mirror, speaks, then listens");
ok(CANDY.some((l) => candy1 === `[cheerful] ${l}`), "a treat line, in a cheerful tone");
ok(c1.moods.includes("excited"), "the excited face shows");
ok(chats.length === 0, "no AI call for the key line");

// 2. The child speaks (stand-in), the AI reply starts; H cuts it off mid-reply.
await watch(async (s) => s === "SPEAKING" && chats.length === 1, 10000);
const before = { tts: tts.length, stops: await page.evaluate(() => window.__stops) };
await page.waitForTimeout(600); // into the reply
await page.keyboard.press("h");
const h = await watch(async (s) => s === "LISTENING", 10000);
const stops = (await page.evaluate(() => window.__stops)) - before.stops;
const halloween = tts.slice(before.tts).find((t) => /halloween/i.test(t));
console.log("H mid-reply:", h.states.join(" > "), "|", halloween, "| sounds stopped:", stops);
ok(stops > 0, "H stops the reply that was playing");
ok(halloween?.startsWith("[cheerful] ") && /happy halloween/i.test(halloween), "a Happy Halloween line, in a cheerful tone");
ok(h.moods.includes("happy"), "the happy face shows");

// 3. The next AI request knows what the mirror said.
await watch(async () => chats.length >= 2, 10000);
const history = chats[1] ?? [];
console.log("history:", history.map((t) => `${t.role}: ${t.content.slice(0, 60)}`).join(" | "));
ok(history.some((t) => t.content === "(The mirror grants the visitor a treat.)") && history.some((t) => t.role === "assistant" && t.content.includes(candy1.replace("[cheerful] ", ""))), "history: the treat note and line");
ok(history.some((t) => t.content === "(The visitor is leaving.)") && history.some((t) => t.role === "assistant" && /happy halloween/i.test(t.content)), "history: the Halloween note and line");

// 4. C twice in a row never repeats a line; the panel lists the keys.
await page.keyboard.press("c");
await page.waitForTimeout(300);
await page.keyboard.press("c");
await page.waitForTimeout(800);
// From the transcript, not the voice requests: a line said before comes from the cache.
const treats = (await page.textContent("#debug")).split("\n").filter((l) => CANDY.some((c) => l === `mirror: ${c}`));
console.log("treat lines so far:", treats.length);
ok(treats.length >= 3 && treats.every((t, i) => i === 0 || t !== treats[i - 1]), "never the same treat line twice running");
const panel = await page.textContent("#debug");
ok(panel.includes("G wake (or say \"hello mirror\") · N new visitor · C treat · H happy halloween · R sleep · X restart · V next voice · D this panel"), "the panel lists the keys");
console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
