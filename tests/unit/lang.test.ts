// Hearing only English and Tagalog: a clip Whisper takes for another language is heard again as
// English and as Tagalog, and the surer one is kept.
process.env.GROQ_API_KEY = "x";
const { transcribe } = await import("../../server/providers/stt.ts");
type Reply = { language?: string; text: string; logprob: number } | "fail";
let replies: Record<string, Reply> = {};
const asked: (string | null)[] = [];
globalThis.fetch = (async (url: string, init: RequestInit) => {
  if (String(url).startsWith("data:")) return new Response("");
  const language = (init.body as FormData).get("language") as string | null;
  asked.push(language);
  const r = replies[language ?? "auto"];
  if (!r || r === "fail") return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 500, headers: { "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ text: r.text, language: r.language, duration: 2, segments: [{ text: r.text, avg_logprob: r.logprob, end: 1.8, compression_ratio: 1.2 }] }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;
const ok = (c: boolean, w: string) => console.log(`${c ? "ok  " : "FAIL"} ${w}`);
const hear = async (r: typeof replies) => {
  replies = r;
  asked.length = 0;
  return transcribe(Buffer.alloc(100), ["whisper-large-v3"]);
};

let out = await hear({ auto: { language: "English", text: " I'm a witch!", logprob: -0.2 } });
ok(out.text === "I'm a witch!" && asked.length === 1, "English: kept, one request");
out = await hear({ auto: { language: "tagalog", text: " Ang ganda ng costume ko!", logprob: -0.3 } });
ok(out.text === "Ang ganda ng costume ko!" && asked.length === 1, "Tagalog: kept, one request");
out = await hear({ auto: { text: " Trick or treat!", logprob: -0.3 } });
ok(out.text === "Trick or treat!" && asked.length === 1, "no language reported: trusted, one request");
out = await hear({
  auto: { language: "malay", text: " Saya mahu gula-gula", logprob: -0.6 },
  en: { language: "english", text: " I want candy", logprob: -0.7 },
  tl: { language: "tagalog", text: " Gusto ko ng kendi", logprob: -0.25 },
});
console.log(out, asked);
ok(out.text === "Gusto ko ng kendi" && asked.slice(1).sort().join() === "en,tl", "Malay: heard again as English and Tagalog, the surer (Tagalog) kept");
out = await hear({
  auto: { language: "japanese", text: " ハロウィン", logprob: -0.9 },
  en: { language: "english", text: " Happy Halloween!", logprob: -0.2 },
  tl: { language: "tagalog", text: " Hapi halowin", logprob: -0.8 },
});
ok(out.text === "Happy Halloween!", "Japanese: the surer English hearing kept");
out = await hear({ auto: { language: "welsh", text: " Rwy'n wrach", logprob: -0.5 }, en: "fail", tl: "fail" });
ok(out.text === "", "both re-hearings fail: nothing, never the other language");
out = await hear({ auto: { language: "welsh", text: " Rwy'n wrach", logprob: -0.5 }, en: { language: "english", text: " I'm a witch", logprob: -0.4 }, tl: "fail" });
ok(out.text === "I'm a witch", "one re-hearing fails: the other is kept");
