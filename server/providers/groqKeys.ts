// Groq API keys. GROQ_API_KEY may list several, separated by commas; GROQ_API_KEY_2 and
// GROQ_API_KEY_3 (and so on, also written GROQ_API_KEY2 or GROQ_APIKEY_2) work too. Groq's limits
// belong to an organization (an account), so only keys from different accounts add capacity: a new
// key made in the same account shares the same, possibly used-up, limit. Groq names the organization
// in its refusals; when two keys turn out to share one, the server says so.
//
// Each use (a chat model, a speech-to-text model, the voice) takes the keys in turn, so the load is
// shared. A key that Groq refuses with "too many requests" rests until Groq says it may try again,
// and the other keys carry on meanwhile. Rests are per use, because Groq limits each model separately.

const NUMBERED = /^GROQ_?API_?KEY_?(\d+)$/i;

function readKeys(): string[] {
  const listed = (process.env.GROQ_API_KEY ?? "").split(",");
  const numbered = Object.keys(process.env)
    .filter((name) => NUMBERED.test(name))
    .sort((a, b) => Number(NUMBERED.exec(a)![1]) - Number(NUMBERED.exec(b)![1]))
    .map((name) => process.env[name] ?? "");
  return [...new Set([...listed, ...numbered].map((k) => k.trim()).filter(Boolean))];
}

const keys = readKeys();

/** Settings that hold a Groq key (they start with gsk_) under a name that is not read. */
export const unreadKeyNames = () =>
  Object.entries(process.env)
    .filter(([name, value]) => value?.trim().startsWith("gsk_") && name !== "GROQ_API_KEY" && !NUMBERED.test(name))
    .map(([name]) => name);

// The organization of each key, learnt from Groq's refusals ("... in organization `org_...`").
const orgs = new Map<number, string>();
const warnedShared = new Set<string>();

/** "key 2 (…c3d4, org_01kawe8h…)": which key and account a refusal came from, never the key itself. */
export const describeKey = (index: number) => {
  const org = orgs.get(index);
  return `${keyName(index)} (…${keys[index]?.slice(-4)}${org ? `, ${org.slice(0, 12)}…` : ""})`;
};

/** Notes the organization named in a refusal, and warns once when two keys share one. */
export function noteRefusal(index: number, message: string) {
  const org = /organization `?(org_[A-Za-z0-9]+)/.exec(message)?.[1];
  if (!org) return;
  orgs.set(index, org);
  const twins = [...orgs].filter(([, o]) => o === org).map(([i]) => i);
  if (twins.length > 1 && !warnedShared.has(org)) {
    warnedShared.add(org);
    console.warn(
      `[groq] ${twins.map(describeKey).join(" and ")} are in the same Groq organization, so they share one limit: ` +
        "a new key from the same account adds nothing. Use keys from different Groq accounts, or a paid Groq plan.",
    );
  }
}

/** For the status panel: each key's last 4 characters, and its organization once known. */
export const keyStatus = () => keys.map((k, i) => `…${k.slice(-4)}${orgs.get(i) ? ` (${orgs.get(i)!.slice(0, 12)}…)` : ""}`);
const restUntil = new Map<string, number>(); // `${use}|${key index}` -> time it may be used again
const turn = new Map<string, number>(); // `${use}` -> where the next round starts

export const groqKeyCount = () => keys.length;
/** The last 4 characters of each key, to check which keys are loaded without showing them. */
export const keyHints = () => keys.map((k) => `…${k.slice(-4)}`);
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
