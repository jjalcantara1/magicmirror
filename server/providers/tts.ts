import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tooLong } from "../../src/runaway.ts";
import { tightenPauses } from "../../src/stretch.ts";
import { parseWav, type Audio } from "../../src/wav.ts";
import { describeKey, keysFor, noteRefusal, rest, restingFor, retryAfterSeconds } from "./groqKeys.ts";

// Groq's Orpheus voice: much more human than the local Piper voice. The browser asks for each line
// (a whole reply where it fits) through /api/tts, so the API key stays on the laptop.
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_TTS_MAX_CHARS = 200; // Groq refuses longer input (checked 2026-10)
export const GROQ_MALE_VOICES = ["troy", "daniel", "austin"]; // Orpheus English male voices (checked 2026-10)

const usage = { day: "", requests: 0, fromDisk: 0, lastError: "" };
const USE = "tts";

// Lines said before (the opening of every visit, the C and H lines, the "Oops" line) come from disk,
// across page reloads and restarts, so the voice's small daily limit (3,600 tokens a day per Groq
// organization on the free tier, checked 2026-10) is spent on new words only. Most recent 300 kept.
const CACHE_DIR = fileURLToPath(new URL("../../.mirror-cache/voice/", import.meta.url));
const CACHE_MAX = 300;

function countToday(field: "requests" | "fromDisk") {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) Object.assign(usage, { day, requests: 0, fromDisk: 0 });
  usage[field]++;
}

const cacheFile = (text: string, voice: string, model: string) =>
  join(CACHE_DIR, `${createHash("sha1").update(`${model}|${voice}|${text}`).digest("hex")}.wav`);

/** Whether this line is already on disk, so saying it costs no Groq request. */
export const isCached = (text: string, voice: string, model: string) => existsSync(cacheFile(text, voice, model));

export async function speakCached(text: string, voice: string, model: string): Promise<Buffer> {
  const file = cacheFile(text, voice, model);
  try {
    const wav = readFileSync(file);
    const now = new Date();
    utimesSync(file, now, now); // recently used: kept longest
    countToday("fromDisk");
    return wav;
  } catch {}
  const wav = await speakGroq(text, voice, model);
  try {
    // A looping take (see runaway.ts) is not kept; the browser asks for it again.
    const audio = parseWav(new Uint8Array(wav).buffer);
    const seconds = tightenPauses(audio.samples, audio.sampleRate).length / audio.sampleRate;
    if (!tooLong(text.replace(/\[[^\]]*\]\s*/g, ""), seconds)) {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(file, wav);
      const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".wav"));
      if (files.length > CACHE_MAX)
        files
          .map((f) => ({ f, at: statSync(join(CACHE_DIR, f)).mtimeMs }))
          .sort((a, b) => a.at - b.at)
          .slice(0, files.length - CACHE_MAX)
          .forEach(({ f }) => unlinkSync(join(CACHE_DIR, f)));
    }
  } catch (e) {
    console.warn(`[tts] could not keep this line on disk: ${(e as Error).message}`);
  }
  return wav;
}

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
      signal: AbortSignal.timeout(6_000), // then the next key, or the local voice in the browser
    });
    countToday("requests");
    if (res.ok) {
      usage.lastError = "";
      return Buffer.from(await res.arrayBuffer());
    }
    // Groq's own words, in full: they name the organization and which limit (e.g. tokens per day).
    const body = await res.text();
    let detail = body;
    try {
      detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
    } catch {}
    noteRefusal(index, detail);
    usage.lastError = `${describeKey(index)}: ${res.status} ${detail.slice(0, 400)}`;
    console.warn(`[tts] ${usage.lastError}`);
    lastError = new Error(`Groq TTS ${res.status}: ${detail.slice(0, 400)}`);
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
    fromDiskToday: usage.day === today ? usage.fromDisk : 0,
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
