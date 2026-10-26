import express from "express";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatStatus, chatWithFallback, warmOllama, type Turn } from "./providers/llm.ts";
import { sttStatus, transcribeGroq } from "./providers/stt.ts";
import { findDeepestVoice, GROQ_MALE_VOICES, GROQ_TTS_MAX_CHARS, speakGroq, ttsStatus } from "./providers/tts.ts";

const PORT = Number(process.env.PORT ?? 5173);
// The project folder. Paths start here, not at the working folder, so the server finds the page
// however it is started (npm script, VS Code debugger, or another folder).
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STT_MODEL = process.env.STT_MODEL || "whisper-large-v3-turbo";
// The Groq voice needs the Groq key; without it, or with TTS_ENGINE=piper, the local Piper voice speaks.
const TTS_ENGINE = process.env.TTS_ENGINE === "piper" || !process.env.GROQ_API_KEY ? "piper" : "groq";
const TTS_MODEL = process.env.TTS_MODEL || "canopylabs/orpheus-v1-english";
const PIPER_VOICE = process.env.TTS_VOICE || "en_GB-alan-medium";
const GROQ_VOICE_SETTING = process.env.GROQ_TTS_VOICE || "deepest";
let groqVoice = GROQ_VOICE_SETTING === "deepest" ? "troy" : GROQ_VOICE_SETTING;
// "deepest": ask Groq for one line in each male voice (3 requests) and use the lowest. If Groq
// refuses (before its terms are accepted, say), the next page load tries again.
let voiceChosen: Promise<void> | undefined;
function chooseVoice(): Promise<void> {
  if (TTS_ENGINE !== "groq" || GROQ_VOICE_SETTING !== "deepest") return Promise.resolve();
  voiceChosen ??= findDeepestVoice(GROQ_MALE_VOICES, TTS_MODEL).then(
    ({ voice, pitches }) => {
      groqVoice = voice;
      console.log(`[tts] deepest Groq voice: ${voice} (median pitch: ${Object.entries(pitches).map(([v, hz]) => `${v} ${hz} Hz`).join(", ")})`);
    },
    (e: Error) => {
      console.warn(`[tts] could not compare the Groq voices (${e.message}); using ${groqVoice} until the next page load`);
      voiceChosen = undefined;
    },
  );
  return voiceChosen;
}
void chooseVoice();
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

app.get("/api/config", async (_req, res) => {
  // Wait a little for the voice comparison, so the page gets the deepest voice.
  await Promise.race([chooseVoice(), new Promise((resolve) => setTimeout(resolve, 6000))]);
  res.json({
    tts: { engine: TTS_ENGINE, voice: TTS_ENGINE === "groq" ? groqVoice : PIPER_VOICE, piperVoice: PIPER_VOICE },
    voiceFx: {
      pitch: Number(process.env.VOICE_PITCH || 0.7),
      speed: Number(process.env.VOICE_SPEED || 1.2),
      echo: Number(process.env.VOICE_ECHO || 0.4),
      bass: Number(process.env.VOICE_BASS || 0.5),
    },
    listenMode: process.env.LISTEN_MODE || "half-duplex",
    vad: {
      positive: Number(process.env.VAD_POSITIVE_THRESHOLD || 0.5),
      negative: Number(process.env.VAD_NEGATIVE_THRESHOLD || 0.35),
      redemptionMs: Number(process.env.VAD_REDEMPTION_MS || 700),
    },
  });
});

app.get("/api/status", (_req, res) => {
  res.json({ llm: chatStatus(), stt: sttStatus(), tts: ttsStatus() });
});

// The browser's voice worker asks for each piece of speech here, so the Groq key stays on the laptop.
app.post("/api/tts", express.json({ limit: "10kb" }), async (req, res) => {
  const { text, voice } = (req.body ?? {}) as { text?: unknown; voice?: unknown };
  if (typeof text !== "string" || !text.trim() || text.length > GROQ_TTS_MAX_CHARS || typeof voice !== "string") {
    res.status(400).json({ error: `Expected {text: 1-${GROQ_TTS_MAX_CHARS} characters, voice}` });
    return;
  }
  try {
    res.type("audio/wav").send(await speakGroq(text, voice, TTS_MODEL));
  } catch (e) {
    console.warn(`[tts] groq failed: ${(e as Error).message}`);
    res.status(502).json({ error: (e as Error).message });
  }
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
  app.use(express.static(join(ROOT, "dist")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "mpa" });
  app.use(vite.middlewares);
}

// Localhost only: the server holds the API key, so nobody else on the party Wi-Fi may use it.
// Express 5 also calls this callback when the start fails. Without the check, the mirror said it was
// ready while an older mirror still had the port, and the browser showed the older mirror.
app.listen(PORT, "127.0.0.1", (error?: Error) => {
  if (error) {
    console.error(`Magic Mirror could not start on port ${PORT}: ${error.message}`);
    console.error("Another mirror is probably still running. Stop it (Ctrl+C in its terminal, or end node.exe), then start again.");
    process.exit(1);
  }
  console.log(`Magic Mirror ${prod ? "(prod)" : "(dev)"} at http://127.0.0.1:${PORT}`);
});

// Keep the offline fallback model loaded. Re-warm in case a request reset Ollama's keep-alive.
const warm = () =>
  warmOllama().catch((e: Error) => console.warn(`[llm] could not warm Ollama: ${e.message}`));
void warm();
setInterval(() => void warm(), 4 * 60_000);
