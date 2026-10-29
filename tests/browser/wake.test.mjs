// Waking by voice and sleeping by itself, with Groq, speech-to-text and the AI faked.
// Run against a server started with IDLE_SLEEP_S=4.
import { fixture, launch, MIRROR } from "./helper.mjs";
const browser = await launch();
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
const errors = [];

async function open(wakeWords = true) {
  const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
  const log = { tts: [], chats: [], stt: 0, heard: [] };
  // The fake mic: the test makes the child "say" something with window.__say(seconds).
  await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
    export const utils = { encodeWAV: () => new ArrayBuffer(44) };
    export const MicVAD = { async new(o) { window.__vad = { o, running: false }; return {
      start() { window.__vad.running = true; }, pause() { window.__vad.running = false; } }; } };
    window.__say = (seconds = 1) => { if (!window.__vad?.running) return false; window.__vad.o.onSpeechEnd(new Float32Array(16000 * seconds)); return true; };
    export default { utils, MicVAD };` }));
  await context.route("**/api/config", async (route) => {
    const res = await route.fetch();
    const config = await res.json();
    config.wake.words = wakeWords;
    route.fulfill({ response: res, json: config });
  });
  await context.route("**/api/tts", (route) => { log.tts.push(JSON.parse(route.request().postData()).text); route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: fixture("groq-like.wav") }); });
  await context.route("**/api/stt", (route) => {
    log.stt++;
    const text = log.heard.shift() ?? "";
    if (text === "FAIL") return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "no answer within 8 s" }) });
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text, ms: 5, provider: "fake" }) });
  });
  await context.route("**/api/chat", (route) => {
    log.chats.push(JSON.parse(route.request().postData()).turns);
    const deltas = ["[[mood:happy]] Ooh, how spooky! ", "What a costume!"];
    route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: deltas.map((d) => `data: ${JSON.stringify({ delta: d })}\n\n`).join("") + 'data: {"done":true,"provider":"mock","firstTokenMs":5}\n\n' });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(MIRROR);
  await page.waitForTimeout(4000);
  await page.keyboard.press("d");
  const panel = async () => (await page.textContent("#debug")) ?? "";
  const stateNow = async () => (await panel()).match(/^state\s*(\S+)/m)?.[1];
  const hintShown = () => page.evaluate(() => !document.querySelector("#hint").hidden);
  async function until(test, ms = 10000) {
    for (let t = 0; t < ms; t += 50) {
      if (await test()) return true;
      await page.waitForTimeout(50);
    }
    return false;
  }
  const say = async (text, seconds = 1) => {
    log.heard.push(text);
    await until(() => page.evaluate(() => window.__vad?.running), 5000);
    return page.evaluate((s) => window.__say(s), seconds);
  };
  return { context, page, log, panel, stateNow, hintShown, until, say };
}

// Wake words on.
{
  const m = await open(true);
  ok((await m.stateNow()) === "SLEEPING" && (await m.hintShown()), "asleep at start, with the hint glowing");
  ok(await m.until(() => m.page.evaluate(() => window.__vad?.running), 3000), "asleep, the mic listens for the wake words");

  await m.say("What's this shiny thing?");
  await m.page.waitForTimeout(800);
  ok(m.log.stt === 1 && (await m.stateNow()) === "SLEEPING" && m.log.tts.length === 0 && m.log.chats.length === 0, "other talk while asleep: heard, but no reply and still asleep");
  ok((await m.panel()).includes('asleep: heard "What\'s this shiny thing?"'), "the D panel shows what it heard while asleep");

  m.log.heard.length = 0;
  await m.say("Blah blah blah", 6);
  await m.page.waitForTimeout(500);
  ok(m.log.stt === 1, "long talk while asleep is not sent to be heard");

  m.log.heard.length = 0;
  await m.say("Hello, Mira!");
  ok(await m.until(async () => (await m.stateNow()) === "LISTENING"), "\"Hello, Mira!\" wakes it");
  ok(m.log.tts[0]?.includes("Mirror, mirror, on the wall") && !(await m.hintShown()), "it says the opening, and the hint goes away");

  await m.say("I'm a witch!");
  await m.until(() => m.log.chats.length === 1);
  await m.until(async () => (await m.stateNow()) === "LISTENING");
  const t0 = Date.now();
  ok(await m.until(async () => (await m.stateNow()) === "SLEEPING", 12000), `after 4 s of quiet it goes to sleep (${Date.now() - t0} ms)`);
  const goodbye = m.log.tts.find((t) => t.includes("Say hello mirror"));
  ok(!!goodbye, `it says goodbye and how to wake it: ${goodbye}`);
  ok((await m.hintShown()) && !(await m.panel()).includes("I'm a witch"), "asleep again: the hint glows and the chat is wiped");

  await m.say("hello mirror");
  await m.until(async () => (await m.stateNow()) === "LISTENING");
  await m.say("I'm a ghost!");
  await m.until(() => m.log.chats.length === 2);
  const turns = m.log.chats[1] ?? [];
  ok(turns.some((t) => t.content === "I'm a ghost!") && !turns.some((t) => t.content.includes("witch")), "the next child starts fresh: no memory of the witch");

  // G still works from sleep, and R puts it to sleep listening again.
  await m.page.keyboard.press("r");
  ok(await m.until(async () => (await m.stateNow()) === "SLEEPING" && (await m.page.evaluate(() => window.__vad?.running))), "R: asleep, listening for the wake words again");
  await m.page.keyboard.press("g");
  ok(await m.until(async () => (await m.stateNow()) === "LISTENING"), "G still wakes it");
  await m.context.close();
}

// Hearing fails: the mirror asks again instead of staying silent; plain noise still gets nothing.
{
  const m = await open(true);
  await m.say("hello mirror");
  await m.until(async () => (await m.stateNow()) === "LISTENING");
  const before = m.log.tts.length;
  await m.say("FAIL");
  ok(await m.until(() => m.log.tts.some((t) => t.includes("Oops, my glass is foggy! Say that again?"))), "hearing failed: \"Oops, my glass is foggy! Say that again?\"");
  ok(await m.until(async () => (await m.stateNow()) === "LISTENING"), "then it listens again");
  const after = m.log.tts.length;
  await m.say("");
  await m.page.waitForTimeout(1500);
  ok(m.log.tts.length === after && after === before + 1 && (await m.stateNow()) === "LISTENING", "noise (nothing heard): no reply, still listening");
  await m.context.close();
}

// Wake words off.
{
  const m = await open(false);
  await m.page.waitForTimeout(1500);
  const fired = await m.page.evaluate(() => window.__say?.(1));
  ok(!fired && m.log.stt === 0 && (await m.stateNow()) === "SLEEPING" && !(await m.hintShown()), "WAKE_WORDS=off: the mic stays off while asleep, and no hint");
  await m.context.close();
}

console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
