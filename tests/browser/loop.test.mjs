// Groq's voice looping on the opening: the mirror asks again without the tone, plays the good take,
// and caches only that. Groq faked; the second scenario loops twice.
import { fixture, launch, MIRROR, repeatedWav } from "./helper.mjs";
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
const errors = [], tts = [];
const LOOPED = repeatedWav(fixture("groq-like.wav"), 10); // 16 s for one short line
let loops = 1; // how many requests in a row come back looped
await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
  export const utils = { encodeWAV: () => new ArrayBuffer(44) };
  export const MicVAD = { async new(o) { return { start() {}, pause() {} }; } };
  export default { utils, MicVAD };` }));
await context.route("**/api/tts", (route) => {
  tts.push(JSON.parse(route.request().postData()).text);
  const looped = loops > 0;
  if (looped) loops--;
  route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: looped ? LOOPED : fixture("groq-like.wav") });
});
const page = await context.newPage();
const warnings = [];
page.on("console", (m) => /looped/.test(m.text()) && warnings.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(MIRROR);
await page.waitForTimeout(4000);
await page.keyboard.press("d");
const stateNow = async () => (await page.textContent("#debug"))?.match(/^state\s*(\S+)/m)?.[1];
async function waitFor(fn, ms = 15000) { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await page.waitForTimeout(50); } return false; }
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
const OPENING = "Mirror, mirror, on the wall, who is the fairest of them all? Step closer, and let the magic glass decide!";

// 1. The first take loops once.
await page.keyboard.press("g");
await waitFor(async () => (await stateNow()) === "LISTENING");
const speech1 = (await page.textContent("#debug")).match(/^speech\s+(.*)$/m)?.[1];
console.log("1:", JSON.stringify(tts), "|", speech1);
ok(tts.length === 2 && tts[0] === `[cheerful] ${OPENING}` && tts[1] === OPENING, "a looping take is asked for again, without the tone");
ok(/^groq /.test(speech1 ?? "") && /\b[12]\.\d s of audio/.test(speech1 ?? ""), "the good take plays (about 2 s, not the 16 s loop)");
ok(warnings.some((w) => w.includes("Groq looped")), "the loop is logged");
await page.keyboard.press("n");
await waitFor(async () => (await stateNow()) === "WAKING");
await waitFor(async () => (await stateNow()) === "LISTENING");
ok(tts.length === 2, "the next visit's opening comes from the cache: the good take was kept");

// 2. Groq loops twice: the backup voice is used (here it cannot load, so silence), nothing is cached.
await page.keyboard.press("x");
await page.waitForTimeout(4500);
await page.keyboard.press("d");
tts.length = 0;
loops = 2;
await page.keyboard.press("g");
await waitFor(async () => (await stateNow()) === "LISTENING");
const speech2 = (await page.textContent("#debug")).match(/^speech\s+(.*)$/m)?.[1];
console.log("2:", tts.length, "requests |", speech2);
ok(tts.length === 2 && /Groq looped twice/.test(speech2 ?? ""), "looped twice: the mirror gives up on Groq for this line");
ok(!/^groq /.test(speech2 ?? "") && !/\b1\d\.\d s of audio/.test(speech2 ?? ""), "the looped audio is never played (the backup voice speaks, or nothing)");
await page.keyboard.press("n");
await waitFor(async () => (await stateNow()) === "WAKING");
await waitFor(async () => (await stateNow()) === "LISTENING");
ok(tts.length === 3, "nothing looped was cached: the next opening asks Groq again");
console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
