// A full exchange with Groq, speech-to-text and the AI faked: the fake mic "speaks", the mirror
// answers with two moods. The first sentence goes to Groq alone, the rest as one take, each with its
// tone, and the face changes mood as the cheeky words start.
import { fixture, launch, MIRROR } from "./helper.mjs";
const acting = process.argv[2] !== "off";
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
const errors = [];
const tts = [];
const chats = [];
await context.route("**/api/tts", (route) => { tts.push(JSON.parse(route.request().postData()).text); route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: fixture("groq-like.wav") }); });
await context.route("**/api/stt", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Me! I'm the fairest!", ms: 5 }) }));
await context.route("**/api/chat", (route) => {
  chats.push(JSON.parse(route.request().postData()).turns);
  const deltas = ["[[effect:thunder]] [[mood:grand]] Yes! You beat the Queen ", "by a mile! [[mood:wink]] Translation: you win! ", "What are you dressed as?"];
  route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: deltas.map((d) => `data: ${JSON.stringify({ delta: d })}\n\n`).join("") + 'data: {"done":true,"provider":"mock","firstTokenMs":5}\n\n' });
});
// Headless Chrome never finishes starting the real voice detector, so a stand-in "hears" the child
// 1.5 s after the mirror starts listening.
await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
  export const utils = { encodeWAV: () => new ArrayBuffer(44) };
  export const MicVAD = { async new(o) { let t; return {
    start() { clearTimeout(t); t = setTimeout(() => o.onSpeechEnd(new Float32Array(16000)), 1500); },
    pause() { clearTimeout(t); } }; } };
  export default { utils, MicVAD };` }));
// Log when each sound is set to start and when the face changes mood, both in page time (ms).
await context.addInitScript(() => {
  window.__log = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
    if (this.buffer?.duration > 0.5 && this.playbackRate.value < 1) window.__log.push({ sound: Math.round(performance.now() + (when - this.context.currentTime) * 1000), len: Math.round((this.buffer.duration / this.playbackRate.value) * 1000) });
    return start.call(this, when, ...rest);
  };
  new MutationObserver(() => {
    const m = document.querySelector("[data-mood]")?.dataset.mood;
    if (m) window.__log.push({ mood: m, at: Math.round(performance.now()) });
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-mood"] });
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() !== "debug") console.log("[console]", m.type(), m.text().slice(0, 200)); });
await page.goto(MIRROR);
await page.waitForTimeout(4000);
await page.keyboard.press("d");
await page.keyboard.press("g");
for (let i = 0; i < 300 && chats.length < 2; i++) await page.waitForTimeout(100);
await page.waitForTimeout(500);
const panel = await page.textContent("#debug");
console.log(`[acting ${acting ? "on" : "off"}] Groq requests:\n  ${tts.join("\n  ")}`);
console.log(panel.split("\n").filter((l) => /^(state|stt|llm|reply)|mirror:|child:/.test(l)).join("\n"));
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
const replyReqs = tts.slice(1);
if (acting) {
  ok(tts[0].startsWith("[cheerful] Mirror, mirror, on the wall"), "the opening is said in a cheerful tone");
  ok(replyReqs.length === 2, `the first sentence, then the rest; the same reply again comes from memory (${replyReqs.length} requests)`);
  ok(replyReqs[0] === "[cheerful] Yes! You beat the Queen by a mile!", "the grand first sentence alone, cheerful");
  ok(replyReqs[1] === "[playful] Translation: you win! What are you dressed as?", "the cheeky rest as one take, playful, one direction");
} else {
  ok(tts.every((t) => !t.includes("[")), "acting off: no directions sent");
}
ok(chats.length >= 2, `the child spoke twice and the AI was asked twice (${chats.length})`);
const history = chats[1] ?? [];
ok(history[1]?.content.startsWith("[[effect:thunder]] [[mood:grand]] Mirror, mirror"), "history: the opening with its tags");
ok(history.some((t) => t.role === "assistant" && t.content.includes("[[mood:wink]] Translation")), "history: the reply keeps its mood tags in place");
ok(!panel.includes("[["), "the transcript shows no tags");
const log = await page.evaluate(() => window.__log);
// Each sound starts twice (voice and octave layer); keep one per moment.
const sounds = [...new Set(log.filter((e) => e.sound).map((e) => e.sound))];
const lengths = Object.fromEntries(log.filter((e) => e.sound).map((e) => [e.sound, e.len]));
const moods = log.filter((e) => e.mood);
const near = (t) => sounds.some((s) => Math.abs(s - t) < 60);
console.log("sounds start at:", sounds.join(", "), "\nmoods:", moods.map((m) => `${m.mood}@${m.at}`).join(", "));
// The face also winks by itself after 2.6 s of grand face (maskFace GRAND_SECONDS), so look for the
// reply's own wink: one that lands exactly as a sound starts.
// The cheeky words are the second take: the wink comes as it starts, after the first take and a breath.
const replyGrand = moods.filter((m) => m.mood === "grand")[1]; // [0] is the opening
const wink = moods.find((m) => m.mood === "wink" && replyGrand && m.at > replyGrand.at);
if (acting) {
  ok(replyGrand && near(replyGrand.at), "the grand face appears as the grand words start");
  ok(wink && near(wink.at) && wink.at > replyGrand.at + 400, "the cheeky face waits for the cheeky words");
}
console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
