import OpenAI, { toFile } from "openai";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// Whisper reads this as the talk so far. It biases it toward party words, and toward writing English,
// Tagalog and Taglish down as spoken: with an English-only prompt it tends to turn Tagalog into English.
const SAYINGS = "Mirror, mirror on the wall. Salamin, salamin sa dingding, sino ang pinakamaganda sa lahat? Ako po! Ang ganda ng costume ko, diba? Trick or treat! Can I have candy? ";
const WORD_LIST = "Lollies, chocolate, kendi. Halloween costumes: witch, wizard, pirate, princess, vampire, ghost, multo, aswang, kalabasa, pumpkin, dinosaur, superhero, Evil Queen.";
const WHISPER_PROMPT = SAYINGS + WORD_LIST;
// From noise, Whisper sometimes "hears" its own prompt back. Children really say the sayings, but
// nobody says four words of the word list in a row, so those count as an echo.
const words = (s: string) => s.toLowerCase().match(/[a-z']+/g) ?? [];
const runs = (list: string[]) => list.map((_, i) => list.slice(i, i + 4).join(" ")).slice(0, -3);
const LIST_RUNS = new Set(runs(words(WORD_LIST)));
export const echoesPrompt = (text: string) => runs(words(text)).some((run) => LIST_RUNS.has(run));
// Blank: Whisper hears which language it is, which suits Taglish. "tl" or "en" forces one.
const LANGUAGE = process.env.STT_LANGUAGE || undefined;

const usage = { day: "", requests: 0 };

export async function transcribeGroq(wav: Buffer, model: string, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: 0 });
  const result = await client.audio.transcriptions.create(
    { file: await toFile(wav, "clip.wav", { type: "audio/wav" }), model, temperature: 0, response_format: "verbose_json", prompt: WHISPER_PROMPT, language: LANGUAGE },
    { signal: signal ?? AbortSignal.timeout(10_000) },
  );
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) Object.assign(usage, { day, requests: 0 });
  usage.requests++;
  // Whisper invents text ("Thank you.") from silence and noise. Groq returns no_speech_prob = 0 for
  // every segment (checked 2026-10-22), so drop segments below Whisper's own log-probability
  // threshold (-1.0), and segments that end after the audio ends.
  // Also drop segments that repeat themselves (compression ratio over Whisper's own 2.4), a sign of
  // text made up from noise, and any answer that is the prompt read back.
  const segments = result.segments ?? [];
  const text = segments.length
    ? segments
        .filter((s) => s.avg_logprob >= -1 && s.end <= result.duration + 0.5 && !(s.compression_ratio > 2.4))
        .map((s) => s.text)
        .join("")
        .trim()
    : result.text.trim();
  return echoesPrompt(text) ? "" : text;
}

// Tries each model in order, so a model that fails (rate limit, retired) falls back to the next.
export async function transcribe(wav: Buffer, models: readonly string[]): Promise<{ text: string; model: string }> {
  let lastError: unknown = new Error("No speech-to-text model is set");
  for (const model of models) {
    try {
      return { text: await transcribeGroq(wav, model), model };
    } catch (e) {
      lastError = e;
      console.warn(`[stt] ${model} failed: ${(e as Error).message}`);
    }
  }
  throw lastError;
}

export function sttStatus() {
  const today = new Date().toISOString().slice(0, 10);
  return { target: "groq:whisper", requestsToday: usage.day === today ? usage.requests : 0 };
}
