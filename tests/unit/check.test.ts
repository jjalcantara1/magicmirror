// The start-up check, with Groq faked.
import { readdirSync, rmSync } from "node:fs";
import { fixture, VOICE_CACHE } from "./setup.ts";
process.env.GROQ_API_KEY = "x";
process.env.LLM_MODEL = "m1";
rmSync(VOICE_CACHE, { recursive: true, force: true });
const WAV = fixture("groq-like.wav");
let ttsCalls = 0;
let sttFails = false;
let heardText = "Mirror, mirror, on the wall, who is the fairest of them all?";
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.startsWith("data:")) return new Response("");
  if (u.includes("/chat/"))
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello, I am ready!" } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  if (u.includes("/transcriptions")) {
    if (sttFails) return new Response(JSON.stringify({ error: { message: "service unavailable" } }), { status: 503, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ text: heardText, language: "english", duration: 3, segments: [{ text: heardText, avg_logprob: -0.2, end: 2.9 }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  ttsCalls++;
  return new Response(WAV, { status: 200, headers: { "Content-Type": "audio/wav" } });
}) as typeof fetch;
const { startupCheck } = await import("../../server/startupCheck.ts");
const { scriptedTakes } = await import("../../src/lines.ts");
const ok = (c: boolean, w: string) => console.log(`${c ? "ok  " : "FAIL"} ${w}`);
const opts = { voiceEngine: "groq" as const, voice: "troy", voiceModel: "canopylabs/orpheus-v1-english", acting: true, sttModels: ["whisper-large-v3"] };

const takes = scriptedTakes(true);
console.log(takes.length, "takes, e.g.", takes[0], "|", takes.at(-1));
ok(takes[0] === "[cheerful] Mirror, mirror, on the wall, who is the fairest of them all? Step closer, and let the magic glass decide!", "the opening take is exactly what the page sends");
ok(takes.every((t) => t.length <= 200 && /^\[(cheerful|playful)\] /.test(t)), "every take has its tone and fits Groq's 200 characters");
ok(scriptedTakes(false).every((t) => !t.startsWith("[")), "acting off: no tones");

let lines = await startupCheck(opts);
console.log(lines.join("\n"));
ok(lines[0].startsWith(`[check] voice ok: ${takes.length} scripted lines ready (${takes.length} new`) && ttsCalls === takes.length, "first start: every scripted line recorded once");
ok(readdirSync(VOICE_CACHE).length === takes.length, "and kept on disk");
ok(lines[1].startsWith('[check] hearing ok: "Mirror, mirror') && lines[2].startsWith("[check] AI ok: groq:m1") && lines.at(-1) === "[check] all good: the mirror is ready for the party", "hearing and AI ok, all good");

ttsCalls = 0;
lines = await startupCheck(opts);
ok(lines[0] === `[check] voice ok: ${takes.length} scripted lines ready` && ttsCalls === 0, "next start: the lines come from disk, no voice requests");

sttFails = true;
lines = await startupCheck(opts);
console.log(lines.join("\n"));
ok(lines[1].startsWith("[check] hearing FAILED") && lines.at(-1)!.startsWith("[check] something failed"), "hearing failing is reported");
sttFails = false;
heardText = "Thank you for watching.";
lines = await startupCheck(opts);
ok(lines[1].startsWith("[check] hearing ODD"), "hearing the opening wrong is reported");
rmSync(VOICE_CACHE, { recursive: true, force: true });
