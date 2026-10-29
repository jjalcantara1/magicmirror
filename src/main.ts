import "./style.css";
import { utils } from "@ricky0123/vad-web";
import { createChunker, createConversation } from "./conversation.ts";
import { EFFECTS, MOODS, type Effect, type Mood } from "./face/face.ts";
import { createMaskFace } from "./face/maskFace.ts";
import { CUES, FOGGY, GOODBYES, MOOD_VOICE, OPENING, SMUDGE } from "./lines.ts";
import { createListener, type VadConfig } from "./listen.ts";
import { createOperator } from "./operator.ts";
import { createSpeaker, type TtsConfig, type VoiceFx } from "./speak.ts";
import { createState } from "./state.ts";

type Config = { tts: TtsConfig; voiceFx: VoiceFx; vad: VadConfig; wake: { words: boolean; hint: boolean; idleSleepS: number } };
type ChatEvent = { delta: string } | { done: true; provider: string; firstTokenMs: number } | { error: string };

// A stage note before it, so the chat history still starts with the visitor.
const ARRIVAL = "(A new visitor has just stepped up to the mirror.)";
const lastCue: Partial<Record<keyof typeof CUES, string>> = {};
const FUN_TONE = "playful"; // until a reply's first mood tag
// The magic words, in English and in Tagalog ("Salamin, salamin sa dingding"; mahiwagang salamin is a
// magic mirror). Speech-to-text writes them in many ways, so match the core of them.
const SUMMONS = /\bmirror\W+mirror\b|\bmagic mirror\b|\bmirror on the wall\b|\bsalamin\W+salamin\b|\bsalamin sa dingding\b|\bmahiwagang salamin\b/i;
// What wakes the sleeping mirror: "hello mirror" and friends, and the magic words above. Whisper
// writes "mirror" in many ways (mira, mirra, meera); "salamin" is Tagalog for mirror.
const WAKE =
  /\b(?:hello|hellow|helo|hallo|halo|hullo|hi|hiya|hey|wake up|good (?:morning|evening|night)|kumusta|musta)\b[\s,!.]*(?:there[\s,!.]*)?(?:magic(?:al)?\s+|mahiwagang\s+)?(?:mirror|mirrors|mira|mirra|meera|mera|salamin)\b/i;
const WAKE_MAX_S = 5; // a wake call is short; longer talk while asleep is not sent to be heard
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
// Children stop to think mid-sentence ("I'm a... um..."). When the words so far sound unfinished, the
// mirror listens on for THINK_MS more (longer while they are still talking) and answers both parts
// together. A question mark or "!" counts as finished. Finished-sounding words are answered after
// the speech detector's short silence (VAD_REDEMPTION_MS), so the mirror answers quickly.
const UNFINISHED =
  /(?:\.\.\.|…|-|\b(?:um+|uh+|erm?|hmm+|and|or|but|so|because|the|a|an|my|your|is|are|was|i'm|im|i|to|of|with|like|ano|yung|kasi|tapos|at|ang|ng|sa|si|mga))[\s.,]*$/i;
const THINK_MS = 2000;
const MAX_HOLDS = 3;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Declared before anything that awaits, so the hotkeys work while the mirror boots.
let visit = 0; // bumped by every wake and reset, so stale async work can tell it is stale
let inflight: AbortController | undefined;
let latencyStart = 0;
let latencyFrom = "";
let latencyMark = 0;
let latencySteps: string[] = []; // how long each step to the reply took, for the D panel
let held = { visit: -1, text: "", holds: 0 }; // an unfinished sentence, waiting for the rest
let holdUntil = 0;
let transcribing = false;
let hearingWake = false; // a sleeping mirror is checking whether it heard "hello mirror"
let lastActivity = performance.now(); // the last time a child spoke near the mirror, or it spoke

const config = (await (await fetch("/api/config")).json()) as Config;
// After the mirror speaks, the mic opens once the hall echo has mostly died away, so the mirror does
// not hear itself, but soon enough to catch a child who answers its question straight away.
const ECHO_TAIL_MS = config.vad.listenAfterMs;
const face = createMaskFace(document.querySelector("#mirror")!);
const conversation = createConversation();
const operator = createOperator({ wake: () => void wake(), reset, newVisitor, nextVoice, candy: () => void cue("candy"), halloween: () => void cue("halloween") });
const speaker = createSpeaker(config.tts, config.voiceFx, {
  onLevel: (level, shape) => face.setMouth(level, shape),
  onAudioStart,
  onPiece: (genMs, audioSec, by) => operator.set("speech", `${by}: ${Math.round(genMs)} ms to make ${audioSec.toFixed(1)} s of audio`),
});
const hint = document.querySelector<HTMLDivElement>("#hint")!;
let booted = false;
// "Say Hello, Mirror!" glows while the mirror sleeps, once it has loaded.
const showHint = () => (hint.hidden = !(booted && state.get() === "SLEEPING" && config.wake.words && config.wake.hint));
const state = createState((s, faceState) => {
  face.setState(faceState);
  operator.set("state", s);
  lastActivity = performance.now();
  showHint();
  if (s === "THINKING") speaker.chime();
});
face.setState("asleep");
operator.set("state", "SLEEPING");
operator.set("voice", config.tts.voice);
operator.set("tts", "loading…");
void speaker.ready.then((engine) => {
  operator.set("tts", engine);
  document.querySelector("#boot")?.remove();
  booted = true;
  showHint();
});

const listener = await createListener(speaker.audioContext, config.vad, {
  onUtterance: (audio) => void onUtterance(audio),
  onHeard: (aboveDb, near) => {
    if (aboveDb === undefined) return operator.set("heard", "measuring the room…");
    const level = `${aboveDb.toFixed(0)} dB above the room (${config.vad.nearDb > 0 ? `needs ${config.vad.nearDb}` : "filter off"})`;
    operator.set("heard", near ? level : `IGNORED, too far away or too quiet: ${level}`);
    if (near) lastActivity = performance.now();
  },
  onFrame: (p, level) => {
    // While a sentence is held, the child talking again keeps the mirror waiting.
    if (held.text && p >= config.vad.positive) holdUntil = performance.now() + THINK_MS;
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
// Browsers start sound (and so the mic's speech detector) only after a key press or click, unless
// Chrome is started with start-mirror.bat. Any key or click lets it start.
const unlock = () => void speaker.resume();
addEventListener("keydown", unlock);
addEventListener("pointerdown", unlock);
if (speaker.audioContext.state !== "running") {
  operator.set("sound", "waiting for a key press or click (start-mirror.bat skips this)");
  speaker.audioContext.addEventListener("statechange", () => {
    if (speaker.audioContext.state === "running") operator.set("sound", "on");
  });
}
void listenForWake(visit, 0);
// Keep the screen on all night. The browser lets go of it when the page is hidden, so ask again
// when it shows. (Windows may still sleep the laptop on battery: see PARTY.md.)
async function keepScreenOn() {
  try {
    await navigator.wakeLock?.request("screen");
    operator.set("screen", "kept on");
  } catch (e) {
    operator.set("screen", `may dim: ${(e as Error).message}`);
  }
}
void keepScreenOn();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void keepScreenOn();
});
// A child who walks away: after config.wake.idleSleepS of quiet, goodbye and sleep.
setInterval(() => {
  const idleMs = config.wake.idleSleepS * 1000;
  if (idleMs > 0 && state.get() === "LISTENING" && !transcribing && !held.text && performance.now() - lastActivity > idleMs) void dozeOff();
}, 1000);

function startLatency(from: string, at = performance.now()) {
  latencyStart = latencyMark = at;
  latencyFrom = from;
  latencySteps = [];
}

// Notes how long the step that just ended took, e.g. "hearing 620".
function step(name: string) {
  if (!latencyStart) return;
  const now = performance.now();
  latencySteps.push(`${name} ${Math.round(now - latencyMark)}`);
  latencyMark = now;
}

function onAudioStart() {
  if (!latencyStart) return;
  step("voice");
  operator.set("reply", `voice started ${Math.round(performance.now() - latencyStart)} ms after ${latencyFrom} (${latencySteps.join(" · ")} ms)`);
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

async function listen(v: number, tailMs = ECHO_TAIL_MS) {
  state.set("LISTENING");
  await delay(tailMs);
  if (v !== visit || state.get() !== "LISTENING") return;
  await listener.start();
}

async function respond(v: number) {
  state.set("THINKING");
  inflight = new AbortController();
  let speaking = false;
  let tone = FUN_TONE; // the voice follows the latest mood tag, so a reply can go from grand to cheeky
  let firstWord = true;
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
        if (firstWord) {
          firstWord = false;
          step("AI");
        }
        if (!chunker.push(event.delta)) {
          inflight.abort();
          break;
        }
      } else if ("error" in event) throw new Error(event.error);
      else operator.set("llm", `${event.provider} · first word ${event.firstTokenMs} ms`);
    }
    chunker.end();
    // Nothing sayable, e.g. a reply in another language: ask again rather than stand silent.
    if (!speaking && v === visit) throw new Error("the reply had no English words to say");
  } catch (e) {
    if (v !== visit) return;
    console.warn("[chat]", e);
    operator.set("llm", `failed: ${(e as Error).message}`);
    if (!speaking) {
      state.set("SPEAKING");
      speaker.say(SMUDGE, MOOD_VOICE.surprised, () => face.setMood("surprised"));
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

// Writes down what was said: the text, and the line for the D panel. Throws when hearing fails.
async function hear(audio: Float32Array): Promise<{ text: string; line: string }> {
  const res = await fetch("/api/stt", {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: utils.encodeWAV(audio, 1, 16000, 1, 16),
    signal: AbortSignal.timeout(10_000), // the server gives up after 8 s; this is in case it hangs
  });
  const body = (await res.json()) as { text?: string; ms?: number; provider?: string; error?: string };
  if (!res.ok) throw new Error(body.error);
  return { text: body.text ?? "", line: `${body.provider} · ${body.ms} ms` };
}

// While asleep the mirror listens only for "hello mirror", and answers nothing else.
async function hearWake(audio: Float32Array) {
  if (!config.wake.words || hearingWake) return;
  if (audio.length > 16000 * WAKE_MAX_S) return operator.set("stt", "asleep: long talk, not a wake call");
  const v = visit;
  hearingWake = true;
  let text = "";
  try {
    text = (await hear(audio)).text;
  } catch (e) {
    operator.set("stt", `asleep: hearing failed (${(e as Error).message})`);
  }
  hearingWake = false;
  if (v !== visit || state.get() !== "SLEEPING" || !text) return;
  if (WAKE.test(text) || SUMMONS.test(text)) {
    operator.set("stt", `woke on "${text}"`);
    void wake();
  } else operator.set("stt", `asleep: heard "${text}" (not the wake words)`);
}

async function onUtterance(audio: Float32Array) {
  if (state.get() === "SLEEPING") return void hearWake(audio);
  if (state.get() !== "LISTENING") return;
  const v = visit;
  void listener.pause();
  // The VAD fires after redemptionMs of silence; the child stopped talking that long ago.
  startLatency("the child stopped", performance.now() - config.vad.redemptionMs);
  step("silence");
  // The face keeps listening while the words are written down: they may turn out unfinished.
  transcribing = true;
  let text = "";
  let sttLine = "";
  let failed = false;
  try {
    ({ text, line: sttLine } = await hear(audio));
    step("hearing");
    operator.set("stt", sttLine);
  } catch (e) {
    console.warn("[stt]", e);
    operator.set("stt", `failed: ${(e as Error).message}`);
    failed = true;
  }
  transcribing = false;
  if (v !== visit) return;
  const before = held.visit === v ? held.text : "";
  const holds = held.visit === v ? held.holds : 0;
  held = { visit: v, text: "", holds: 0 };
  if (!text) {
    // Noise, or nothing understood: keep listening without a word, or answer what was said before.
    // When hearing failed, the child did say something: ask them to say it again.
    latencyStart = 0;
    if (before) await answer(v, before);
    else if (failed) await askAgain(v);
    else await listen(v);
    return;
  }
  text = before ? `${before} ${text}` : text;
  if (UNFINISHED.test(text) && holds < MAX_HOLDS) {
    held = { visit: v, text, holds: holds + 1 };
    holdUntil = performance.now() + THINK_MS;
    operator.set("stt", `${sttLine} · sounds unfinished, waiting for more`);
    void finishHeld(v);
    await listen(v, 0); // no echo to wait for: the mirror has not spoken
    return;
  }
  await answer(v, text);
}

// Answers a held sentence once the child has been quiet for THINK_MS.
async function finishHeld(v: number) {
  while (performance.now() < holdUntil) {
    await delay(200);
    if (v !== visit || held.visit !== v || !held.text) return;
  }
  // Already answered (a second pause starts a second wait), or more words are being written down
  // right now, which onUtterance joins on.
  if (v !== visit || held.visit !== v || !held.text || transcribing || state.get() !== "LISTENING") return;
  const text = held.text;
  held = { visit: v, text: "", holds: 0 };
  void listener.pause();
  startLatency("the wait for more ended");
  await answer(v, text);
}

// Hearing failed (Groq did not answer in time): say so, rather than leave the child in silence.
async function askAgain(v: number) {
  state.set("SPEAKING");
  speaker.say(FOGGY, MOOD_VOICE.surprised, () => face.setMood("surprised"));
  await speaker.finish();
  if (v !== visit) return;
  await listen(v);
}

async function answer(v: number, text: string) {
  state.set("THINKING");
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
  void listener.pause(); // it was listening for "hello mirror"
  conversation.reset();
  operator.clearTranscript();
  state.set("WAKING");
  await delay(1200); // let the mask fade in
  if (v !== visit) return;
  startLatency("the opening started");
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

// C and H: the mirror says the line at once, cutting off whatever it was saying, and then listens
// again. From sleep it wakes up first.
async function cue(kind: keyof typeof CUES) {
  void speaker.resume();
  const { mood, effect, note, lines } = CUES[kind];
  const choices = lines.filter((line) => line !== lastCue[kind]); // never the same line twice running
  const text = choices[Math.floor(Math.random() * choices.length)];
  lastCue[kind] = text;
  const asleep = state.get() === "SLEEPING";
  const v = ++visit;
  inflight?.abort();
  speaker.stop();
  void listener.pause();
  if (asleep) {
    conversation.reset();
    operator.clearTranscript();
    state.set("WAKING");
    await delay(1200); // let the mask fade in
    if (v !== visit) return;
  }
  conversation.add({ role: "user", content: note });
  conversation.add({ role: "assistant", content: `[[effect:${effect}]] [[mood:${mood}]] ${text}` });
  operator.transcript(`mirror: ${text}`);
  state.set("SPEAKING");
  speaker.say(text, MOOD_VOICE[mood], () => {
    face.setMood(mood);
    face.effect(effect);
  });
  await speaker.finish();
  if (v !== visit) return;
  await listen(v);
}

// N: forget this visitor and start fresh for the next one, with the opening line, in one press
// (R then G). The face dips into the glass and comes straight back.
function newVisitor() {
  reset();
  void wake();
}

function reset() {
  visit++;
  inflight?.abort();
  speaker.stop();
  void listener.pause();
  conversation.reset();
  operator.clearTranscript();
  state.set("SLEEPING");
  void listenForWake(visit);
}

// Asleep, the mic listens for "hello mirror", once the mirror's own voice has died away.
async function listenForWake(v: number, tailMs = ECHO_TAIL_MS) {
  if (!config.wake.words) return;
  await delay(tailMs);
  if (v !== visit || state.get() !== "SLEEPING") return;
  await listener.start();
}

// The child has gone: a goodbye that also tells the next child how to wake the mirror, then sleep.
// Sleeping wipes the chat, so the next child starts fresh.
async function dozeOff() {
  const v = ++visit;
  void listener.pause();
  const text = GOODBYES[Math.floor(Math.random() * GOODBYES.length)];
  operator.transcript(`mirror: ${text} (nobody spoke for ${config.wake.idleSleepS} s)`);
  state.set("GOODBYE");
  speaker.say(text, MOOD_VOICE.happy, () => face.setMood("happy"));
  await speaker.finish();
  if (v !== visit) return;
  reset();
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
  // Not listening for "hello mirror" meanwhile: the opening's magic words would wake it.
  const v = visit;
  void listener.pause();
  speaker.say(OPENING, MOOD_VOICE.grand);
  void speaker.finish().then(() => listenForWake(v));
}
