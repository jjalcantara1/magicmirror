// In-browser speed test: Kokoro TTS (WebGPU vs WASM) and local speech-to-text (Whisper, Moonshine).
// Results show on the page and print in the server terminal. Nothing is saved.
import { KokoroTTS } from "kokoro-js";
import { pipeline, type DataType } from "@huggingface/transformers";
import { TtsSession } from "@mintplex-labs/piper-tts-web";

const SENTENCE = "Abraca-pumpkin! What a splendid witch you are, with the pointiest hat in all the land.";
const STT_CLIP = "Mirror, mirror on the wall, who is the fairest of them all?";
const KOKORO = "onnx-community/Kokoro-82M-v1.0-ONNX";

type Device = "webgpu" | "wasm";
type Row = Record<string, string | number>;

const logEl = document.querySelector<HTMLPreElement>("#log")!;
const log = (line: string) => (logEl.textContent += `${line}\n`);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (x: number) => Math.round(x);

async function envInfo(): Promise<Row> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { vendor: string; architecture: string; description: string } } | null> } }).gpu;
  const adapter = gpu ? await gpu.requestAdapter() : null;
  return {
    webgpu: adapter ? `${adapter.info?.vendor ?? "?"} ${adapter.info?.architecture ?? ""} ${adapter.info?.description ?? ""}`.trim() : "not available",
    crossOriginIsolated: String(crossOriginIsolated),
    cpuThreads: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? navigator.userAgent,
  };
}

async function to16k(audio: Float32Array, rate: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil((audio.length * 16000) / rate), 16000);
  const buf = ctx.createBuffer(1, audio.length, rate);
  buf.copyToChannel(new Float32Array(audio), 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

async function benchTts(device: Device, dtype: "fp32" | "fp16" | "q8" | "q4f16"): Promise<{ row: Row; clip?: Float32Array }> {
  const name = `kokoro ${device} ${dtype}`;
  log(`${name}: loading…`);
  try {
    let t = performance.now();
    const tts = await KokoroTTS.from_pretrained(KOKORO, { dtype, device });
    const load = performance.now() - t;
    const runs: number[] = [];
    let audioSec = 0;
    for (let i = 0; i < 3; i++) {
      t = performance.now();
      const audio = await tts.generate(SENTENCE, { voice: "af_heart" });
      runs.push(performance.now() - t);
      audioSec = audio.audio.length / audio.sampling_rate;
    }
    const clipAudio = await tts.generate(STT_CLIP, { voice: "am_michael" });
    const clip = await to16k(clipAudio.audio, clipAudio.sampling_rate);
    await tts.model.dispose();
    const warm = median(runs.slice(1));
    log(`${name}: load ${ms(load)} ms, first ${ms(runs[0])} ms, warm ${ms(warm)} ms for ${audioSec.toFixed(1)} s of audio`);
    return { row: { config: name, loadMs: ms(load), firstMs: ms(runs[0]), warmMs: ms(warm), audioSec: +audioSec.toFixed(1), rtf: +(warm / 1000 / audioSec).toFixed(2) }, clip };
  } catch (e) {
    log(`${name}: FAILED ${(e as Error).message}`);
    return { row: { config: name, error: (e as Error).message } };
  }
}

const PIPER_WASM = {
  onnxWasm: "/ort/",
  piperWasm: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
  piperData: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data",
};
const SHORT = "Ahoy, brave pirate!";

async function benchPiper(voiceId: string): Promise<Row> {
  const name = `piper ${voiceId}`;
  log(`${name}: loading…`);
  try {
    TtsSession._instance = null; // the library keeps one session; reset it to load another voice
    let t = performance.now();
    const session = await TtsSession.create({ voiceId, wasmPaths: PIPER_WASM });
    const load = performance.now() - t;
    const seconds = async (blob: Blob) => {
      const header = new DataView(await blob.slice(0, 44).arrayBuffer());
      return (blob.size - 44) / 2 / header.getUint32(24, true);
    };
    const runs: number[] = [];
    let audioSec = 0;
    for (let i = 0; i < 3; i++) {
      t = performance.now();
      const wav = await session.predict(SENTENCE);
      runs.push(performance.now() - t);
      audioSec = await seconds(wav);
    }
    t = performance.now();
    const shortSec = await seconds(await session.predict(SHORT));
    const shortMs = performance.now() - t;
    const warm = median(runs.slice(1));
    log(`${name}: load ${ms(load)} ms, first ${ms(runs[0])} ms, warm ${ms(warm)} ms for ${audioSec.toFixed(1)} s; short ${ms(shortMs)} ms for ${shortSec.toFixed(1)} s`);
    return { config: name, loadMs: ms(load), firstMs: ms(runs[0]), warmMs: ms(warm), audioSec: +audioSec.toFixed(1), rtf: +(warm / 1000 / audioSec).toFixed(2), shortMs: ms(shortMs) };
  } catch (e) {
    log(`${name}: FAILED ${(e as Error).message}`);
    return { config: name, error: (e as Error).message };
  }
}

async function benchStt(model: string, device: Device, dtype: DataType | Record<string, DataType>, clip: Float32Array): Promise<Row> {
  const name = `${model.split("/")[1]} ${device}`;
  log(`${name}: loading…`);
  try {
    let t = performance.now();
    const asr = await pipeline("automatic-speech-recognition", model, { device, dtype });
    const load = performance.now() - t;
    const runs: number[] = [];
    let text = "";
    for (let i = 0; i < 3; i++) {
      t = performance.now();
      const out = await asr(clip);
      runs.push(performance.now() - t);
      text = (Array.isArray(out) ? out[0] : out).text.trim();
    }
    await asr.dispose();
    const warm = median(runs.slice(1));
    log(`${name}: load ${ms(load)} ms, first ${ms(runs[0])} ms, warm ${ms(warm)} ms → "${text}"`);
    return { config: name, loadMs: ms(load), firstMs: ms(runs[0]), warmMs: ms(warm), clipSec: +(clip.length / 16000).toFixed(1), transcript: text };
  } catch (e) {
    log(`${name}: FAILED ${(e as Error).message}`);
    return { config: name, error: (e as Error).message };
  }
}

function recommend(env: Row, tts: Row[], stt: Row[]): string[] {
  const lines: string[] = [];
  const fastest = (rows: Row[]) => rows.filter((r) => typeof r.warmMs === "number").sort((a, b) => (a.warmMs as number) - (b.warmMs as number))[0];
  const bestTts = fastest(tts);
  if (!bestTts) lines.push("TTS: Kokoro failed on every device; use browser speechSynthesis.");
  else if ((bestTts.warmMs as number) > 1500) lines.push(`TTS: ${bestTts.config} is the fastest but needs ${bestTts.warmMs} ms per 15-word sentence; too slow for a 2 s reply. Keep replies short, or fall back to speechSynthesis.`);
  else lines.push(`TTS: ${bestTts.config} (${bestTts.warmMs} ms per 15-word sentence, ${bestTts.rtf}x real time).`);
  const accurate = stt.filter((r) => typeof r.transcript === "string" && /fairest/i.test(r.transcript as string));
  const bestStt = fastest(accurate);
  if (bestStt) lines.push(`Local STT fallback: ${bestStt.config} (${bestStt.warmMs} ms for a ${bestStt.clipSec} s clip).`);
  else if (stt.length) lines.push("Local STT fallback: no local model transcribed the test clip correctly.");
  if (env.crossOriginIsolated !== "true") lines.push("Warning: page is not cross-origin isolated, so WASM ran single-threaded.");
  return lines;
}

async function run() {
  logEl.textContent = "";
  const env = await envInfo();
  log(`WebGPU: ${env.webgpu} | isolated: ${env.crossOriginIsolated} | threads: ${env.cpuThreads} | ${env.userAgent}\n`);
  const hasGpu = env.webgpu !== "not available";

  const tts: Row[] = [];
  for (const voice of ["en_GB-alan-medium", "en_GB-northern_english_male-medium", "en_US-ryan-high"]) tts.push(await benchPiper(voice));
  // ?only=piper skips the slow Kokoro and STT sections.
  if (new URLSearchParams(location.search).get("only") === "piper") {
    const recommendation = recommend(env, tts, []);
    log(`\nRecommendation:\n${recommendation.map((l) => `- ${l}`).join("\n")}`);
    await fetch("/api/bench-result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ env, tts, stt: [], recommendation }) });
    return;
  }

  let clip: Float32Array | undefined;
  for (const [device, dtype] of [["webgpu", "fp32"], ["webgpu", "fp16"], ["webgpu", "q4f16"], ["wasm", "q8"], ["wasm", "fp32"]] as const) {
    if (device === "webgpu" && !hasGpu) continue;
    const r = await benchTts(device, dtype);
    tts.push(r.row);
    clip ??= r.clip;
  }

  const stt: Row[] = [];
  if (!clip) log("No test clip (Kokoro failed), skipping STT.");
  else {
    const configs: [string, Device, DataType | Record<string, DataType>][] = [
      ["onnx-community/moonshine-base-ONNX", "webgpu", { encoder_model: "fp32", decoder_model_merged: "q4" }],
      ["onnx-community/moonshine-base-ONNX", "wasm", { encoder_model: "fp32", decoder_model_merged: "q8" }],
      ["onnx-community/whisper-base", "webgpu", { encoder_model: "fp32", decoder_model_merged: "q4" }],
      ["onnx-community/whisper-base", "wasm", "q8"],
    ];
    for (const [model, device, dtype] of configs) {
      if (device === "webgpu" && !hasGpu) continue;
      stt.push(await benchStt(model, device, dtype, clip));
    }
  }

  const recommendation = recommend(env, tts, stt);
  log(`\nRecommendation:\n${recommendation.map((l) => `- ${l}`).join("\n")}`);
  await fetch("/api/bench-result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ env, tts, stt, recommendation }) });
}

// One run at a time: parallel runs share the CPU and GPU and spoil each other's numbers.
const button = document.querySelector<HTMLButtonElement>("#run")!;
async function runOnce() {
  button.disabled = true;
  try {
    await run();
  } finally {
    button.disabled = false;
  }
}
button.addEventListener("click", () => void runOnce());
if (new URLSearchParams(location.search).has("auto")) void runOnce();
