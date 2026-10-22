import express from "express";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chatStatus, chatWithFallback, warmOllama, type Turn } from "./providers/llm.ts";
import { sttStatus, transcribeGroq } from "./providers/stt.ts";

const PORT = Number(process.env.PORT ?? 5173);
const STT_MODEL = process.env.STT_MODEL || "whisper-large-v3-turbo";
const prod = process.argv.includes("--prod");

const app = express();

// Cross-origin isolation lets onnxruntime-web use WASM threads (SharedArrayBuffer).
app.use((_req, res, next) => {
  res.set({ "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" });
  next();
});

// vad-web loads its audio worklet, the Silero model and its own onnxruntime-web WASM by URL at
// runtime. Serve them from node_modules here, before Vite: Vite refuses to serve a public file
// to a dynamic import. Local files also let the mirror listen with no internet.
const vadEntry = createRequire(import.meta.url).resolve("@ricky0123/vad-web");
const vadOrtDist = dirname(createRequire(vadEntry).resolve("onnxruntime-web/wasm"));
app.use("/vad", express.static(dirname(vadEntry)), express.static(vadOrtDist));
// Piper imports the top-level onnxruntime-web; its WASM files must be the same version.
const piperEntry = fileURLToPath(import.meta.resolve("@mintplex-labs/piper-tts-web"));
app.use("/ort", express.static(dirname(createRequire(piperEntry).resolve("onnxruntime-web/wasm"))));

app.get("/api/config", (_req, res) => {
  res.json({
    ttsVoice: process.env.TTS_VOICE || "en_GB-alan-medium",
    voiceFx: { pitch: Number(process.env.VOICE_PITCH || 0.86), echo: Number(process.env.VOICE_ECHO || 0.4) },
    listenMode: process.env.LISTEN_MODE || "half-duplex",
    vad: {
      positive: Number(process.env.VAD_POSITIVE_THRESHOLD || 0.5),
      negative: Number(process.env.VAD_NEGATIVE_THRESHOLD || 0.35),
      redemptionMs: Number(process.env.VAD_REDEMPTION_MS || 700),
    },
  });
});

app.get("/api/status", (_req, res) => {
  res.json({ llm: chatStatus(), stt: sttStatus() });
});

// Audio is transcribed in memory and never written to disk.
app.post("/api/stt", express.raw({ type: "audio/wav", limit: "5mb" }), async (req, res) => {
  const start = performance.now();
  try {
    const text = await transcribeGroq(req.body as Buffer, STT_MODEL);
    res.json({ text, ms: Math.round(performance.now() - start), provider: "groq" });
  } catch (e) {
    console.warn(`[stt] groq failed: ${(e as Error).message}`);
    res.status(502).json({ error: (e as Error).message });
  }
});

function parseTurns(body: unknown): Turn[] | undefined {
  const turns = (body as { turns?: unknown } | undefined)?.turns;
  if (!Array.isArray(turns) || turns.length > 40) return undefined;
  const valid = turns.every(
    (t: { role?: unknown; content?: unknown }) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.length <= 2000,
  );
  return valid ? (turns as Turn[]) : undefined;
}

// Streams the reply as server-sent events: {delta}, then {done} or {error}.
app.post("/api/chat", express.json({ limit: "200kb" }), async (req, res) => {
  const turns = parseTurns(req.body);
  if (!turns) {
    res.status(400).json({ error: "Expected {turns: [{role: 'user'|'assistant', content}]}" });
    return;
  }
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  res.flushHeaders();
  const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const closed = new AbortController();
  res.on("close", () => closed.abort());
  try {
    const result = await chatWithFallback(turns, (delta) => send({ delta }), closed.signal);
    send({ done: true, provider: result.target, firstTokenMs: Math.round(result.firstTokenMs) });
  } catch (e) {
    if (!closed.signal.aborted) send({ error: (e as Error).message });
  }
  res.end();
});

type BenchRow = Record<string, string | number>;
app.post("/api/bench-result", express.json({ limit: "1mb" }), (req, res) => {
  const { env, tts, stt, recommendation } = req.body as { env: BenchRow; tts: BenchRow[]; stt: BenchRow[]; recommendation: string[] };
  console.log("\n# Browser bench result");
  console.table(env);
  console.table(tts);
  console.table(stt);
  for (const line of recommendation) console.log(`- ${line}`);
  res.sendStatus(204);
});

if (prod) {
  app.use(express.static("dist"));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "mpa" });
  app.use(vite.middlewares);
}

// Localhost only: the server holds the API key, so nobody else on the party Wi-Fi may use it.
app.listen(PORT, "127.0.0.1", () => console.log(`Magic Mirror ${prod ? "(prod)" : "(dev)"} at http://127.0.0.1:${PORT}`));

// Keep the offline fallback model loaded. Re-warm in case a request reset Ollama's keep-alive.
const warm = () =>
  warmOllama().catch((e: Error) => console.warn(`[llm] could not warm Ollama: ${e.message}`));
void warm();
setInterval(() => void warm(), 4 * 60_000);
