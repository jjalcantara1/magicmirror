// The mirror's scripted lines, and the tone of voice for each face. Shared by the page, which says
// them, and the server, which records them with Groq's voice at start-up so they play at once.
import type { Effect, Mood } from "./face/face.ts";

// Every visit opens with the classic line, word for word, so it needs no AI and starts at once.
// No "..." in it: an ellipsis after repeated words can set the Groq voice looping.
export const OPENING = "Mirror, mirror, on the wall, who is the fairest of them all? Step closer, and let the magic glass decide!";
// Lines for the operator's keys: C grants a treat, H wishes Happy Halloween. Scripted, so they start
// at once and need no AI; the note tells the AI what happened.
export const CUES = {
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
// Said when hearing fails, and when the AI does not answer.
export const FOGGY = "Oops, my glass is foggy! Say that again?";
export const SMUDGE = "Oops! A smudge on my glass! Can you ask me again?";
// Said when the child has gone quiet for config.wake.idleSleepS: goodbye, and how to wake it again.
// No "..." in them: an ellipsis can set the Groq voice looping.
export const GOODBYES = [
  "Farewell, brave visitor! Say hello mirror to wake me again!",
  "Time for my beauty sleep! Say hello mirror to wake me!",
  "Happy Halloween! Say hello mirror, and I will wake up again!",
];
// Each face has a tone of voice: Groq's Orpheus takes a short direction in brackets, like
// "[cheerful] Hello!" (docs, checked 2026-10: "[cheerful]", "[whisper]", "[excited]"; each direction
// makes it more acted, so a reply gets one only where its tone changes, see tts.worker.ts).
// Fun, cheeky and calm, so small children can follow: playful for anything teasing or funny,
// cheerful for warm moments. Dramatic and whisper sounded odd, and excited rushes the words.
export const MOOD_VOICE: Record<Mood, string> = {
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

// The voices are English, so spell the two short Tagalog words they get wrong as they sound:
// "ng" is said "nang" and "mga" "manga". Neither is an English word. A contraction like "ano'ng"
// (ano ang) is left alone.
export const sayable = (text: string) => text.replace(/(?<![\w'’])ng\b/gi, "nang").replace(/(?<![\w'’])mga\b/gi, "manga");

/**
 * Every scripted line exactly as the voice worker sends it to Groq: its tone (when acting is on)
 * and the line, like "[cheerful] Mirror, mirror, on the wall...". The opening comes first.
 */
export function scriptedTakes(acting: boolean): string[] {
  const take = (text: string, mood: Mood) => (acting ? `[${MOOD_VOICE[mood]}] ` : "") + sayable(text);
  return [
    take(OPENING, "grand"),
    ...Object.values(CUES).flatMap((cue) => cue.lines.map((line) => take(line, cue.mood))),
    ...GOODBYES.map((line) => take(line, "happy")),
    take(FOGGY, "surprised"),
    take(SMUDGE, "surprised"),
  ];
}
