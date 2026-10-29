// N (new visitor) and X (restart), with Groq, speech-to-text and the AI faked.
import { fixture, launch, MIRROR } from "./helper.mjs";
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
await context.route("**/api/stt", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: `I'm visitor number ${chats.length + 1}!`, ms: 5, provider: "groq whisper-large-v3" }) }));
await context.route("**/api/chat", (route) => {
  chats.push(JSON.parse(route.request().postData()).turns);
  const deltas = ["[[mood:happy]] Hello, visitor! ", "My gold frame is shining for you. ", "What is your costume?"];
  route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: deltas.map((d) => `data: ${JSON.stringify({ delta: d })}\n\n`).join("") + 'data: {"done":true,"provider":"mock","firstTokenMs":5}\n\n' });
});
await context.addInitScript(() => {
  window.__stops = 0;
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...a) { window.__stops++; return stop.apply(this, a); };
});
const page = await context.newPage();
let loads = 0;
page.on("load", () => loads++);
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(MIRROR);
await page.waitForTimeout(4000);
await page.keyboard.press("d");
const stateNow = async () => (await page.textContent("#debug"))?.match(/^state\s*(\S+)/m)?.[1];
async function watch(until, ms = 10000) {
  const states = [];
  for (let t = 0; t < ms; t += 50) {
    await page.waitForTimeout(50);
    const s = await stateNow();
    if (states.at(-1) !== s) states.push(s);
    if (await until(s)) break;
  }
  return states;
}
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);

// A first visitor talks once.
await page.keyboard.press("g");
await watch(async (s) => s === "LISTENING" && chats.length === 1 && (await page.textContent("#debug")).includes("What is your costume?"), 15000);
await watch(async (s) => s === "LISTENING");

// 1. N: forget them and start fresh, with the opening.
const ttsBefore = tts.length;
await page.keyboard.press("n");
const states = await watch(async (s) => s === "LISTENING" && false, 2500);
const after = await watch(async (s) => s === "LISTENING");
const all = [...states, ...after].filter((s, i, a) => s !== a[i - 1]);
const panel = await page.textContent("#debug");
console.log("N:", all.join(" > "));
ok(all.join(">").includes("WAKING>SPEAKING") && all.at(-1) === "LISTENING", "N wakes the mirror afresh, speaks the opening, then listens");
ok(!panel.includes("visitor number 1") && panel.includes("mirror: Mirror, mirror, on the wall"), "the transcript starts over with the opening");
ok(tts.length === ttsBefore, "the opening comes from the cache (no Groq request)");
await watch(async () => chats.length >= 2, 10000);
const history = chats[1] ?? [];
console.log("history after N:", history.map((t) => `${t.role}: ${t.content.slice(0, 40)}`).join(" | "));
ok(history.length === 3 && history[0].content.startsWith("(A new visitor") && history[2].content.includes("visitor number 2"), "the AI starts fresh: only the opening and the new child");

// 2. N while the mirror is talking cuts it off.
await watch(async (s) => s === "SPEAKING", 10000);
await page.waitForTimeout(300);
const stopsBefore = await page.evaluate(() => window.__stops);
await page.keyboard.press("n");
await page.waitForTimeout(200);
ok((await page.evaluate(() => window.__stops)) > stopsBefore, "N stops the reply that was playing");

// 3. X reloads the page, which comes back asleep.
const loadsBefore = loads;
await page.keyboard.press("x");
await page.waitForTimeout(4500);
await page.keyboard.press("d");
await page.waitForTimeout(300);
ok(loads === loadsBefore + 1, "X reloads the page");
ok((await stateNow()) === "SLEEPING", "after X the mirror is asleep, ready for G");
const keys = await page.textContent("#debug");
ok(keys.includes("G wake (or say \"hello mirror\") · N new visitor · C treat · H happy halloween · R sleep · X restart · V next voice · D this panel"), "the panel lists N and X");
console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
