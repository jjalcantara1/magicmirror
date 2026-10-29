// Key names, shared organizations and the voice cache, with Groq faked.
import { readFileSync, rmSync } from "node:fs";
import { VOICE_CACHE } from "./setup.ts";
for (const k of Object.keys(process.env)) if (/GROQ|APIKEY/i.test(k)) delete process.env[k];
process.env.GROQ_API_KEY = "gsk_aaaa1111";
process.env.GROQ_API_KEY2 = "gsk_bbbb2222";
process.env.GROQ_APIKEY_3 = "gsk_cccc3333";
process.env.APIKEY_4 = "gsk_dddd4444";
const SAME_ORG = "org_01kawe8hj0epjtrw84mmybxgsw";
const used: string[] = [];
const warnings: string[] = [];
const warn = console.warn;
console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
const wav = (seconds: number) => {
  const n = 24000 * seconds, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i * 0.05)), 44 + i * 2);
  return b;
};
let reply = (key: string) => key === "gsk_cccc3333" ? new Response(wav(2)) : new Response(JSON.stringify({ error: { message: `Rate limit reached for model \`canopylabs/orpheus-v1-english\` in organization \`${SAME_ORG}\` service tier \`on_demand\` on tokens per day (TPD): Limit 3600, Used 3555, Requested 120.` } }), { status: 429, headers: { "retry-after": "3600" } });
globalThis.fetch = (async (_u: string, init: RequestInit) => { const key = String(new Headers(init.headers).get("authorization")).replace("Bearer ", ""); used.push(key.slice(-4)); return reply(key); }) as typeof fetch;

const keysMod = await import("../../server/providers/groqKeys.ts");
const { speakCached, ttsStatus } = await import("../../server/providers/tts.ts");
let bad = 0;
const ok = (c: boolean, w: string) => { warn(`${c ? "ok  " : "FAIL"} ${w}`); bad += c ? 0 : 1; };
ok(keysMod.keyHints().join(" ") === "…1111 …2222 …3333", `GROQ_API_KEY, GROQ_API_KEY2 and GROQ_APIKEY_3 are all read: ${keysMod.keyHints().join(" ")}`);
ok(keysMod.unreadKeyNames().join() === "APIKEY_4", `a Groq key under an odd name is reported: ${keysMod.unreadKeyNames().join()}`);

const cacheDir = VOICE_CACHE;
rmSync(cacheDir, { recursive: true, force: true });
const line = "[cheerful] Mirror, mirror, on the wall, who is the fairest of them all?";
const first = await speakCached(line, "troy", "orpheus");
ok(used.join(",") === "1111,2222,3333" && first.length > 1000, `keys 1 and 2 refused (daily limit), key 3 speaks: ${used.join(",")}`);
const shared = warnings.find((w) => w.includes("same Groq organization")) ?? "";
ok(shared.includes("key 1 (…1111, org_01kawe8h…)") && shared.includes("key 2 (…2222, org_01kawe8h…)"), "the server says keys 1 and 2 share one organization");
ok(warnings.some((w) => w.includes("tokens per day (TPD): Limit 3600, Used 3555, Requested 120")), "Groq's whole message is logged, with the limit and the numbers");
ok(keysMod.keyStatus().join(" ") === "…1111 (org_01kawe8h…) …2222 (org_01kawe8h…) …3333", `the D panel shows the organizations: ${keysMod.keyStatus().join(" ")}`);

used.length = 0;
const again = await speakCached(line, "troy", "orpheus");
ok(used.length === 0 && again.equals(first) && ttsStatus().fromDiskToday === 1, "the same line again comes from disk, with no Groq request");

reply = () => new Response(wav(20)); // a 20 s take of an 8-word line: a loop
used.length = 0;
await speakCached("[cheerful] Take your treat, mighty dino!", "troy", "orpheus");
await speakCached("[cheerful] Take your treat, mighty dino!", "troy", "orpheus");
ok(used.length === 2, "a looping take is never kept: asking again goes to Groq");
rmSync(cacheDir, { recursive: true, force: true });
console.warn = warn;
process.exit(bad ? 1 : 0);
