import OpenAI, { toFile } from "openai";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// Whisper reads this as the talk so far. It biases it toward party words, and toward writing English,
// Tagalog and Taglish down as spoken: with an English-only prompt it tends to turn Tagalog into English.
const WHISPER_PROMPT =
  "Mirror, mirror on the wall. Salamin, salamin sa dingding, sino ang pinakamaganda sa lahat? Ako po! Ang ganda ng costume ko, diba? " +
  "Trick or treat! Can I have candy? Lollies, chocolate, kendi. " +
  "Halloween costumes: witch, wizard, pirate, princess, vampire, ghost, multo, aswang, kalabasa, pumpkin, dinosaur, superhero, Evil Queen.";
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
  const segments = result.segments ?? [];
  if (!segments.length) return result.text.trim();
  return segments
    .filter((s) => s.avg_logprob >= -1 && s.end <= result.duration + 0.5)
    .map((s) => s.text)
    .join("")
    .trim();
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
