import "./style.css";
import { utils } from "@ricky0123/vad-web";
import { createChunker, createConversation } from "./conversation.ts";
import { EFFECTS, MOODS, type Effect, type Mood } from "./face/face.ts";
import { createMaskFace } from "./face/maskFace.ts";
import { createListener, type VadConfig } from "./listen.ts";
import { createLocalEars } from "./localEars.ts";
import { createOperator } from "./operator.ts";
import { createSpeaker, type TtsConfig, type VoiceFx } from "./speak.ts";
import { createState } from "./state.ts";

type Config = { tts: TtsConfig; voiceFx: VoiceFx; vad: VadConfig; stt: { engine: "local" | "groq"; model: string; device: string } };
type ChatEvent = { delta: string } | { done: true; provider: string; firstTokenMs: number } | { error: string };

// Every visit opens with the classic line, word for word, so it needs no AI and starts at once.
// No "..." in it: an ellipsis after repeated words can set the Groq voice looping.
const OPENING = "Mirror, mirror, on the wall, who is the fairest of them all? Step closer, and let the magic glass decide!";
// A stage note before it, so the chat history still starts with the visitor.
const ARRIVAL = "(A new visitor has just stepped up to the mirror.)";
// Lines for the operator's keys: C grants a treat, H wishes Happy Halloween. Scripted, so they start
// at once and need no AI; the note tells the AI what happened.
const CUES = {
  candy: {
    mood: "excited",
    effect: "sparkle",
    note: "(The mirror grants the visitor a treat.)",
    lines: [
      "The glass has spoken: take your treat!",
      "Ka-BOOM! A treat for the bravest visitor of all!",
      "Abraca-PUMPKIN! Your treat is waiting. Go on, take it!",
      "Hee hee! You have earned a treat. Take it, quick!",
      "By my golden frame, a treat for you!",
    ],
  },
  halloween: {
    mood: "happy",
    effect: "glow",
    note: "(The visitor is leaving.)",
    lines: [
      "Happy Halloween! May your night be full of treats and giggles!",
      "Happy Halloween, brave visitor! The glass will miss you!",
      "Happy Halloween! Come back next year in your best costume!",
      "Goodbye, and happy Halloween! Mind my shiny glass on your way out!",
      "Happy Halloween! The Queen says hi... and she is a little jealous!",
    ],
  },
} satisfies Record<string, { mood: Mood; effect: Effect; note: string; lines: string[] }>;
const lastCue: Partial<Record<keyof typeof CUES, string>> = {};
// Each face has a tone of voice: Groq's Orpheus takes a short direction in brackets, like
// "[cheerful] Hello!" (docs, checked 2026-10: "[cheerful]", "[whisper]", "[excited]").
// Fun, cheeky and calm, so small children can follow: playful for anything teasing or funny,
// cheerful for warm moments. Dramatic and whisper sounded odd, and excited rushes the words.
const MOOD_VOICE: Record<Mood, string> = {
  grand: "cheerful",
  happy: "cheerful",
  laugh: "playful",
  surprised: "playful",
  sly: "playful",
  wink: "playful",
  spooky: "playful",
  gentle: "cheerful",
  excited: "cheerful",
  love: "cheerful",
};
const FUN_TONE = "playful"; // until a reply's first mood tag
// The magic words, in English and in Tagalog ("Salamin, salamin sa dingding"; mahiwagang salamin is a
// magic mirror). Speech-to-text writes them in many ways, so match the core of them.
const SUMMONS = /\bmirror\W+mirror\b|\bmagic mirror\b|\bmirror on the wall\b|\bsalamin\W+salamin\b|\bsalamin sa dingding\b|\bmahiwagang salamin\b/i;
// Groq's Orpheus male voices (checked 2026-10). The server picks the deepest; press V to hear each.
const GROQ_VOICES = ["troy", "daniel", "austin"];
// Kokoro's male voices, best rated first (its own grades: Fenrir and Michael C+, George C).
const KOKORO_VOICES = ["am_fenrir", "am_michael", "bm_george", "am_onyx", "am_santa", "bm_lewis"];
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
const ECHO_TAIL_MS = 900; // let the hall echo die away before the mic listens again, so the mirror never hears itself
// Children stop to think mid-sentence ("I'm a... um..."). When the words so far sound unfinished, the
// mirror listens on for THINK_MS more (longer while they are still talking) and answers both parts
// together. A question mark or "!" counts as finished.
const UNFINISHED =
  /(?:\.\.\.|…|-|\b(?:um+|uh+|erm?|hmm+|and|or|but|so|because|the|a|an|my|your|is|are|was|i'm|im|i|to|of|with|like|ano|yung|kasi|tapos|at|ang|ng|sa|si|mga))[\s.,]*$/i;
const THINK_MS = 3000;
const MAX_HOLDS = 3;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Declared before anything that awaits, so the hotkeys work while the mirror boots.
let visit = 0; // bumped by every wake and reset, so stale async work can tell it is stale
let inflight: AbortController | undefined;
let latencyStart = 0;
let latencyFrom = "";
let held = { visit: -1, text: "", holds: 0 }; // an unfinished sentence, waiting for the rest
let holdUntil = 0;
let transcribing = false;

const config = (await (await fetch("/api/config")).json()) as Config;
const face = createMaskFace(document.querySelector("#mirror")!);
const conversation = createConversation();
const operator = createOperator({ wake: () => void wake(), reset, newVisitor, nextVoice, candy: () => void cue("candy"), halloween: () => void cue("halloween") });
const speaker = createSpeaker(config.tts, config.voiceFx, {
  onLevel: (level, shape) => face.setMouth(level, shape),
  onAudioStart,
  onPiece: (genMs, audioSec, by) => operator.set("speech", `${by}: ${Math.round(genMs)} ms to make ${audioSec.toFixed(1)} s of audio`),
  onStatus: (text) => loading("voice", text),
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
// The start screen stays until the voice (and the local ears) are ready, and shows the first
// download's progress: the local models are a few hundred MB, downloaded once.
const loadingNow = { voice: "", ears: "" };
function loading(part: "voice" | "ears", text: string) {
  loadingNow[part] = text;
  operator.set(part === "voice" ? "tts" : "stt", text);
  const boot = document.querySelector<HTMLElement>("#boot");
  if (boot) boot.textContent = ["the mirror is gathering its magic…", loadingNow.voice, loadingNow.ears].filter(Boolean).join("\n");
}
const localEars = config.stt.engine === "local" ? createLocalEars(config.stt, (text) => loading("ears", text)) : undefined;
let earsFailed = false; // then Groq's hearing is used, when there is a Groq key
const earsReady = localEars?.ready.then(
  (engine) => (operator.set("stt", `local ${engine}`), (loadingNow.ears = "")),
  (e: Error) => {
    earsFailed = true;
    loading("ears", `the local ears did not load (${e.message.slice(0, 80)}); using Groq's if there is a key`);
  },
);
void Promise.all([speaker.ready.then((engine) => (operator.set("tts", engine), (loadingNow.voice = ""))), earsReady]).then(() =>
  document.querySelector("#boot")?.remove(),
);

const listener = await createListener(speaker.audioContext, config.vad, {
  onUtterance: (audio) => void onUtterance(audio),
  onHeard: (aboveDb, near) => {
    if (aboveDb === undefined) return operator.set("heard", "measuring the room…");
    const level = `${aboveDb.toFixed(0)} dB above the room (${config.vad.nearDb > 0 ? `needs ${config.vad.nearDb}` : "filter off"})`;
    operator.set("heard", near ? level : `IGNORED, too far away or too quiet: ${level}`);
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
      speaker.say("Oops! A smudge on my glass! Can you ask me again?", MOOD_VOICE.surprised, () => face.setMood("surprised"));
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
  // The face keeps listening while the words are written down: they may turn out unfinished.
  transcribing = true;
  let text = "";
  let sttLine = "";
  try {
    if (localEars && !earsFailed) {
      // Heard on this computer: the audio never leaves it.
      const heard = await localEars.hear(audio);
      if (heard.error) throw new Error(heard.error);
      text = heard.text;
      sttLine = `local ${config.stt.model.split("/").pop()} · ${Math.round(heard.ms)} ms`;
    } else {
      const res = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: utils.encodeWAV(audio, 1, 16000, 1, 16) });
      const body = (await res.json()) as { text?: string; ms?: number; provider?: string; error?: string };
      if (!res.ok) throw new Error(body.error);
      text = body.text ?? "";
      sttLine = `${body.provider} · ${body.ms} ms`;
    }
    operator.set("stt", sttLine);
  } catch (e) {
    console.warn("[stt]", e);
    operator.set("stt", `failed: ${(e as Error).message}`);
  }
  transcribing = false;
  if (v !== visit) return;
  const before = held.visit === v ? held.text : "";
  const holds = held.visit === v ? held.holds : 0;
  held = { visit: v, text: "", holds: 0 };
  if (!text) {
    // Noise, or nothing understood: keep listening without a word, or answer what was said before.
    latencyStart = 0;
    if (before) await answer(v, before);
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
  latencyStart = performance.now();
  latencyFrom = "the wait for more ended";
  await answer(v, text);
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
}

// Voice audition: V cycles through the shortlist of the main voice. Put the winner in .env
// (GROQ_TTS_VOICE for Groq, TTS_VOICE for Piper).
function nextVoice() {
  void speaker.resume();
  const voices = config.tts.engine === "groq" ? GROQ_VOICES : config.tts.engine === "kokoro" ? KOKORO_VOICES : PIPER_VOICES;
  const next = voices[(voices.indexOf(speaker.voice()) + 1) % voices.length];
  speaker.setVoice(next);
  operator.set("voice", next);
  if (state.get() !== "SLEEPING") return;
  speaker.say(OPENING, MOOD_VOICE.grand);
  void speaker.finish();
}
