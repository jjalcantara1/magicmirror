// Groq's Orpheus voice: much more human than the local Piper voice. The browser asks for each piece
// of a reply through /api/tts, so the API key stays on the laptop.
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_TTS_MAX_CHARS = 200; // Groq refuses longer input (checked 2026-10)

const usage = { day: "", requests: 0, coolUntil: 0, lastError: "" };

export async function speakGroq(text: string, voice: string, model: string): Promise<Buffer> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  // After a "too many requests" answer, fail at once until Groq allows more, so the browser uses the
  // local voice straight away instead of waiting for another refusal.
  const wait = Math.ceil((usage.coolUntil - Date.now()) / 1000);
  if (wait > 0) throw new Error(`rate limited for ${wait} s more`);
  const res = await fetch(`${GROQ_BASE_URL}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, voice, input: text, response_format: "wav" }),
    signal: AbortSignal.timeout(10_000),
  });
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) Object.assign(usage, { day, requests: 0 });
  usage.requests++;
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    if (res.status === 429) usage.coolUntil = Date.now() + 1000 * Math.max(5, Number(res.headers.get("retry-after")) || 60);
    usage.lastError = `${res.status} ${detail}`;
    throw new Error(`Groq TTS ${res.status}: ${detail}`);
  }
  usage.lastError = "";
  return Buffer.from(await res.arrayBuffer());
}

export function ttsStatus() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    target: "groq:orpheus",
    requestsToday: usage.day === today ? usage.requests : 0,
    coolingDownSec: Math.max(0, Math.ceil((usage.coolUntil - Date.now()) / 1000)),
    lastError: usage.lastError || undefined,
  };
}
