// Groq API keys. GROQ_API_KEY may list several, separated by commas; GROQ_API_KEY_2 and
// GROQ_API_KEY_3 (and so on) work too. Groq's limits belong to an account, so only keys from
// different accounts add capacity: three keys from one account share one limit.
//
// Each use (a chat model, a speech-to-text model, the voice) takes the keys in turn, so the load is
// shared. A key that Groq refuses with "too many requests" rests until Groq says it may try again,
// and the other keys carry on meanwhile. Rests are per use, because Groq limits each model separately.

function readKeys(): string[] {
  const listed = (process.env.GROQ_API_KEY ?? "").split(",");
  const numbered = Object.keys(process.env)
    .filter((name) => /^GROQ_API_KEY_\d+$/.test(name))
    .sort((a, b) => Number(a.slice(13)) - Number(b.slice(13)))
    .map((name) => process.env[name] ?? "");
  return [...new Set([...listed, ...numbered].map((k) => k.trim()).filter(Boolean))];
}

const keys = readKeys();
const restUntil = new Map<string, number>(); // `${use}|${key index}` -> time it may be used again
const turn = new Map<string, number>(); // `${use}` -> where the next round starts

export const groqKeyCount = () => keys.length;
export const firstGroqKey = (): string | undefined => keys[0];

/** "key 2 of 3" for logs and the operator panel; never the key itself. */
export const keyName = (index: number) => (keys.length > 1 ? `key ${index + 1}` : "key");

/**
 * The keys to try for one request, in order: starting one further along than last time, and leaving
 * out keys that are resting. Empty when every key rests (or none is set).
 */
export function keysFor(use: string): { key: string; index: number }[] {
  const start = turn.get(use) ?? 0;
  turn.set(use, (start + 1) % Math.max(1, keys.length));
  const now = Date.now();
  return keys
    .map((_, i) => (start + i) % keys.length)
    .filter((index) => (restUntil.get(`${use}|${index}`) ?? 0) <= now)
    .map((index) => ({ key: keys[index], index }));
}

/** Rests a key for one use, e.g. after a 429 with its retry-after time. */
export function rest(use: string, index: number, seconds: number) {
  restUntil.set(`${use}|${index}`, Date.now() + Math.max(1, seconds) * 1000);
}

/** Seconds until the first key may be used again for this use (0 when one is free). */
export function restingFor(use: string): number {
  if (!keys.length) return 0;
  const now = Date.now();
  const waits = keys.map((_, i) => (restUntil.get(`${use}|${i}`) ?? 0) - now);
  return waits.some((w) => w <= 0) ? 0 : Math.ceil(Math.min(...waits) / 1000);
}

/** How long Groq asks us to wait after a refusal: its retry-after header, else a minute. */
export function retryAfterSeconds(headers: Headers | undefined | null, fallback = 60): number {
  const value = Number(headers?.get("retry-after"));
  return value > 0 ? value : fallback;
}
