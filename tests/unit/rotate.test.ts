// Key rotation with Groq faked: key A is rate limited, B and C work.
process.env.GROQ_API_KEY = "kA,kB,kC";
process.env.LLM_MODEL = "m1,m2";
delete process.env.OLLAMA_CHAT_MODEL;
const used: string[] = [];
let limitA = true;
let termsC = false;
const sse = (text: string) => new Response(
  [`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`, `data: ${JSON.stringify({ choices: [], usage: { completion_tokens: 5, total_tokens: 1200 } })}\n\n`, "data: [DONE]\n\n"].join(""),
  { status: 200, headers: { "Content-Type": "text/event-stream" } });
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.startsWith("data:")) return new Response(""); // the OpenAI library's own check, not Groq
  const headers = new Headers(init?.headers ?? (url instanceof Request ? url.headers : undefined));
  const key = (headers.get("authorization") ?? "").replace("Bearer ", "");
  const what = u.includes("/chat/") ? "chat" : u.includes("/transcriptions") ? "stt" : "tts";
  used.push(`${what}:${key}`);
  if (key === "kA" && limitA) return new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "Content-Type": "application/json", "retry-after": "20" } });
  if (what === "tts" && key === "kC" && termsC) return new Response(JSON.stringify({ error: { message: "The model requires terms acceptance" } }), { status: 400 });
  if (what === "chat") return sse(`hello from ${key}`);
  if (what === "stt") return new Response(JSON.stringify({ text: `heard by ${key}`, duration: 1, segments: [{ text: `heard by ${key}`, avg_logprob: -0.2, end: 0.9, compression_ratio: 1.2 }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  return new Response(new Uint8Array(100), { status: 200 });
}) as typeof fetch;

const { chatWithFallback, chatStatus } = await import("../../server/providers/llm.ts");
const { transcribe } = await import("../../server/providers/stt.ts");
const { speakGroq, ttsStatus } = await import("../../server/providers/tts.ts");
let bad = 0;
const ok = (c: boolean, w: string) => { console.log(`${c ? "ok  " : "FAIL"} ${w}`); bad += c ? 0 : 1; };
const chat = async () => { let out = ""; const r = await chatWithFallback([{ role: "user", content: "hi" }], (d) => (out += d), new AbortController().signal); return `${out} via ${r.target}`; };

const c1 = await chat(), c2 = await chat(), c3 = await chat(), c4 = await chat();
console.log([c1, c2, c3, c4].join(" | "));
ok(c1.includes("from kB") && c1.includes("(key 2)"), "chat: key 1 rate limited, key 2 answers at once");
ok(c2.includes("from kB") && c3.includes("from kC") && c4.includes("from kB"), "chat: later replies share keys 2 and 3, skipping the resting key 1");
ok(used.filter((u) => u === "chat:kA").length === 1, "chat: the resting key is not asked again");
const status = chatStatus();
ok(status.length === 6 && status.find((s) => s.target === "groq:m1 (key 1)")!.coolingDownSec >= 19, "status: every model and key listed, key 1 resting ~20 s");

used.length = 0;
const s1 = await transcribe(Buffer.alloc(100), ["whisper-large-v3"]), s2 = await transcribe(Buffer.alloc(100), ["whisper-large-v3"]);
console.log(s1.text, "|", s2.text, "|", used.join(","));
ok(s1.text === "heard by kB" && used[0] === "stt:kA", "speech-to-text: key 1 rate limited, key 2 answers");
ok(s2.text === "heard by kB" || s2.text === "heard by kC", "speech-to-text: then the working keys take turns");

used.length = 0;
termsC = true;
await speakGroq("hi", "troy", "orpheus"); // A limited -> B
await speakGroq("hi", "troy", "orpheus"); // starts at B
await speakGroq("hi", "troy", "orpheus"); // starts at C: terms -> rests, A resting -> B
console.log(used.join(","));
ok(used.join(",") === "tts:kA,tts:kB,tts:kB,tts:kC,tts:kB", "voice: rate-limited and terms-refused keys rest, the call still succeeds");
await speakGroq("hi", "troy", "orpheus");
ok(used.at(-1) === "tts:kB" && !used.slice(5).includes("tts:kC"), "voice: the terms-refused key is not asked again soon");
limitA = true;
termsC = true;
// Every key resting: fail at once, without asking Groq.
const before = used.length;
const { rest } = await import("../../server/providers/groqKeys.ts");
rest("tts", 1, 30);
const err = await speakGroq("hi", "troy", "orpheus").then(() => "", (e: Error) => e.message);
ok(/rate limited for \d+ s more/.test(err) && used.length === before, `voice: all keys resting fails at once (${err})`);
console.log("tts status:", JSON.stringify(ttsStatus()));
process.exit(bad ? 1 : 0);
