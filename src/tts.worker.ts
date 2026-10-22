// Piper runs in a worker so that generating speech does not freeze the face animation.
// Kokoro sounded richer, but on the party laptop's Intel GPU it ran 1-4x slower than real time
// (measured 2026-10-22), so speech came out choppy. Piper is a much smaller model and runs on the CPU.
import { TtsSession } from "@mintplex-labs/piper-tts-web";

type SpeakRequest = { type: "speak"; generation: number; text: string; voice: string };
export type TtsRequest = { type: "init"; voice: string } | SpeakRequest | { type: "cancel" };
export type TtsReply =
  | { type: "ready"; engine: string }
  | { type: "failed"; error: string }
  | { type: "audio"; generation: number; samples: Float32Array; sampleRate: number; genMs: number };

const WASM_PATHS = {
  // The server serves the onnxruntime-web version that this bundle imports.
  onnxWasm: "/ort/",
  // shortcut: the phonemizer still loads from the CDN, so speech needs internet until the first
  // load is cached. Serve these two files locally for offline mode (M3).
  piperWasm: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
  piperData: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data",
};

let session: TtsSession | undefined;
let busy = false;
const queue: SpeakRequest[] = [];
const reply = (msg: TtsReply, transfer: Transferable[] = []) => postMessage(msg, { transfer });

async function load(voice: string): Promise<TtsSession> {
  if (session?.voiceId === voice) return session;
  // The library keeps one session and ignores a new voiceId on it, so reset it to change voice.
  TtsSession._instance = null;
  session = await TtsSession.create({ voiceId: voice, wasmPaths: WASM_PATHS });
  return session;
}

// Piper returns a 16-bit mono WAV with a 44-byte header.
function wavToSamples(wav: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const sampleRate = new DataView(wav).getUint32(24, true);
  const pcm = new Int16Array(wav, 44);
  const samples = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
  return { samples, sampleRate };
}

async function init(voice: string) {
  try {
    const s = await load(voice);
    await s.predict("Mirror, mirror."); // warm up, so the first visitor does not wait for it
    reply({ type: "ready", engine: `piper ${voice}` });
    void pump();
  } catch (e) {
    reply({ type: "failed", error: (e as Error).message });
  }
}

async function pump() {
  if (busy || !session) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift()!;
    const start = performance.now();
    try {
      const s = await load(job.voice);
      const { samples, sampleRate } = wavToSamples(await (await s.predict(job.text)).arrayBuffer());
      reply({ type: "audio", generation: job.generation, samples, sampleRate, genMs: performance.now() - start }, [samples.buffer]);
    } catch (e) {
      console.warn("[tts] generate failed", e);
      // Reply with silence so the speaker's count of pending pieces stays right.
      reply({ type: "audio", generation: job.generation, samples: new Float32Array(0), sampleRate: 22050, genMs: performance.now() - start });
    }
  }
  busy = false;
}

self.onmessage = (e: MessageEvent<TtsRequest>) => {
  const msg = e.data;
  if (msg.type === "init") void init(msg.voice);
  else if (msg.type === "speak") {
    queue.push(msg);
    void pump();
  } else queue.length = 0;
};
