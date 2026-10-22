import OpenAI, { toFile } from "openai";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// Biases Whisper toward party words that kids say often.
const WHISPER_PROMPT = "Mirror, mirror on the wall. Halloween costumes: witch, wizard, pirate, princess, vampire, ghost, pumpkin, dinosaur, superhero, Evil Queen.";

const usage = { day: "", requests: 0 };

export async function transcribeGroq(wav: Buffer, model: string, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: 0 });
  const result = await client.audio.transcriptions.create(
    { file: await toFile(wav, "clip.wav", { type: "audio/wav" }), model, temperature: 0, response_format: "verbose_json", prompt: WHISPER_PROMPT },
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

export function sttStatus() {
  const today = new Date().toISOString().slice(0, 10);
  return { target: "groq:whisper", requestsToday: usage.day === today ? usage.requests : 0 };
}
