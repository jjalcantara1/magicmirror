// The page sends what the D panel shows to the server window, with Groq, hearing and the AI faked.
import { fixture, launch, MIRROR } from "./helper.mjs";
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
const errors = [];
const events = [];
const heard = [];
let reply = ["[[mood:happy]] Ooh, a witch! ", "Is your broom fast?"];
await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
  export const utils = { encodeWAV: () => new ArrayBuffer(44) };
  export const MicVAD = { async new(o) { window.__vad = { o, running: false }; return {
    start() { window.__vad.running = true; }, pause() { window.__vad.running = false; } }; } };
  window.__say = () => { if (!window.__vad?.running) return false; window.__vad.o.onFrameProcessed?.({ isSpeech: 0.9 }, new Float32Array(512)); window.__vad.o.onSpeechEnd(new Float32Array(16000)); return true; };
  export default { utils, MicVAD };` }));
await context.route("**/api/monitor", (route) => { events.push(...JSON.parse(route.request().postData()).events); route.fulfill({ status: 204 }); });
await context.route("**/api/tts", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: fixture("groq-like.wav") }));
await context.route("**/api/stt", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: heard.shift() ?? "", ms: 5, provider: "fake" }) }));
await context.route("**/api/chat", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: reply.map((d) => `data: ${JSON.stringify({ delta: d })}\n\n`).join("") + 'data: {"done":true,"provider":"mock","firstTokenMs":5}\n\n' }));
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(MIRROR);
await page.waitForTimeout(4000);
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
const until = async (test, ms = 10000) => { for (let t = 0; t < ms; t += 50) { if (await test()) return true; await page.waitForTimeout(50); } return false; };
const has = (key, match = () => true) => events.some((e) => e.key === key && match(e.value));
const say = async (text) => { heard.push(text); await until(() => page.evaluate(() => window.__vad?.running), 5000); return page.evaluate(() => window.__say()); };

ok(await until(() => has("state", (v) => v === "SLEEPING") || has("tts")), "the D panel's lines reach the server window, with the panel hidden");
await say("Hello mirror!");
await until(() => has("state", (v) => v === "LISTENING"));
await say("I'm a witch!");
ok(await until(() => has("mirror", (v) => v === "Ooh, a witch! Is your broom fast?")), "the reply, as said");
ok(has("child", (v) => v === "I'm a witch!"), "what the child said");
ok(await until(() => has("reply", (v) => /after the child stopped \(silence \d+ · hearing \d+ · AI \d+ · voice \d+ ms\)/.test(v))), "how long the child waited, step by step");
ok(has("stt", (v) => v.startsWith('woke on "Hello mirror!"')) && has("llm") && has("speech"), "hearing, the AI and the voice lines too");
ok(!events.some((e) => e.key === "mic" || e.key === "keys"), "not the mic meter (it changes many times a second)");
const states = events.filter((e) => e.key === "state").map((e) => e.value);
ok(states.every((s, i) => i === 0 || s !== states[i - 1]), `each change once: ${states.join(" > ")}`);

reply = ["[[alert]] [[mood:gentle]] Oh no! ", "Please find a grown-up right now."];
await until(() => has("state", (v) => v === "LISTENING"));
await say("I can't find my mum.");
ok(await until(() => has("ALERT", (v) => v.includes('"I can\'t find my mum."'))), "an alert, with what the child said");
await page.keyboard.press("n");
ok(await until(() => has("visit")), "a new visitor is marked");
console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
