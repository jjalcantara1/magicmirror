// Wakes the mirror with Groq and the AI faked: the opening must be the scripted line, need no AI call,
// play with the octave layer under it, and come from the cache on the second visit.
import { fixture, launch, MIRROR } from "./helper.mjs";
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
const errors = [];
const ttsTexts = [];
let chatCalls = 0;
await context.route("**/api/tts", (route) => {
  ttsTexts.push(JSON.parse(route.request().postData()).text);
  route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: fixture("groq-like.wav") });
});
await context.route("**/api/chat", (route) => { chatCalls++; route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: 'data: {"delta":"Behold!"}\n\ndata: {"done":true,"provider":"mock","firstTokenMs":5}\n\n' }); });
// Record every sound the page starts: the voice and its octave layer start together, at the same rate.
await context.addInitScript(() => {
  window.__starts = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, ...rest) {
    window.__starts.push({ when: Math.round((when ?? 0) * 1000), rate: this.playbackRate.value, seconds: this.buffer?.duration });
    return start.call(this, when, ...rest);
  };
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (/error|warn/i.test(m.type())) console.log(`  [page ${m.type()}] ${m.text().slice(0, 160)}`); });
const config = await (await fetch(new URL("api/config", MIRROR))).json();
console.log("config:", JSON.stringify({ tts: config.tts, voiceFx: config.voiceFx }));
await page.goto(MIRROR);
await page.waitForTimeout(4000);
await page.keyboard.press("d");
const panel = () => page.textContent("#debug");
const stateNow = async () => (await panel()).match(/^state\s*(\S+)/m)?.[1];

async function visit(label) {
  await page.evaluate(() => (window.__starts = []));
  const before = ttsTexts.length;
  await page.keyboard.press("g");
  const states = [];
  const mouths = new Set();
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(100);
    const s = await stateNow();
    if (states.at(-1) !== s) states.push(s);
    mouths.add(await page.getAttribute(".lip-low", "d"));
    if (s === "LISTENING" && i > 15) break;
  }
  const starts = await page.evaluate(() => window.__starts);
  const sounds = starts.filter((s) => s.seconds > 0.5);
  console.log(`[${label}] states: ${states.join(" > ")}`);
  console.log(`[${label}] new Groq requests: ${ttsTexts.length - before} ${JSON.stringify(ttsTexts.slice(before))}`);
  console.log(`[${label}] sounds started: ${JSON.stringify(sounds)}; mouth shapes: ${mouths.size}`);
  return { states, requests: ttsTexts.length - before, sounds, mouths: mouths.size };
}
const first = await visit("visit 1");
const text = await panel();
console.log(text.split("\n").filter((l) => /^(state|tts|speech|voice|reply)|mirror:|child:/.test(l)).join("\n"));
await page.keyboard.press("r");
await page.waitForTimeout(500);
const second = await visit("visit 2");
await page.keyboard.press("r");
await page.waitForTimeout(300);
// V on a sleeping mirror auditions the next voice with the opening line.
const beforeV = ttsTexts.length;
await page.keyboard.press("v");
await page.waitForTimeout(1500);
const vReq = ttsTexts.slice(beforeV);

const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
ok(config.voiceFx.pitch === 0.8 && config.voiceFx.speed === 0.85 && config.voiceFx.bass === 0.2 && config.voiceFx.echo === 0.3 && config.vad.redemptionMs === 600 && config.vad.listenAfterMs === 600, "config: pitch 0.8, speed 0.85, soft rumble 0.2, echo 0.3, 0.6 s of silence ends a sentence, mic back 0.6 s after speaking");
ok(chatCalls === 0, `no AI call for the opening (chat calls: ${chatCalls})`);
ok(first.requests === 1 && ttsTexts[0].startsWith("[cheerful] Mirror, mirror, on the wall"), "the opening is the scripted line, in one Groq request");
ok(first.sounds.length === 2 && first.sounds.every((s) => Math.abs(s.rate - 0.8) < 1e-6 && s.when === first.sounds[0].when), "the voice and its octave rumble, together, at rate 0.8");
ok(first.states.includes("SPEAKING") && first.states.at(-1) === "LISTENING" && !first.states.includes("THINKING"), "wakes, speaks, then listens, never 'thinking'");
ok(first.mouths > 5, "the mouth moves");
ok(second.requests === 0 && second.sounds.length === 2, "second visit: the opening comes from the cache");
ok(vReq.length === 1 && vReq[0].startsWith("[cheerful] Mirror, mirror"), "V auditions the next voice with the opening");
ok(text.includes("mirror: Mirror, mirror, on the wall"), "the transcript shows the opening");
console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
