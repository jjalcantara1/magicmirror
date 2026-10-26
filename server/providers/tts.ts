import { parseWav, type Audio } from "../../src/wav.ts";

// Groq's Orpheus voice: much more human than the local Piper voice. The browser asks for each piece
// of a reply through /api/tts, so the API key stays on the laptop.
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_TTS_MAX_CHARS = 200; // Groq refuses longer input (checked 2026-10)
export const GROQ_MALE_VOICES = ["troy", "daniel", "austin"]; // Orpheus English male voices (checked 2026-10)

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

// The median pitch of the voiced parts, by autocorrelation in 40 ms frames. Of the lags that fit
// almost as well as the best, it takes the shortest, so it does not report half the real pitch.
function medianPitch({ samples, sampleRate }: Audio): number {
  const frame = Math.round(sampleRate * 0.04);
  const minLag = Math.round(sampleRate / 300);
  const maxLag = Math.round(sampleRate / 50);
  let peak = 0;
  for (const x of samples) peak = Math.max(peak, Math.abs(x));
  const fit = new Float32Array(maxLag + 1);
  const pitches: number[] = [];
  for (let start = 0; start + frame + maxLag < samples.length; start += frame >> 1) {
    let energy = 0;
    for (let i = 0; i < frame; i++) energy += samples[start + i] ** 2;
    if (Math.sqrt(energy / frame) < peak * 0.1) continue; // a pause
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let dot = 0;
      let other = 0;
      for (let i = 0; i < frame; i++) {
        dot += samples[start + i] * samples[start + i + lag];
        other += samples[start + i + lag] ** 2;
      }
      fit[lag] = dot / Math.sqrt(energy * other + 1e-12);
      best = Math.max(best, fit[lag]);
    }
    if (best < 0.6) continue; // not a voiced sound
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (fit[lag] >= 0.9 * best && fit[lag] >= fit[lag - 1] && fit[lag] >= fit[lag + 1]) {
        pitches.push(sampleRate / lag);
        break;
      }
    }
  }
  pitches.sort((a, b) => a - b);
  return pitches.length ? pitches[pitches.length >> 1] : Infinity;
}

// Asks Groq for the same line in each voice, and returns the voice with the lowest pitch.
export async function findDeepestVoice(voices: readonly string[], model: string): Promise<{ voice: string; pitches: Record<string, number> }> {
  const pitches: Record<string, number> = {};
  for (const voice of voices) {
    const wav = await speakGroq("Mirror, mirror, on the wall, who is the fairest of them all?", voice, model);
    pitches[voice] = Math.round(medianPitch(parseWav(new Uint8Array(wav).buffer)));
  }
  const voice = Object.keys(pitches).sort((a, b) => pitches[a] - pitches[b])[0];
  return { voice, pitches };
}
