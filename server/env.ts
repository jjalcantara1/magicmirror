// Loads .env, and .env wins. Node's own --env-file keeps any variable that is already set in the
// system or the terminal (a Windows environment variable, `setx`, `$env:GROQ_API_KEY = ...`), so an
// old key set there silently beat a new key in .env. This module is imported first, before any other
// module reads a setting. A clash is reported, showing only the last 4 characters of a value.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// MIRROR_ENV_FILE: another settings file; the tests use one that does not exist, so they never read
// your .env (or its Groq key).
export const ENV_FILE = process.env.MIRROR_ENV_FILE || fileURLToPath(new URL("../.env", import.meta.url));
const hint = (value: string) => (value.length > 8 ? `…${value.slice(-4)}` : "…");

export function loadEnvFile(file = ENV_FILE): string[] {
  if (!existsSync(file)) return [];
  const notes: string[] = [];
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (value === undefined) continue;
    const before = process.env[name];
    if (before !== undefined && before !== value) {
      const secret = /KEY|TOKEN|SECRET/i.test(name);
      notes.push(
        `${name} is also set in your system or terminal (${secret ? hint(before) : before}); using the one in .env (${secret ? hint(value) : value}).` +
          " Remove the old one so it can't come back: Windows Settings > Environment Variables.",
      );
    }
    process.env[name] = value;
  }
  return notes;
}

for (const note of loadEnvFile()) console.warn(`[settings] ${note}`);
