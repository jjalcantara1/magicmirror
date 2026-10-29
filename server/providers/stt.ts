import OpenAI, { toFile } from "openai";
import { describeKey, firstGroqKey, keysFor, noteRefusal, rest, restingFor, retryAfterSeconds } from "./groqKeys.ts";

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
// The party speaks English, Tagalog and Taglish. A short or noisy clip can pass for another language
// (Malay, Welsh, Japanese...), and Whisper then writes it in that language. Such a clip is heard
// again as English and as Tagalog, at the same time, and the surer of the two is kept.
const ALLOWED = new Set(["en", "english", "tl", "tagalog", "fil", "filipino"]);
const RETRY_AS = ["en", "tl"];

type Heard = { text: string; language: string; confidence: number };

const usage = { day: "", requests: 0, lastError: "" };

export async function transcribeGroq(wav: Buffer, model: string, signal?: AbortSignal, apiKey = firstGroqKey(), language = LANGUAGE): Promise<Heard> {
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: 0 });
  const result = await client.audio.transcriptions.create(
    { file: await toFile(wav, "clip.wav", { type: "audio/wav" }), model, temperature: 0, response_format: "verbose_json", prompt: WHISPER_PROMPT, language },
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
  const kept = segments.filter((s) => s.avg_logprob >= -1 && s.end <= result.duration + 0.5 && !(s.compression_ratio > 2.4));
  const text = segments.length ? kept.map((s) => s.text).join("").trim() : result.text.trim();
  // How sure Whisper is of the words: their average log-probability (0 is certain).
  const confidence = kept.length ? kept.reduce((n, s) => n + s.avg_logprob, 0) / kept.length : segments.length ? -Infinity : 0;
  return { text: echoesPrompt(text) ? "" : text, language: (result.language ?? "").toLowerCase(), confidence };
}

// Hears a clip again as English and as Tagalog, and keeps the one Whisper is surer of. Nothing ("")
// when neither works out: better a "say that again" than an answer to words in another language.
async function hearAsEnglishOrTagalog(wav: Buffer, model: string, apiKey: string, heardAs: string): Promise<string> {
  const tries = await Promise.allSettled(RETRY_AS.map((l) => transcribeGroq(wav, model, undefined, apiKey, l)));
  const best = tries
    .flatMap((t, i) => (t.status === "fulfilled" && t.value.text ? [{ ...t.value, as: RETRY_AS[i] }] : []))
    .sort((a, b) => b.confidence - a.confidence)[0];
  console.log(`[stt] heard as ${heardAs || "an unknown language"}; kept ${best ? `the ${best.as === "en" ? "English" : "Tagalog"} hearing: "${best.text}"` : "nothing"}`);
  return best?.text ?? "";
}

// Tries each model in order, and for each model the keys in turn. "Too many requests" rests that
// key for that model and tries the next key; a refused key rests 10 minutes; any other failure
// (a retired model, say) moves on to the next model.
export async function transcribe(wav: Buffer, models: readonly string[]): Promise<{ text: string; model: string }> {
  let lastError: unknown = new Error("No speech-to-text model is set");
  for (const model of models) {
    const use = `stt:${model}`;
    const keys = keysFor(use);
    if (!keys.length && restingFor(use)) lastError = new Error(`${model}: every key is resting (${restingFor(use)} s)`);
    for (const { key, index } of keys) {
      try {
        const heard = await transcribeGroq(wav, model, undefined, key);
        usage.lastError = "";
        if (LANGUAGE || !heard.text || !heard.language || ALLOWED.has(heard.language)) return { text: heard.text, model };
        return { text: await hearAsEnglishOrTagalog(wav, model, key, heard.language), model: `${model}, heard again as English and Tagalog` };
      } catch (e) {
        lastError = e;
        noteRefusal(index, (e as Error).message);
        usage.lastError = `${model} ${describeKey(index)}: ${(e as Error).message}`;
        console.warn(`[stt] ${usage.lastError}`);
        const status = e instanceof OpenAI.APIError ? e.status : undefined;
        if (status === 429) rest(use, index, retryAfterSeconds(e instanceof OpenAI.APIError ? e.headers : undefined));
        else if (status === 401 || status === 403) rest(use, index, 600);
        else break;
      }
    }
  }
  throw lastError;
}

export function sttStatus() {
  const today = new Date().toISOString().slice(0, 10);
  return { target: "groq:whisper", requestsToday: usage.day === today ? usage.requests : 0, lastError: usage.lastError || undefined };
}
