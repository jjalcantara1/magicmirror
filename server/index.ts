import "./env.ts"; // first: loads .env before any other module reads a setting
import express from "express";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatStatus, chatWithFallback, warmOllama, type Turn } from "./providers/llm.ts";
import { sttStatus, transcribe } from "./providers/stt.ts";
import { groqKeyCount, keyHints, keyStatus, unreadKeyNames } from "./providers/groqKeys.ts";
import { findDeepestVoice, GROQ_MALE_VOICES, GROQ_TTS_MAX_CHARS, speakCached, ttsStatus } from "./providers/tts.ts";

const PORT = Number(process.env.PORT ?? 5173);
// The project folder. Paths start here, not at the working folder, so the server finds the page
// however it is started (npm script, VS Code debugger, or another folder).
const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Full large-v3 first: turbo loses more accuracy on less common languages like Tagalog.
const STT_MODELS = (process.env.STT_MODEL || "whisper-large-v3,whisper-large-v3-turbo").split(",").map((m) => m.trim()).filter(Boolean);
// The Groq voice needs a Groq key; without one, or with TTS_ENGINE=piper, the local Piper voice speaks.
const TTS_ENGINE = process.env.TTS_ENGINE === "piper" || !groqKeyCount() ? "piper" : "groq";
// Things worth remembering across restarts (not secrets): which Groq voice is deepest.
const MEMORY_FILE = join(ROOT, ".mirror-memory.json");
const remembered = (): { deepestVoice?: { model: string; voices: string[]; voice: string; pitches: Record<string, number> } } => {
  try {
    return JSON.parse(readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return {};
  }
};
const TTS_MODEL = process.env.TTS_MODEL || "canopylabs/orpheus-v1-english";
const PIPER_VOICE = process.env.TTS_VOICE || "en_GB-alan-medium";
const GROQ_VOICE_SETTING = process.env.GROQ_TTS_VOICE || "deepest";
let groqVoice = GROQ_VOICE_SETTING === "deepest" ? "troy" : GROQ_VOICE_SETTING;
// "deepest": ask Groq for one line in each male voice (3 requests) and use the lowest. The answer is
// remembered in .mirror-memory.json, so restarts spend none of Groq's voice requests on it. If Groq
// refuses (before its terms are accepted, say), the next page load tries again.
let voiceChosen: Promise<void> | undefined;
function chooseVoice(): Promise<void> {
  if (TTS_ENGINE !== "groq" || GROQ_VOICE_SETTING !== "deepest") return Promise.resolve();
  const known = remembered().deepestVoice;
  if (known?.model === TTS_MODEL && known.voices.join() === GROQ_MALE_VOICES.join()) {
    groqVoice = known.voice;
    return Promise.resolve();
  }
  if (!voiceChosen) console.log("[tts] checking which Groq voice is deepest (3 short requests, once; never played)");
  voiceChosen ??= findDeepestVoice(GROQ_MALE_VOICES, TTS_MODEL).then(
    ({ voice, pitches }) => {
      groqVoice = voice;
      console.log(`[tts] deepest Groq voice: ${voice} (median pitch: ${Object.entries(pitches).map(([v, hz]) => `${v} ${hz} Hz`).join(", ")})`);
      try {
        const memory = { ...remembered(), deepestVoice: { model: TTS_MODEL, voices: GROQ_MALE_VOICES, voice, pitches } };
        writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
      } catch (e) {
        console.warn(`[tts] could not remember the voice: ${(e as Error).message}`);
      }
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
    tts: {
      engine: TTS_ENGINE,
      voice: TTS_ENGINE === "groq" ? groqVoice : PIPER_VOICE,
      piperVoice: PIPER_VOICE,
      acting: process.env.VOICE_ACTING !== "off",
    },
    voiceFx: {
      // Deep, unhurried and cheeky: the settings chosen by ear on 2026-10-29.
      // Lower pitch, a louder rumble or more echo made it sound robotic and blurred the words.
      pitch: Number(process.env.VOICE_PITCH || 0.8),
      speed: Number(process.env.VOICE_SPEED || 0.85),
      echo: Number(process.env.VOICE_ECHO || 0.3), // the echo is shaped to stay off the words (speak.ts)
      bass: Number(process.env.VOICE_BASS || 0.2),
    },
    vad: {
      positive: Number(process.env.VAD_POSITIVE_THRESHOLD || 0.5),
      negative: Number(process.env.VAD_NEGATIVE_THRESHOLD || 0.35),
      redemptionMs: Number(process.env.VAD_REDEMPTION_MS || 1200), // children pause to think mid-sentence
      nearDb: Number(process.env.MIC_NEAR_DB || 7),
    },
  });
});

app.get("/api/status", (_req, res) => {
  res.json({ keys: keyStatus(), llm: chatStatus(), stt: sttStatus(), tts: ttsStatus() });
});

// The browser's voice worker asks for each piece of speech here, so the Groq key stays on the laptop.
app.post("/api/tts", express.json({ limit: "10kb" }), async (req, res) => {
  const { text, voice } = (req.body ?? {}) as { text?: unknown; voice?: unknown };
  if (typeof text !== "string" || !text.trim() || text.length > GROQ_TTS_MAX_CHARS || typeof voice !== "string") {
    res.status(400).json({ error: `Expected {text: 1-${GROQ_TTS_MAX_CHARS} characters, voice}` });
    return;
  }
  try {
    res.type("audio/wav").send(await speakCached(text, voice, TTS_MODEL));
  } catch (e) {
    console.warn(`[tts] no Groq key could speak this line, so the local voice says it (${(e as Error).message.slice(0, 120)})`);
    res.status(502).json({ error: (e as Error).message });
  }
});

// Audio is transcribed in memory and never written to disk.
app.post("/api/stt", express.raw({ type: "audio/wav", limit: "5mb" }), async (req, res) => {
  const start = performance.now();
  try {
    const { text, model } = await transcribe(req.body as Buffer, STT_MODELS);
    res.json({ text, ms: Math.round(performance.now() - start), provider: `groq ${model}` });
  } catch (e) {
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
  // Only the last 4 characters, so the right key can be checked without showing it.
  console.log(groqKeyCount() ? `[groq] using ${groqKeyCount()} key${groqKeyCount() > 1 ? "s" : ""}: ${keyHints().join(", ")}` : "[groq] no GROQ_API_KEY: the local voice only, and no AI");
  for (const name of unreadKeyNames())
    console.warn(`[groq] ${name} looks like a Groq key but is not read: name it GROQ_API_KEY_2 (or _3...), or list all keys in GROQ_API_KEY separated by commas`);
});

// Keep the offline fallback model loaded. Re-warm in case a request reset Ollama's keep-alive.
const warm = () =>
  warmOllama().catch((e: Error) => console.warn(`[llm] could not warm Ollama: ${e.message}`));
void warm();
setInterval(() => void warm(), 4 * 60_000);
