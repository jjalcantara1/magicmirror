// Imported first by the unit tests that use the voice cache or test sounds: the cache goes in a
// temporary folder, never the mirror's own (npm test also sets this up for every test).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MIRROR_CACHE_DIR ??= mkdtempSync(join(tmpdir(), "mirror-test-"));
export const VOICE_CACHE = join(process.env.MIRROR_CACHE_DIR, "voice");
export const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
