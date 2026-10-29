// Thinking time: unfinished sentences wait for the rest. Groq, speech-to-text and the AI faked.
import { fixture, launch, MIRROR } from "./helper.mjs";
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
const errors = [], tts = [], chats = [];
await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
  export const utils = { encodeWAV: () => new ArrayBuffer(44) };
  export const MicVAD = { async new(o) { let t; return {
    start() { clearTimeout(t); if (!window.__mute) t = setTimeout(() => o.onSpeechEnd(new Float32Array(16000)), 1500); },
    pause() { clearTimeout(t); } }; } };
  export default { utils, MicVAD };` }));
await context.route("**/api/tts", (route) => { tts.push(JSON.parse(route.request().postData()).text); route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: fixture("groq-like.wav") }); });
const said = [];
let heard = []; // what the fake child says next, one per utterance
let muteAfter = ""; // after this answer, the fake child goes quiet
let page;
await context.route("**/api/stt", async (route) => { const text = heard.shift() ?? ""; said.push(text); if (text && text === muteAfter) await page.evaluate(() => (window.__mute = true)); route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text, ms: 5, provider: "groq whisper-large-v3" }) }); });
await context.route("**/api/chat", (route) => {
  chats.push(JSON.parse(route.request().postData()).turns);
  const deltas = ["[[mood:happy]] Hello, friend! ", "My gold frame is shining for you. ", "What is your costume?"];
  route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: deltas.map((d) => `data: ${JSON.stringify({ delta: d })}\n\n`).join("") + 'data: {"done":true,"provider":"mock","firstTokenMs":5}\n\n' });
});
await context.addInitScript(() => {
  window.__stops = 0;
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...a) { window.__stops++; return stop.apply(this, a); };
});
page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(MIRROR);
await page.waitForTimeout(4000);
await page.keyboard.press("d");
const stateNow = async () => (await page.textContent("#debug"))?.match(/^state\s*(\S+)/m)?.[1];
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
async function waitFor(fn, ms = 15000) { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await page.waitForTimeout(50); } return false; }
const lastChild = () => chats.at(-1)?.at(-1)?.content;

// 1. "I'm a..." then "vampire!": one answer to both parts.
heard = ["I'm a...", "vampire!"];
await page.keyboard.press("g");
await waitFor(async () => chats.length === 1);
const panel1 = await page.textContent("#debug");
console.log("1:", JSON.stringify(said), "->", JSON.stringify(lastChild()));
ok(chats.length === 1 && lastChild() === "I'm a... vampire!", "an unfinished sentence waits, and both parts are answered together");
ok(panel1.includes("child:  I'm a... vampire!") && !panel1.includes("child:  I'm a...\n"), "the transcript shows the whole sentence once");

// 2. "My costume is" then only noise: answered as it is, at once.
await waitFor(async () => (await stateNow()) === "LISTENING" && !(await page.textContent("#debug")).includes("thinking"));
heard = ["My costume is", ""];
await waitFor(async () => chats.length === 2);
console.log("2:", JSON.stringify(said.slice(-2)), "->", JSON.stringify(lastChild()));
ok(chats.length === 2 && lastChild() === "My costume is", "if only noise follows, the mirror answers what it heard");

// 3. "Um" then silence: the mirror waits about 2 s, then answers.
await waitFor(async () => (await stateNow()) === "LISTENING");
await page.evaluate(() => (window.__mute = false));
heard = ["Um"];
muteAfter = "Um"; // the child says nothing more
const before = chats.length;
await waitFor(async () => said.at(-1) === "Um");
const t0 = Date.now();
const waiting = await waitFor(async () => (await page.textContent("#debug")).includes("sounds unfinished, waiting for more"), 1000);
await waitFor(async () => chats.length > before, 8000);
const waited = Date.now() - t0;
console.log("3: answered after", waited, "ms ->", JSON.stringify(lastChild()));
ok(waiting, "the panel says it is waiting for more");
ok(chats.length === before + 1 && lastChild() === "Um" && waited >= 1700 && waited <= 3200, "after about 2 s of silence the mirror answers anyway");

// 3b. Two pauses: "I'm a..." + "um..." + "vampire!" -> one answer, sent once.
await page.evaluate(() => (window.__mute = false));
await waitFor(async () => (await stateNow()) === "LISTENING");
heard = ["I'm a...", "um...", "vampire!"];
const m = chats.length;
await waitFor(async () => chats.length > m, 12000);
await page.waitForTimeout(3500); // a second, empty answer would show up here
console.log("3b:", JSON.stringify(chats.slice(m).map((c) => c.at(-1).content)));
ok(chats.length === m + 1 && lastChild() === "I'm a... um... vampire!", "two pauses: one answer to the whole sentence, never an empty one");

// 4. A finished sentence is answered at once.
await page.evaluate(() => (window.__mute = false));
await waitFor(async () => (await stateNow()) === "LISTENING");
heard = ["I'm a dinosaur!"];
const n = chats.length;
await waitFor(async () => said.at(-1) === "I'm a dinosaur!");
const t1 = Date.now();
await waitFor(async () => chats.length > n, 5000);
ok(Date.now() - t1 < 1000 && lastChild() === "I'm a dinosaur!", "a finished sentence gets no extra wait");
console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
