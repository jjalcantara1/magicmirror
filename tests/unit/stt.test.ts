// The STT fallback: the first model fails, the second answers; the Taglish prompt goes along.
process.env.GROQ_API_KEY = "x";
const { transcribe } = await import("../../server/providers/stt.ts");
const asked: { model: string; prompt: string; language: string | null }[] = [];
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  if (String(_url).startsWith("data:")) return new Response("");
  const form = init.body as FormData;
  const model = String(form.get("model"));
  asked.push({ model, prompt: String(form.get("prompt")), language: form.get("language") as string | null });
  if (model === "whisper-large-v3") return new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404, headers: { "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ text: " Salamin, salamin sa dingding!", duration: 2, segments: [{ text: " Salamin, salamin sa dingding!", avg_logprob: -0.3, end: 1.8 }] }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;
const result = await transcribe(Buffer.alloc(100), ["whisper-large-v3", "whisper-large-v3-turbo"]);
const ok = (c: boolean, w: string) => console.log(`${c ? "ok  " : "FAIL"} ${w}`);
console.log(result, asked.map((a) => a.model));
ok(result.model === "whisper-large-v3-turbo" && result.text === "Salamin, salamin sa dingding!", "falls back to turbo and returns its text");
ok(asked.length === 2 && asked[0].model === "whisper-large-v3", "tried large-v3 first");
ok(asked.every((a) => a.prompt.includes("Salamin, salamin sa dingding") && a.prompt.includes("Mirror, mirror")), "the Taglish prompt is sent");
ok(asked.every((a) => a.language === null), "no language forced, so Whisper hears it");
globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
ok(await transcribe(Buffer.alloc(100), ["a", "b"]).then(() => false, () => true), "fails when every model fails");
