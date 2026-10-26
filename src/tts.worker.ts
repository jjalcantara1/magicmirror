// Speech is made in a worker so that it does not freeze the face animation.
// The main voice is Groq's Orpheus (through /api/tts): it sounds like a person. Piper runs on the
// laptop's CPU as the backup, and as the only voice without a Groq key. Kokoro sounded richer than
// Piper, but on the party laptop's Intel GPU it ran 1-4x slower than real time (measured 2026-10-22).
import { TtsSession } from "@mintplex-labs/piper-tts-web";
import { octaveBelow, stretch } from "./stretch.ts";
import { parseWav, type Audio } from "./wav.ts";

export type TtsInit = { type: "init"; engine: "groq" | "piper"; voice: string; piperVoice: string; pitch: number; bass: boolean };
type SpeakRequest = { type: "speak"; generation: number; text: string; voice: string };
export type TtsRequest = TtsInit | SpeakRequest | { type: "cancel" };
export type TtsReply =
  | { type: "ready"; engine: string }
  | { type: "failed"; error: string }
  // pieces: how many speak requests this audio covers (Groq pieces are joined into one request).
  // bass: the same audio an octave lower (empty when the bass layer is off).
  | { type: "audio"; generation: number; pieces: number; samples: Float32Array; bass: Float32Array; sampleRate: number; genMs: number; by: string };

const GROQ_MAX_CHARS = 200; // Groq's limit per request (see server/providers/tts.ts)
// Groq audio for lines said before, like the opening every visit starts with: those then start at
// once and use none of Groq's daily requests.
const said = new Map<string, Audio>();
const SAID_MAX = 10;
const WASM_PATHS = {
  // The server serves the onnxruntime-web version that this bundle imports.
  onnxWasm: "/ort/",
  // shortcut: the phonemizer still loads from the CDN, so speech needs internet until the first
  // load is cached. Serve these two files locally for offline mode (M3).
  piperWasm: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
  piperData: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data",
};

let config: TtsInit | undefined;
let ready = false;
let busy = false;
const queue: SpeakRequest[] = [];
let piper: { voice: string; session: Promise<TtsSession> } | undefined;
const reply = (msg: TtsReply, transfer: Transferable[] = []) => postMessage(msg, { transfer });

function loadPiper(voice: string): Promise<TtsSession> {
  if (piper?.voice !== voice) {
    // The library keeps one session and ignores a new voiceId on it, so reset it to change voice.
    TtsSession._instance = null;
    const session = TtsSession.create({ voiceId: voice, wasmPaths: WASM_PATHS }).then(async (s) => {
      await s.predict("Mirror, mirror."); // warm up, so the first visitor does not wait for it
      return s;
    });
    piper = { voice, session };
    session.catch(() => {
      if (piper?.session === session) piper = undefined; // try again next time
    });
  }
  return piper.session;
}

// Splits text into parts of at most `max` characters, at spaces.
function split(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = rest.lastIndexOf(" ", max);
    const at = cut > 0 ? cut : max;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function groqSpeech(text: string, voice: string): Promise<Audio> {
  const audio: Audio[] = [];
  for (const part of split(text, GROQ_MAX_CHARS)) {
    const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: part, voice }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    audio.push(parseWav(await res.arrayBuffer()));
  }
  const samples = new Float32Array(audio.reduce((n, a) => n + a.samples.length, 0));
  let at = 0;
  for (const a of audio) {
    samples.set(a.samples, at);
    at += a.samples.length;
  }
  return { samples, sampleRate: audio[0].sampleRate };
}

async function piperSpeech(text: string, voice: string): Promise<Audio> {
  const session = await loadPiper(voice);
  return parseWav(await (await session.predict(text)).arrayBuffer());
}

async function init(msg: TtsInit) {
  config = msg;
  if (msg.engine === "groq") {
    ready = true;
    reply({ type: "ready", engine: `groq ${msg.voice} (backup: piper ${msg.piperVoice})` });
    void pump();
    // The local voice loads in the background, as the backup for when Groq cannot answer.
    loadPiper(msg.piperVoice).catch((e) => console.warn("[tts] backup voice did not load", e));
    return;
  }
  try {
    await loadPiper(msg.voice);
    ready = true;
    reply({ type: "ready", engine: `piper ${msg.voice}` });
    void pump();
  } catch (e) {
    reply({ type: "failed", error: (e as Error).message });
  }
}

async function pump() {
  if (busy || !ready || !config) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift()!;
    let text = job.text;
    let pieces = 1;
    const groq = config.engine === "groq";
    // Pieces that queued up while the last request ran go to Groq as one request: fewer requests
    // (Groq limits them), and the first piece of a reply still goes alone, so speech starts soon.
    while (groq && queue[0]?.generation === job.generation && text.length + 1 + queue[0].text.length <= GROQ_MAX_CHARS) {
      text += ` ${queue.shift()!.text}`;
      pieces++;
    }
    const start = performance.now();
    let audio: Audio | undefined;
    let by = groq ? `groq ${job.voice}` : `piper ${job.voice}`;
    if (groq) {
      const key = `${job.voice}|${text}`;
      try {
        audio = said.get(key) ?? (await groqSpeech(text, job.voice));
        said.delete(key);
        said.set(key, audio); // newest last, so the oldest goes first
        if (said.size > SAID_MAX) said.delete(said.keys().next().value!);
      } catch (e) {
        by = `piper backup (Groq: ${(e as Error).message.slice(0, 80)})`;
      }
    }
    if (!audio) {
      try {
        audio = await piperSpeech(text, groq ? config.piperVoice : job.voice);
      } catch (e) {
        console.warn("[tts] generate failed", e);
        by = `nothing: ${by}, and Piper failed too (${(e as Error).message.slice(0, 80)})`;
      }
    }
    // Shorter here, then played lower by the same factor: a deeper voice at a natural speed.
    let samples = audio ? stretch(audio.samples, config.pitch, audio.sampleRate) : new Float32Array(0);
    if (samples === audio?.samples) samples = samples.slice(); // sending it would empty the cached copy
    const bass = audio && config.bass ? octaveBelow(samples, audio.sampleRate) : new Float32Array(0);
    // Silence still counts its pieces, so the speaker's count of pending pieces stays right.
    reply(
      { type: "audio", generation: job.generation, pieces, samples, bass, sampleRate: audio?.sampleRate ?? 22050, genMs: performance.now() - start, by },
      [samples.buffer, bass.buffer],
    );
  }
  busy = false;
}

self.onmessage = (e: MessageEvent<TtsRequest>) => {
  const msg = e.data;
  if (msg.type === "init") void init(msg);
  else if (msg.type === "speak") {
    queue.push(msg);
    void pump();
  } else queue.length = 0;
};
