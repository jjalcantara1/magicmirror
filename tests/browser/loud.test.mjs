// A loud party, with children talking straight into the mic. The speech detector is replaced by a
// stand-in that feeds the mirror sound frame by frame (32 ms each) and, like the real one in a loud
// crowd, never decides that the talking has stopped. Groq, hearing and the AI are faked.
import { fixture, launch, MIRROR } from "./helper.mjs";
const browser = await launch();
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
const errors = [];
const ROOM = 0.01;
const CHILD = 0.1; // +20 dB over the room: talking into the mic
const CROWD = 0.02; // +6 dB: chatter
const frames = (level, ms) => Array(Math.round(ms / 32)).fill(level);

async function open(closeTalk) {
  const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
  const log = { stt: 0 };
  await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
    export const utils = { encodeWAV: (audio) => { window.__lastAudio = audio.length; return new ArrayBuffer(44); } };
    export const MicVAD = { async new(o) {
      await o.getStream();
      const mic = (window.__mic = { o, running: false, starts: 0, pauses: 0 });
      return { async start() { mic.running = true; mic.starts++; }, async pause() { mic.running = false; mic.pauses++; } };
    } };
    // Feeds levels as 32 ms frames while the mic runs; speech=true starts a stretch of "speech" first.
    window.__feed = (levels, speech) => {
      const mic = window.__mic;
      if (!mic?.running) return false;
      if (speech) mic.o.onSpeechStart();
      for (const level of levels) mic.o.onFrameProcessed({ isSpeech: speech ? 0.9 : 0.05, notSpeech: 0.1 }, new Float32Array(512).fill(level));
      return true;
    };
    export default { utils, MicVAD };` }));
  await context.addInitScript(() => {
    window.__constraints = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => (window.__constraints.push(c), gum(c));
  });
  await context.route("**/api/config", async (route) => {
    const res = await route.fetch();
    const config = await res.json();
    config.vad.closeTalk = closeTalk;
    route.fulfill({ response: res, json: config });
  });
  await context.route("**/api/tts", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: fixture("groq-like.wav") }));
  await context.route("**/api/stt", (route) => { log.stt++; route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "I'm a witch!", ms: 5, provider: "fake" }) }); });
  await context.route("**/api/chat", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: `data: ${JSON.stringify({ delta: "[[mood:happy]] A witch! Is your broom fast?" })}\n\ndata: {"done":true,"provider":"mock","firstTokenMs":5}\n\n` }));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(MIRROR);
  await page.waitForTimeout(4000);
  await page.keyboard.press("d");
  const panel = async () => (await page.textContent("#debug")) ?? "";
  const stateNow = async () => (await panel()).match(/^state\s*(\S+)/m)?.[1];
  const heard = async () => (await panel()).match(/^heard\s*(.*)$/m)?.[1] ?? "";
  const until = async (test, ms = 10000) => { for (let t = 0; t < ms; t += 50) { if (await test()) return true; await page.waitForTimeout(50); } return false; };
  const feed = async (levels, speech) => {
    await until(() => page.evaluate(() => window.__mic?.running), 5000);
    return page.evaluate(([l, s]) => window.__feed(l, s), [levels, speech]);
  };
  await page.keyboard.press("g");
  await until(async () => (await stateNow()) === "LISTENING");
  await feed(frames(ROOM, 4000), false); // the room, measured while listening
  return { context, page, log, panel, stateNow, heard, until, feed };
}

// Close talk (the default).
{
  const m = await open(true);
  const audio = (await m.page.evaluate(() => window.__constraints))[0]?.audio ?? {};
  ok(audio.autoGainControl === false && audio.echoCancellation === true && audio.noiseSuppression === true, "the mic: no automatic volume; echo cancellation and noise suppression on");

  await m.feed([...frames(CHILD, 1500), ...frames(CROWD, 3000)], true);
  ok(await m.until(() => m.log.stt === 1, 5000), "the child stops while the crowd goes on: the sentence ends anyway, and is heard");
  const seconds = (await m.page.evaluate(() => window.__lastAudio)) / 16000;
  ok(seconds > 1.8 && seconds < 2.6, `it ends 0.6 s after the child's voice, not with the crowd (${seconds.toFixed(2)} s of audio sent)`);
  ok(/^20 dB above the room \(needs 12\)$/.test(await m.heard()), `the D panel shows the child well above the room: ${await m.heard()}`);
  await m.until(async () => (await m.stateNow()) === "THINKING");
  await m.until(async () => (await m.stateNow()) === "LISTENING", 15000);

  const before = m.log.stt;
  await m.feed(frames(CROWD, 3000), true);
  await m.page.waitForTimeout(800);
  ok(m.log.stt === before, "only crowd chatter: never sent to be heard");
  ok(/^IGNORED, too far away or too quiet: 6 dB above the room/.test(await m.heard()), `and shown as ignored: ${await m.heard()}`);
  ok(await m.page.evaluate(() => window.__mic.running), "the mic keeps listening after dropping it");

  await m.feed([...frames(CHILD, 900), ...frames(CROWD, 1000)], true);
  ok(await m.until(() => m.log.stt === before + 1, 5000), "the next child right after the chatter is heard");
  await m.context.close();
}

// MIC_CLOSE=off: a room mic, as before.
{
  const m = await open(false);
  const audio = (await m.page.evaluate(() => window.__constraints))[0]?.audio ?? {};
  ok(audio.autoGainControl === true, "MIC_CLOSE=off: automatic mic volume on");
  await m.feed([...frames(CHILD, 1500), ...frames(CROWD, 3000)], true);
  await m.page.waitForTimeout(800);
  ok(m.log.stt === 0, "MIC_CLOSE=off: the speech detector alone decides when the sentence ends");
  await m.context.close();
}

console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
