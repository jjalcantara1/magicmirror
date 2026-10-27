import { parseWav, type Audio } from "../../src/wav.ts";
import { keyName, keysFor, rest, restingFor, retryAfterSeconds } from "./groqKeys.ts";

// Groq's Orpheus voice: much more human than the local Piper voice. The browser asks for each piece
// of a reply through /api/tts, so the API key stays on the laptop.
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_TTS_MAX_CHARS = 200; // Groq refuses longer input (checked 2026-10)
export const GROQ_MALE_VOICES = ["troy", "daniel", "austin"]; // Orpheus English male voices (checked 2026-10)

const usage = { day: "", requests: 0, lastError: "" };
const USE = "tts";

// Tries the keys in turn. "Too many requests" rests that key until Groq allows more; a refused key,
// or one whose account has not accepted the Orpheus terms yet, rests 10 minutes. When every key
// rests it fails at once, so the browser uses the local voice straight away.
export async function speakGroq(text: string, voice: string, model: string): Promise<Buffer> {
  const keys = keysFor(USE);
  if (!keys.length) throw new Error(restingFor(USE) ? `rate limited for ${restingFor(USE)} s more` : "GROQ_API_KEY is not set");
  let lastError = new Error("no key");
  for (const { key, index } of keys) {
    const res = await fetch(`${GROQ_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, voice, input: text, response_format: "wav" }),
      signal: AbortSignal.timeout(10_000),
    });
    const day = new Date().toISOString().slice(0, 10);
    if (usage.day !== day) Object.assign(usage, { day, requests: 0 });
    usage.requests++;
    if (res.ok) {
      usage.lastError = "";
      return Buffer.from(await res.arrayBuffer());
    }
    const detail = (await res.text()).slice(0, 200);
    usage.lastError = `${keyName(index)}: ${res.status} ${detail}`;
    lastError = new Error(`Groq TTS ${res.status}: ${detail}`);
    if (res.status === 429) rest(USE, index, Math.max(5, retryAfterSeconds(res.headers)));
    else if (res.status === 401 || res.status === 403 || /terms/i.test(detail)) rest(USE, index, 600);
    else throw lastError;
  }
  throw lastError;
}

export function ttsStatus() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    target: "groq:orpheus",
    requestsToday: usage.day === today ? usage.requests : 0,
    coolingDownSec: restingFor(USE),
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
    // Not the magic words: this line is never heard, and it should not look like the opening in Groq's logs.
    const wav = await speakGroq("Testing my voice for the party tonight. One, two, three, four, five!", voice, model);
    pitches[voice] = Math.round(medianPitch(parseWav(new Uint8Array(wav).buffer)));
  }
  const voice = Object.keys(pitches).sort((a, b) => pitches[a] - pitches[b])[0];
  return { voice, pitches };
}
