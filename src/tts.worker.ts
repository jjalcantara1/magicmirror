// Speech is made in a worker so that it does not freeze the face animation.
// The main voice is Groq's Orpheus (through /api/tts): it sounds like a person. Piper runs on the
// laptop's CPU as the backup, and as the only voice without a Groq key. Kokoro sounded richer than
// Piper, but on the party laptop's Intel GPU it ran 1-4x slower than real time (measured 2026-10-22).
import { TtsSession } from "@mintplex-labs/piper-tts-web";
import { octaveBelow, stretch, tightenPauses } from "./stretch.ts";
import { tooLong } from "./runaway.ts";
import { parseWav, type Audio } from "./wav.ts";

export type TtsInit = { type: "init"; engine: "groq" | "piper"; voice: string; piperVoice: string; pitch: number; speed: number; bass: boolean };
// tone: how Groq should say it, as an Orpheus direction like "cheerful" ("" = natural). Piper ignores it.
// line: which line this piece belongs to (a reply, the opening, a key's line). The speaker sends
// "end" with the line's number once all its pieces are sent.
type SpeakRequest = { type: "speak"; generation: number; line: number; text: string; voice: string; tone: string };
export type TtsRequest = TtsInit | SpeakRequest | { type: "end"; line: number } | { type: "cancel" };
export type TtsReply =
  | { type: "ready"; engine: string }
  | { type: "failed"; error: string }
  // pieces: how many speak requests this audio covers (Groq pieces are joined into one take).
  // starts: where each piece's words begin, as a share of the audio's length, so the face can
  // change mood mid-take. bass: the same audio an octave lower (empty when the bass layer is off).
  | { type: "audio"; generation: number; pieces: number; starts: number[]; samples: Float32Array; bass: Float32Array; sampleRate: number; genMs: number; by: string };

const GROQ_MAX_CHARS = 200; // Groq's limit per request (see server/providers/tts.ts)
// Groq says a whole line in one take where it fits: one recording flows from sentence to sentence
// like speech, with natural pauses and one voice, where separate recordings each start afresh and
// the tone jumped between them. Groq's AI writes a reply in a fraction of a second, so waiting for
// its end costs little; a slower AI is waited for no longer than this.
const HOLD_MS = 1000;
// Groq audio for lines said before, like the opening every visit starts with: those then start at
// once and use none of Groq's daily requests.
const said = new Map<string, Audio>();
const SAID_MAX = 24; // the opening and the C and H key lines all fit, with room for more
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
let endedLine = -1; // the latest line whose pieces have all arrived
let cancels = 0;
let wake: (() => void) | undefined; // ends a wait for the next message
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

// Splits text into parts of at most `max` characters: after the last sentence that fits, else at a
// comma, else at a space, so each part still sounds like a whole phrase.
function split(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    const lastEnd = (marks: RegExp) => Math.max(-1, ...[...head.matchAll(marks)].map((m) => m.index + 1));
    const at = [lastEnd(/[.!?…](?=\s)/g), lastEnd(/[,;:](?=\s)/g), head.lastIndexOf(" ")].find((n) => n > 0) ?? max;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// A take as Groq gets it: a direction at the start and wherever the tone changes, like
// "[cheerful] You're the fairest of them all! [playful] The Queen's so jealous." Each direction makes
// the voice more acted, so there are no more than the tone changes need.
const takeText = (take: SpeakRequest[]) =>
  take.map((p, i) => (p.tone && p.tone !== take[i - 1]?.tone ? `[${p.tone}] ` : "") + p.text).join(" ");
const withoutDirections = (text: string) => text.replace(/\[[^\]]*\]\s*/g, "");

// Where each piece starts in the take, as a share of its length (speech takes about as long as its letters).
function starts(take: SpeakRequest[]): number[] {
  const total = take.reduce((n, p) => n + p.text.length + 1, 0);
  let at = 0;
  return take.map((p) => {
    const share = at / total;
    at += p.text.length + 1;
    return share;
  });
}

function nextMessage(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = undefined;
      resolve();
    }, Math.max(0, ms));
    wake = () => {
      clearTimeout(timer);
      wake = undefined;
      resolve();
    };
  });
}

// Adds the rest of the line to a Groq take, waiting up to HOLD_MS for it to arrive. False when the
// speaker stopped meanwhile: then nothing is said, and no Groq request is spent.
async function gather(take: SpeakRequest[]): Promise<boolean> {
  const first = take[0];
  const deadline = performance.now() + HOLD_MS;
  const cancelled = cancels;
  for (;;) {
    if (cancels !== cancelled) return false;
    const next = queue[0];
    if (next?.generation === first.generation && next.line === first.line) {
      if (takeText([...take, next]).length > GROQ_MAX_CHARS) return true;
      take.push(queue.shift()!);
    } else if (next || endedLine >= first.line || performance.now() >= deadline) return true;
    else await nextMessage(deadline - performance.now());
  }
}

async function groqSpeech(text: string, voice: string): Promise<Audio> {
  const audio: Audio[] = [];
  for (const part of split(text, GROQ_MAX_CHARS)) {
    const body = JSON.stringify({ text: part, voice });
    const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body });
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

// Long pauses cut, then made shorter here and played lower by the pitch factor: a deeper voice,
// `speed` times as fast as the voice spoke it. Silence still counts its pieces, so the speaker's
// count of pending pieces stays right.
function send(take: SpeakRequest[], audio: Audio | undefined, start: number, by: string) {
  const cfg = config!;
  let samples = audio ? stretch(tightenPauses(audio.samples, audio.sampleRate), cfg.pitch / cfg.speed, audio.sampleRate) : new Float32Array(0);
  if (samples === audio?.samples) samples = samples.slice(); // sending it would empty the cached copy
  const bass = audio && cfg.bass ? octaveBelow(samples, audio.sampleRate) : new Float32Array(0);
  reply(
    {
      type: "audio",
      generation: take[0].generation,
      pieces: take.length,
      starts: starts(take),
      samples,
      bass,
      sampleRate: audio?.sampleRate ?? 22050,
      genMs: performance.now() - start,
      by,
    },
    [samples.buffer, bass.buffer],
  );
}

async function groqTake(take: SpeakRequest[]): Promise<Audio> {
  const text = takeText(take);
  const words = take.map((p) => p.text).join(" ");
  const voice = take[0].voice;
  const key = `${voice}|${text}`;
  const seconds = (a: Audio) => tightenPauses(a.samples, a.sampleRate).length / a.sampleRate;
  let audio = said.get(key);
  if (!audio) {
    audio = await groqSpeech(text, voice);
    // A looping take is asked for again without the directions; it is never played or kept.
    if (tooLong(words, seconds(audio))) {
      console.warn(`[tts] Groq looped (${seconds(audio).toFixed(1)} s for "${words}"); asking again`);
      audio = await groqSpeech(words, voice);
      if (tooLong(words, seconds(audio))) throw new Error("Groq looped twice");
    }
  }
  said.delete(key);
  said.set(key, audio); // newest last, so the oldest goes first
  if (said.size > SAID_MAX) said.delete(said.keys().next().value!);
  return audio;
}

async function pump() {
  if (busy || !ready || !config) return;
  busy = true;
  while (queue.length) {
    const take = [queue.shift()!];
    const groq = config.engine === "groq";
    if (groq && !(await gather(take))) continue; // stopped while waiting
    const cancelled = cancels;
    let start = performance.now();
    let by = `piper ${take[0].voice}`;
    if (groq) {
      try {
        send(take, await groqTake(take), start, `groq ${take[0].voice}`);
        continue;
      } catch (e) {
        by = `piper backup (Groq: ${(e as Error).message.slice(0, 80)})`;
      }
    }
    // Piper says the pieces one by one, so the first words start soonest.
    for (const piece of take) {
      if (cancels !== cancelled) break;
      let audio: Audio | undefined;
      let note = by;
      try {
        audio = await piperSpeech(piece.text, groq ? config.piperVoice : piece.voice);
      } catch (e) {
        console.warn("[tts] generate failed", e);
        note = `nothing: ${by}, and Piper failed too (${(e as Error).message.slice(0, 80)})`;
      }
      send([piece], audio, start, note);
      start = performance.now();
    }
  }
  busy = false;
}

self.onmessage = (e: MessageEvent<TtsRequest>) => {
  const msg = e.data;
  if (msg.type === "init") void init(msg);
  else if (msg.type === "speak") {
    queue.push(msg);
    void pump();
  } else if (msg.type === "end") endedLine = Math.max(endedLine, msg.line);
  else {
    queue.length = 0;
    cancels++;
  }
  wake?.();
};
