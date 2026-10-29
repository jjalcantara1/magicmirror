// A Taglish exchange with Groq, speech-to-text and the AI faked: the child says the Tagalog magic
// words, the glass glows, and the Taglish reply reaches the voice with "ng" and "mga" spelled as said.
import { fixture, launch, MIRROR } from "./helper.mjs";
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
const errors = [];
const tts = [];
const chats = [];
await context.route("**/@ricky0123_vad-web.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `
  export const utils = { encodeWAV: () => new ArrayBuffer(44) };
  export const MicVAD = { async new(o) { let t; return {
    start() { clearTimeout(t); t = setTimeout(() => o.onSpeechEnd(new Float32Array(16000)), 1500); },
    pause() { clearTimeout(t); } }; } };
  export default { utils, MicVAD };` }));
await context.route("**/api/tts", (route) => { tts.push(JSON.parse(route.request().postData()).text); route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: fixture("groq-like.wav") }); });
await context.route("**/api/stt", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Salamin, salamin sa dingding, sino ang pinakamaganda sa lahat?", ms: 5, provider: "groq whisper-large-v3" }) }));
await context.route("**/api/chat", (route) => {
  chats.push(JSON.parse(route.request().postData()).turns);
  const deltas = ["[[effect:thunder]] [[mood:grand]] Masdan! Ikaw ang pinakamaganda sa lahat ng mga bata! ", "[[mood:wink]] Ibig sabihin, panalo ka! Ano'ng costume mo?"];
  route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: deltas.map((d) => `data: ${JSON.stringify({ delta: d })}\n\n`).join("") + 'data: {"done":true,"provider":"mock","firstTokenMs":5}\n\n' });
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(MIRROR);
await page.waitForTimeout(4000);
await page.keyboard.press("d");
await page.keyboard.press("g");
let glowed = false;
for (let i = 0; i < 200 && chats.length < 1; i++) {
  await page.waitForTimeout(50);
  glowed ||= await page.evaluate(() => !!document.querySelector(".fx-glow"));
}
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(50);
  glowed ||= await page.evaluate(() => !!document.querySelector(".fx-glow"));
}
await page.waitForTimeout(1500);
const panel = await page.textContent("#debug");
console.log(`Groq requests:\n  ${tts.join("\n  ")}`);
console.log(panel.split("\n").filter((l) => /^(stt|llm)|mirror:|child:/.test(l)).join("\n"));
const ok = (c, what) => console.log(`${c ? "ok  " : "FAIL"} ${what}`);
ok(glowed, "the Tagalog magic words make the glass glow at once");
ok(chats[0]?.at(-1)?.content === "Salamin, salamin sa dingding, sino ang pinakamaganda sa lahat?", "the AI gets the Tagalog words as heard");
ok(tts.some((t) => t.includes("lahat nang manga bata")) && !tts.some((t) => / ng | mga /.test(t)), "the voice gets 'nang manga', said as in Tagalog");
ok(tts.some((t) => t.includes("Ano'ng costume mo?")), "a contraction like ano'ng is left alone");
ok(panel.includes("mirror: Masdan! Ikaw ang pinakamaganda sa lahat ng mga bata!"), "the transcript keeps the real spelling");
ok(panel.includes("groq whisper-large-v3"), "the panel shows which Whisper model heard it");
console.log(errors.length ? "PAGE ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
