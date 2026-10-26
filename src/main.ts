import "./style.css";
import { utils } from "@ricky0123/vad-web";
import { createChunker, createConversation } from "./conversation.ts";
import { EFFECTS, MOODS, type Effect, type Mood } from "./face/face.ts";
import { createMaskFace } from "./face/maskFace.ts";
import { createListener, type VadConfig } from "./listen.ts";
import { createOperator } from "./operator.ts";
import { createSpeaker, type VoiceFx } from "./speak.ts";
import { createState } from "./state.ts";

type Config = { ttsVoice: string; voiceFx: VoiceFx; listenMode: string; vad: VadConfig };
type ChatEvent = { delta: string } | { done: true; provider: string; firstTokenMs: number } | { error: string };

const GREETING =
  "(A new visitor has just stepped up to the mirror. Greet them with a grand, fun entrance, and invite them to say the magic words: Mirror, mirror, on the wall.)";
// The magic words. Speech-to-text writes them in many ways, so match the core of them.
const SUMMONS = /\bmirror\W+mirror\b|\bmagic mirror\b|\bmirror on the wall\b/i;
// Piper "medium" voices: 3-4x faster than real time on the party laptop; "high" ones are 2.6x
// slower (measured 2026-10-22). The first press of V on a new voice downloads it (~60 MB) once.
const AUDITION_VOICES = [
  "en_GB-alan-medium",
  "en_GB-northern_english_male-medium",
  "en_US-ryan-medium",
  "en_US-norman-medium",
  "en_US-joe-medium",
  "en_GB-cori-medium",
  "en_GB-alba-medium",
  "en_US-lessac-medium",
];
const ECHO_TAIL_MS = 500; // let the hall echo die away before the mic listens again (half-duplex)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Declared before anything that awaits, so the hotkeys work while the mirror boots.
let visit = 0; // bumped by every wake and reset, so stale async work can tell it is stale
let inflight: AbortController | undefined;
let latencyStart = 0;
let latencyFrom = "";

const config = (await (await fetch("/api/config")).json()) as Config;
const face = createMaskFace(document.querySelector("#mirror")!);
const conversation = createConversation();
const operator = createOperator({ wake: () => void wake(), reset, nextVoice });
const speaker = createSpeaker(config.ttsVoice, config.voiceFx, {
  onLevel: (level, shape) => face.setMouth(level, shape),
  onAudioStart,
  onPiece: (genMs, audioSec) => operator.set("speech", `last piece took ${Math.round(genMs)} ms to make ${audioSec.toFixed(1)} s of audio`),
});
const state = createState((s, faceState) => {
  face.setState(faceState);
  operator.set("state", s);
  if (s === "THINKING") speaker.chime();
});
face.setState("asleep");
operator.set("state", "SLEEPING");
operator.set("voice", config.ttsVoice);
operator.set("tts", "loading…");
void speaker.ready.then((engine) => {
  operator.set("tts", engine);
  document.querySelector("#boot")?.remove();
});

const listener = await createListener(speaker.audioContext, config.vad, {
  onUtterance: (audio) => void onUtterance(audio),
  onFrame: (p, level) => {
    // The face reacts only to speech, by the VAD's own thresholds, so noise does not set it off. The
    // meter is full at a level of 0.2, a loud voice; the square root lets a shy voice count too.
    // The face starts to react above 0.12, so check "face" on the mic line at the party.
    const speechLike = Math.min(1, Math.max(0, (p - config.vad.negative) / Math.max(0.05, config.vad.positive - config.vad.negative)));
    const heard = speechLike * Math.min(1, Math.sqrt(level * 5));
    face.hear(heard);
    operator.set("mic", `${"█".repeat(Math.min(30, Math.round(level * 150))).padEnd(30, "·")} speech ${p.toFixed(2)} face ${heard.toFixed(2)}`);
  },
});
// Ask for the mic now, so the permission prompt does not appear in the middle of a greeting.
await listener.start();
await listener.pause();

function onAudioStart() {
  if (!latencyStart) return;
  operator.set("reply", `voice started ${Math.round(performance.now() - latencyStart)} ms after ${latencyFrom}`);
  latencyStart = 0;
}

async function* readEvents(res: Response): AsyncGenerator<ChatEvent> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    for (let i = buffer.indexOf("\n\n"); i >= 0; i = buffer.indexOf("\n\n")) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      if (line.startsWith("data: ")) yield JSON.parse(line.slice(6)) as ChatEvent;
    }
  }
}

function raiseAlert() {
  operator.alert();
  speaker.beep();
  const last = conversation.turns().findLast((t) => t.role === "user");
  console.warn("[ALERT] The mirror flagged a worrying message. Please check on the child. Last words:", last?.content);
}

async function listen(v: number) {
  state.set("LISTENING");
  await delay(ECHO_TAIL_MS);
  if (v !== visit || state.get() !== "LISTENING") return;
  await listener.start();
}

async function respond(v: number) {
  state.set("THINKING");
  inflight = new AbortController();
  let speaking = false;
  const chunker = createChunker((chunk) => {
    for (const name of chunk.effects) if ((EFFECTS as readonly string[]).includes(name)) face.effect(name as Effect);
    for (const name of chunk.moods) if ((MOODS as readonly string[]).includes(name)) face.setMood(name as Mood);
    if (chunk.alert) raiseAlert();
    if (!chunk.text) return;
    if (!speaking) {
      speaking = true;
      state.set("SPEAKING");
    }
    speaker.say(chunk.text);
  });
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns: conversation.turns() }),
      signal: inflight.signal,
    });
    for await (const event of readEvents(res)) {
      if ("delta" in event) {
        if (!chunker.push(event.delta)) {
          inflight.abort();
          break;
        }
      } else if ("error" in event) throw new Error(event.error);
      else operator.set("llm", `${event.provider} · first word ${event.firstTokenMs} ms`);
    }
    chunker.end();
  } catch (e) {
    if (v !== visit) return;
    console.warn("[chat]", e);
    operator.set("llm", `failed: ${(e as Error).message}`);
    if (!speaking) {
      state.set("SPEAKING");
      speaker.say("Bother! A smudge upon my glass! Ask me once more!");
    }
  }
  if (v !== visit) return;
  const reply = chunker.spoken();
  if (reply) {
    conversation.add({ role: "assistant", content: reply });
    operator.transcript(`mirror: ${reply}`);
  }
  await speaker.finish();
  if (v !== visit) return;
  await listen(v);
}

async function onUtterance(audio: Float32Array) {
  if (state.get() !== "LISTENING") return;
  const v = visit;
  void listener.pause();
  // The VAD fires after redemptionMs of silence; the child stopped talking that long ago.
  latencyStart = performance.now() - config.vad.redemptionMs;
  latencyFrom = "the child stopped";
  state.set("THINKING");
  let text = "";
  try {
    const res = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: utils.encodeWAV(audio, 1, 16000, 1, 16) });
    const body = (await res.json()) as { text?: string; ms?: number; error?: string };
    if (!res.ok) throw new Error(body.error);
    text = body.text ?? "";
    operator.set("stt", `groq · ${body.ms} ms`);
  } catch (e) {
    console.warn("[stt]", e);
    operator.set("stt", `failed: ${(e as Error).message}`);
  }
  if (v !== visit) return;
  if (!text) {
    // Noise, or nothing understood: keep listening without a word.
    latencyStart = 0;
    await listen(v);
    return;
  }
  operator.transcript(`child:  ${text}`);
  // The glass stirs at once when it hears the magic words, while the reply is still on its way.
  if (SUMMONS.test(text)) {
    face.effect("smoke");
    face.effect("glow");
  }
  conversation.add({ role: "user", content: text });
  await respond(v);
}

async function wake() {
  void speaker.resume();
  if (state.get() !== "SLEEPING") return;
  const v = ++visit;
  conversation.reset();
  operator.clearTranscript();
  state.set("WAKING");
  await delay(1200); // let the mask fade in
  if (v !== visit) return;
  latencyStart = performance.now();
  latencyFrom = "the greeting started";
  conversation.add({ role: "user", content: GREETING });
  await respond(v);
}

function reset() {
  visit++;
  inflight?.abort();
  speaker.stop();
  void listener.pause();
  conversation.reset();
  operator.clearTranscript();
  state.set("SLEEPING");
}

// Voice audition: V cycles through the shortlist. Put the winner in TTS_VOICE in .env.
function nextVoice() {
  void speaker.resume();
  const next = AUDITION_VOICES[(AUDITION_VOICES.indexOf(speaker.voice()) + 1) % AUDITION_VOICES.length];
  speaker.setVoice(next);
  operator.set("voice", next);
  if (state.get() !== "SLEEPING") return;
  speaker.say("Speak, and the glass shall answer! I am the Magic Mirror on the wall. Who is the fairest of them all?");
  void speaker.finish();
}
