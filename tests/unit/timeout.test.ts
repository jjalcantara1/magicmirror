// Groq hanging must not leave a child waiting: each call gives up on time and moves on.
process.env.GROQ_API_KEY = "x";
process.env.LLM_MODEL = "m1,m2,m3";
delete process.env.OLLAMA_CHAT_MODEL;
let hangs = new Set<string>();
const hang = (signal?: AbortSignal | null) =>
  new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted"))));
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.startsWith("data:")) return new Response("");
  const signal = init?.signal ?? (url instanceof Request ? url.signal : undefined);
  let what = "tts";
  if (u.includes("/chat/")) what = `chat:${JSON.parse(String(init?.body)).model}`;
  else if (u.includes("/transcriptions")) what = `stt:${(init?.body as FormData).get("model")}`;
  if (hangs.has(what) || hangs.has("all")) return hang(signal);
  if (what.startsWith("chat"))
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: `hi from ${what}` } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  if (what.startsWith("stt")) return new Response(JSON.stringify({ text: `heard by ${what}`, duration: 1, segments: [{ text: `heard by ${what}`, avg_logprob: -0.2, end: 0.9 }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  return new Response(new Uint8Array(100), { status: 200 });
}) as typeof fetch;
const { transcribe } = await import("../../server/providers/stt.ts");
const { chatWithFallback } = await import("../../server/providers/llm.ts");
const { speakGroq } = await import("../../server/providers/tts.ts");
const ok = (c: boolean, w: string) => console.log(`${c ? "ok  " : "FAIL"} ${w}`);
const timed = async <T,>(f: () => Promise<T>) => {
  const t = Date.now();
  try {
    return { value: await f(), ms: Date.now() - t };
  } catch (e) {
    return { error: (e as Error).message, ms: Date.now() - t };
  }
};

hangs = new Set(["stt:whisper-large-v3"]);
let r = await timed(() => transcribe(Buffer.alloc(100), ["whisper-large-v3", "whisper-large-v3-turbo"]));
console.log(r);
ok("value" in r && r.value?.text === "heard by stt:whisper-large-v3-turbo" && r.ms >= 5900 && r.ms < 6600, `hearing: a hung model gives way to the next after 6 s (${r.ms} ms)`);
hangs = new Set(["all"]);
r = await timed(() => transcribe(Buffer.alloc(100), ["whisper-large-v3", "whisper-large-v3-turbo"]));
console.log(r);
ok("error" in r && r.ms >= 7400 && r.ms < 8600, `hearing: when everything hangs it gives up within 8 s (${r.ms} ms)`);

const chat = () => chatWithFallback([{ role: "user", content: "hi" }], () => {}, new AbortController().signal);
hangs = new Set(["chat:m1"]);
let c = await timed(chat);
console.log(c);
ok("value" in c && c.value?.text === "hi from chat:m1".replace("m1", "m2") && c.ms >= 5900 && c.ms < 6600, `AI: a hung model gives way to the next after 6 s (${c.ms} ms)`);
hangs = new Set(["chat:m2", "chat:m3"]); // m1 rests 30 s after hanging, so m2 and m3 are tried
c = await timed(chat);
console.log(c);
ok("error" in c && c.ms >= 11_900 && c.ms < 14_600, `AI: when every model hangs it gives up within 14 s, so the mirror can say "Oops" (${c.ms} ms)`);

hangs = new Set(["all"]);
const keepAlive = setInterval(() => {}, 1000); // Node's timeout signals do not keep a script running
const t = await timed(() => speakGroq("[cheerful] Hello!", "troy", "canopylabs/orpheus-v1-english"));
console.log(t);
ok("error" in t && t.ms >= 5900 && t.ms < 6600, `voice: a hung request gives up after 6 s, so the backup voice speaks (${t.ms} ms)`);
clearInterval(keepAlive);
