// Party-day page details, with Groq faked: no mouse pointer, the screen kept on, and the scripted
// lines the page asks Groq for are exactly the ones the server records at start-up.
import { fixture, launch, MIRROR } from "./helper.mjs";
const { scriptedTakes } = await import("../../src/lines.ts");
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
const errors = [], tts = [];
await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
  export const utils = { encodeWAV: () => new ArrayBuffer(44) };
  export const MicVAD = { async new(o) { return { start() {}, pause() {} }; } };
  export default { utils, MicVAD };` }));
await context.route("**/api/tts", (route) => { tts.push(JSON.parse(route.request().postData()).text); route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: fixture("groq-like.wav") }); });
await context.addInitScript(() => {
  window.__wakeLocks = 0;
  Object.defineProperty(navigator, "wakeLock", { value: { request: async (type) => { window.__wakeLocks++; return { type, release: async () => {} }; } } });
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(MIRROR);
await page.waitForTimeout(4000);
await page.keyboard.press("d");
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
const panel = async () => (await page.textContent("#debug")) ?? "";
const stateNow = async () => (await panel()).match(/^state\s*(\S+)/m)?.[1];
const until = async (test, ms = 10000) => { for (let t = 0; t < ms; t += 50) { if (await test()) return true; await page.waitForTimeout(50); } return false; };

ok((await page.evaluate(() => getComputedStyle(document.body).cursor)) === "none", "no mouse pointer on the mirror");
ok((await page.evaluate(() => window.__wakeLocks)) >= 1 && (await panel()).includes("screen   kept on"), "the screen is kept on");

await page.keyboard.press("g");
await until(async () => (await stateNow()) === "LISTENING");
await page.keyboard.press("c");
await until(() => tts.length >= 2);
await until(async () => (await stateNow()) === "LISTENING");
await page.keyboard.press("h");
await until(() => tts.length >= 3);
const takes = new Set(scriptedTakes(true));
console.log(tts);
ok(tts.length === 3 && tts.every((t) => takes.has(t)), "the opening, C and H lines are exactly the takes the server records at start-up");
console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
