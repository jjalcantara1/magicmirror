export type Turn = { role: "user" | "assistant"; content: string };
export type Chunk = { text: string; effects: string[]; moods: string[]; alert: boolean };

// Every reply resends the history, so keep it short: 8 turns is the last 4 exchanges, plenty for a
// child's visit, and keeps each request well inside Groq's tokens-per-minute limit.
const MAX_TURNS = 8;
const MAX_WORDS = 20; // replies are short and sweet (the prompt asks for 15); stop at the last sentence that fits

// One visitor group's history. It lives only in memory and reset() wipes it.
export function createConversation() {
  let turns: Turn[] = [];
  return {
    turns: () => turns.slice(-MAX_TURNS),
    add(turn: Turn) {
      turns.push(turn);
    },
    reset() {
      turns = [];
    },
  };
}

const TAG = /\[\[\s*(?:effect\s*:\s*(\w+)|mood\s*:\s*(\w+)|(alert))\s*\]\]/gi;
// Local models invent tag shapes like "[Fairytale:effect:sparkle]", so drop any bracketed text.
const ANY_BRACKET = /\[\[?[^\]]*\]?\]/g;
const STAGE_DIRECTION = /\*[^*]*\*/g;
const EMOJI = /\p{Extended_Pictographic}/gu;
// The mirror talks in English. Some models slip into another script mid-reply (Qwen into Chinese),
// which the English voice cannot say, so only Latin letters, digits and punctuation are kept.
const OTHER_SCRIPT = /(?:[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]|[\u3000-\u303f\uff00-\uffef])+/gu;
// Punctuation left standing alone once other words are gone, like the "!" of "Привет! Hi".
const ORPHAN_MARKS = /(^|\s)[!?.,;:]+(?=\s|$)/g;

export function parseTags(raw: string): Chunk {
  const effects: string[] = [];
  const moods: string[] = [];
  let alert = false;
  for (const m of raw.matchAll(TAG)) {
    if (m[1]) effects.push(m[1].toLowerCase());
    if (m[2]) moods.push(m[2].toLowerCase());
    if (m[3]) alert = true;
  }
  const text = raw.replace(ANY_BRACKET, " ").replace(STAGE_DIRECTION, " ").replace(EMOJI, "").replace(OTHER_SCRIPT, " ").replace(ORPHAN_MARKS, "$1").replace(/\s+/g, " ").trim();
  return { text, effects, moods, alert };
}

const countWords = (s: string) => s.match(/\S+/g)?.length ?? 0;

// Splits a streamed reply into pieces to speak. Pieces end at sentence ends, so each one is spoken
// with natural intonation (a piece cut at a comma sounds choppy and is harder for children to follow).
// Only a long first sentence breaks at a comma, after 8 words, so the voice still starts soon.
export function createChunker(onChunk: (chunk: Chunk) => void) {
  let buffer = "";
  let spoken = "";
  let tagged = ""; // spoken, with the effect and mood tags in their places
  let words = 0;
  let stopped = false;

  function boundary(): number {
    for (const m of buffer.matchAll(/[,;!?.…](?=\s)/g)) {
      const end = m.index + 1;
      const n = countWords(parseTags(buffer.slice(0, end)).text);
      if (/[!?.…]/.test(m[0]) ? words > 0 || n >= 2 : words === 0 && n >= 8) return end;
    }
    return -1;
  }

  function emit(raw: string): boolean {
    const chunk = parseTags(raw);
    const n = countWords(chunk.text);
    if (words > 0 && words + n > MAX_WORDS) {
      stopped = true;
      return false;
    }
    if (n > MAX_WORDS) chunk.text = chunk.text.split(" ").slice(0, MAX_WORDS).join(" ");
    words += countWords(chunk.text);
    if (chunk.text) spoken += (spoken ? " " : "") + chunk.text;
    const tags = [...chunk.effects.map((e) => `[[effect:${e}]]`), ...chunk.moods.map((m) => `[[mood:${m}]]`)];
    const part = [...tags, chunk.text].filter(Boolean).join(" ");
    if (part) tagged += (tagged ? " " : "") + part;
    onChunk(chunk);
    return true;
  }

  return {
    /** Returns false when the reply is long enough and the caller should stop the stream. */
    push(delta: string): boolean {
      if (stopped) return false;
      buffer += delta;
      for (let end = boundary(); end >= 0; end = boundary()) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end);
        if (!emit(raw)) return false;
      }
      return true;
    },
    end() {
      if (!stopped && buffer.trim()) emit(buffer);
      buffer = "";
    },
    spoken: () => spoken,
    tagged: () => tagged,
  };
}
