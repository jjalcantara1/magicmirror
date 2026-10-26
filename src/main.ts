import "./style.css";
import { utils } from "@ricky0123/vad-web";
import { createChunker, createConversation } from "./conversation.ts";
import { EFFECTS, MOODS, type Effect, type Mood } from "./face/face.ts";
import { createMaskFace } from "./face/maskFace.ts";
import { createListener, type VadConfig } from "./listen.ts";
import { createOperator } from "./operator.ts";
import { createSpeaker, type TtsConfig, type VoiceFx } from "./speak.ts";
import { createState } from "./state.ts";

type Config = { tts: TtsConfig; voiceFx: VoiceFx; listenMode: string; vad: VadConfig };
type ChatEvent = { delta: string } | { done: true; provider: string; firstTokenMs: number } | { error: string };

// Every visit opens with the classic line, word for word, so it needs no AI and starts at once.
const OPENING = "Mirror, mirror, on the wall... who is the fairest of them all? Step closer, and let the magic glass decide!";
// A stage note before it, so the chat history still starts with the visitor.
const ARRIVAL = "(A new visitor has just stepped up to the mirror.)";
// Each face has a tone of voice: Groq's Orpheus takes a short direction in brackets, like
// "[cheerful] Hello!" (docs, checked 2026-10: "[cheerful]", "[whisper]", "[excited]").
const MOOD_VOICE: Record<Mood, string> = {
  grand: "dramatic",
  happy: "cheerful",
  laugh: "laughing",
  surprised: "amazed",
  sly: "mischievous",
  wink: "playful",
  spooky: "whisper",
  gentle: "softly",
  excited: "excited",
  love: "warmly",
};
// The magic words, in English and in Tagalog ("Salamin, salamin sa dingding"; mahiwagang salamin is a
// magic mirror). Speech-to-text writes them in many ways, so match the core of them.
const SUMMONS = /\bmirror\W+mirror\b|\bmagic mirror\b|\bmirror on the wall\b|\bsalamin\W+salamin\b|\bsalamin sa dingding\b|\bmahiwagang salamin\b/i;
// Groq's Orpheus male voices (checked 2026-10). The server picks the deepest; press V to hear each.
const GROQ_VOICES = ["troy", "daniel", "austin"];
// Piper "medium" voices: 3-4x faster than real time on the party laptop; "high" ones are 2.6x
// slower (measured 2026-10-22). The first press of V on a new voice downloads it (~60 MB) once.
const PIPER_VOICES = [
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
const speaker = createSpeaker(config.tts, config.voiceFx, {
  onLevel: (level, shape) => face.setMouth(level, shape),
  onAudioStart,
  onPiece: (genMs, audioSec, by) => operator.set("speech", `${by}: ${Math.round(genMs)} ms to make ${audioSec.toFixed(1)} s of audio`),
});
const state = createState((s, faceState) => {
  face.setState(faceState);
  operator.set("state", s);
  if (s === "THINKING") speaker.chime();
});
face.setState("asleep");
operator.set("state", "SLEEPING");
operator.set("voice", config.tts.voice);
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
  let tone = ""; // the voice follows the latest mood tag, so a reply can go from grand to cheeky
  const chunker = createChunker((chunk) => {
    const moods = chunk.moods.filter((m): m is Mood => (MOODS as readonly string[]).includes(m));
    if (moods.length) tone = MOOD_VOICE[moods[moods.length - 1]];
    if (chunk.alert) raiseAlert();
    // The face changes when these words start to play, not when the text arrives a second earlier.
    const show = () => {
      for (const name of chunk.effects) if ((EFFECTS as readonly string[]).includes(name)) face.effect(name as Effect);
      moods.forEach((m) => face.setMood(m));
    };
    if (!chunk.text) return show();
    if (!speaking) {
      speaking = true;
      state.set("SPEAKING");
    }
    speaker.say(chunk.text, tone, show);
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
      speaker.say("Bother! A smudge upon my glass! Ask me once more!", MOOD_VOICE.surprised, () => face.setMood("surprised"));
    }
  }
  if (v !== visit) return;
  const reply = chunker.spoken();
  if (reply) {
    // The history keeps the mood tags, so the model keeps using them as the visit goes on.
    conversation.add({ role: "assistant", content: chunker.tagged() });
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
    const body = (await res.json()) as { text?: string; ms?: number; provider?: string; error?: string };
    if (!res.ok) throw new Error(body.error);
    text = body.text ?? "";
    operator.set("stt", `${body.provider} · ${body.ms} ms`);
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
  latencyFrom = "the opening started";
  conversation.add({ role: "user", content: ARRIVAL });
  conversation.add({ role: "assistant", content: `[[effect:thunder]] [[mood:grand]] ${OPENING}` });
  operator.transcript(`mirror: ${OPENING}`);
  state.set("SPEAKING");
  face.setMood("grand");
  face.effect("thunder");
  speaker.say(OPENING, MOOD_VOICE.grand);
  await speaker.finish();
  if (v !== visit) return;
  await listen(v);
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

// Voice audition: V cycles through the shortlist of the main voice. Put the winner in .env
// (GROQ_TTS_VOICE for Groq, TTS_VOICE for Piper).
function nextVoice() {
  void speaker.resume();
  const voices = config.tts.engine === "groq" ? GROQ_VOICES : PIPER_VOICES;
  const next = voices[(voices.indexOf(speaker.voice()) + 1) % voices.length];
  speaker.setVoice(next);
  operator.set("voice", next);
  if (state.get() !== "SLEEPING") return;
  speaker.say(OPENING, MOOD_VOICE.grand);
  void speaker.finish();
}
