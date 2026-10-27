// Speed test for the server side of the pipeline: Groq STT, Groq chat, Ollama chat, Kokoro in Node.
// The browser side (Kokoro WebGPU/WASM, local Whisper/Moonshine) is in bench.html.
// Nothing is written to disk.
import "../server/env.ts"; // first: loads .env before any other module reads a setting
import { KokoroTTS } from "kokoro-js";
import { groqTarget, ollamaTarget, SYSTEM_PROMPT, streamChat, type LlmTarget } from "../server/providers/llm.ts";
import { transcribeGroq } from "../server/providers/stt.ts";

const SENTENCE = "Abraca-pumpkin! What a splendid witch you are, with the pointiest hat in all the land.";
const STT_CLIP = "Mirror, mirror on the wall, who is the fairest of them all?";
const KID_TURNS = [
  "Hello mirror! I'm a pirate! Can you tell me a riddle?",
  "Do you like my dinosaur costume? Rawr!",
  "Mirror, mirror on the wall, who is the fairest of them all?",
];
const GROQ_CHAT_MODELS = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b"];
const GROQ_STT_MODEL = (process.env.STT_MODEL || "whisper-large-v3").split(",")[0].trim();
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (x: number) => `${Math.round(x)} ms`;

async function benchKokoro() {
  console.log("\n## Kokoro TTS in Node (CPU, q8) — used by make-canned; the browser bench covers live TTS");
  let t = performance.now();
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
  const loadMs = performance.now() - t;
  const runs: number[] = [];
  let audioSec = 0;
  for (let i = 0; i < 3; i++) {
    t = performance.now();
    const audio = await tts.generate(SENTENCE, { voice: "af_heart" });
    runs.push(performance.now() - t);
    audioSec = audio.audio.length / audio.sampling_rate;
  }
  console.table({ load: ms(loadMs), firstRun: ms(runs[0]), warmMedian: ms(median(runs.slice(1))), audio: `${audioSec.toFixed(1)} s`, realtimeFactor: (median(runs.slice(1)) / 1000 / audioSec).toFixed(2) });
  const clip = await tts.generate(STT_CLIP, { voice: "am_michael" });
  return Buffer.from(clip.toWav());
}

async function benchGroqStt(wav: Buffer) {
  console.log(`\n## Groq STT (${GROQ_STT_MODEL}) on a ~3 s clip`);
  if (!process.env.GROQ_API_KEY) return console.log("skipped: GROQ_API_KEY not set");
  const runs: number[] = [];
  let text = "";
  try {
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      text = await transcribeGroq(wav, GROQ_STT_MODEL);
      runs.push(performance.now() - t);
    }
    console.table({ firstRun: ms(runs[0]), warmMedian: ms(median(runs.slice(1))), transcript: text });
    return median(runs.slice(1));
  } catch (e) {
    console.log(`failed: ${(e as Error).message}`);
  }
}

type ChatResult = { target: string; coldTtft: number; warmTtft: number; warmTotal: number; tokPerSec: number; sample: string; sizeGb?: number };

async function benchChat(target: LlmTarget, sizeGb?: number): Promise<ChatResult | undefined> {
  const label = `${target.provider}:${target.model}`;
  process.stdout.write(`  ${label} ... `);
  const ttfts: number[] = [];
  const totals: number[] = [];
  const rates: number[] = [];
  let sample = "";
  try {
    for (const turn of KID_TURNS) {
      const s = await streamChat(target, [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: turn }], () => {}, AbortSignal.timeout(120_000));
      ttfts.push(s.firstTokenMs);
      totals.push(s.totalMs);
      if (s.completionTokens) rates.push(s.completionTokens / ((s.totalMs - s.firstTokenMs) / 1000));
      sample = s.text.replace(/\s+/g, " ").trim();
    }
  } catch (e) {
    console.log(`failed: ${(e as Error).message}`);
    return;
  }
  console.log("done");
  return { target: label, coldTtft: ttfts[0], warmTtft: median(ttfts.slice(1)), warmTotal: median(totals.slice(1)), tokPerSec: rates.length ? median(rates) : NaN, sample, sizeGb };
}

async function ollamaModels(): Promise<{ name: string; size: number }[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as { models: { name: string; size: number }[] };
    return body.models.sort((a, b) => a.size - b.size);
  } catch {
    return [];
  }
}

function printChat(results: ChatResult[]) {
  console.table(
    results.map((r) => ({
      model: r.target,
      coldFirstToken: ms(r.coldTtft),
      warmFirstToken: ms(r.warmTtft),
      warmTotal: ms(r.warmTotal),
      "tok/s": Number.isNaN(r.tokPerSec) ? "?" : r.tokPerSec.toFixed(0),
    })),
  );
  for (const r of results) console.log(`  ${r.target}: "${r.sample}"`);
}

const wav = await benchKokoro();
const groqSttMs = await benchGroqStt(wav);

console.log("\n## Groq chat (system prompt + one kid turn; 3 runs each)");
const groq: ChatResult[] = [];
if (!process.env.GROQ_API_KEY) console.log("skipped: GROQ_API_KEY not set");
else for (const model of GROQ_CHAT_MODELS) {
  const target = groqTarget(model);
  const r = target && (await benchChat(target));
  if (r) groq.push(r);
}
if (groq.length) printChat(groq);

console.log("\n## Ollama chat (first run includes model load + prompt prefill)");
const models = await ollamaModels();
const ollama: ChatResult[] = [];
if (!models.length) console.log(`skipped: Ollama not reachable at ${OLLAMA_URL}`);
for (const m of models) {
  const r = await benchChat(ollamaTarget(m.name), m.size / 1e9);
  if (r) ollama.push(r);
}
if (ollama.length) printChat(ollama);

console.log("\n## Recommendation (server side)");
const bestGroq = [...groq].sort((a, b) => a.warmTtft - b.warmTtft)[0];
console.log(bestGroq ? `- LLM default: ${bestGroq.target} (warm first token ${ms(bestGroq.warmTtft)})` : "- LLM default: none measured (add GROQ_API_KEY and re-run)");
// Biggest local model that still answers quickly once warm.
const okOllama = ollama.filter((r) => r.warmTtft < 2500 && r.warmTotal < 6000);
const bestOllama = okOllama.sort((a, b) => (b.sizeGb ?? 0) - (a.sizeGb ?? 0))[0];
console.log(bestOllama ? `- LLM fallback: ${bestOllama.target} (warm first token ${ms(bestOllama.warmTtft)}, total ${ms(bestOllama.warmTotal)})` : "- LLM fallback: no Ollama model was fast enough (warm first token < 2.5 s)");
console.log(groqSttMs ? `- STT default: groq ${GROQ_STT_MODEL} (${ms(groqSttMs)})` : "- STT default: not measured; see the browser bench for local STT");
