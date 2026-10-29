// Shared by the browser tests: Playwright's Chromium, the test mirror's address, and test sounds.
// npm test starts the test mirror and sets MIRROR_URL.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

export const MIRROR = process.env.MIRROR_URL ?? "http://127.0.0.1:5180/";

/** Playwright, from this project or installed globally (NODE_PATH); undefined when missing. */
export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {}
  try {
    return createRequire(import.meta.url)("playwright");
  } catch {}
  return undefined;
}

/** Chromium with a fake mic and camera, and sound allowed without a click. PW_CHROMIUM picks another browser. */
export async function launch() {
  const playwright = await loadPlaywright();
  if (!playwright) throw new Error("Playwright is not installed: npm i -D playwright && npx playwright install chromium");
  return playwright.chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
}

/** A test sound from tests/fixtures. */
export const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

/** The same WAV said `times` times over: a take in which Groq's voice "looped". */
export function repeatedWav(wav, times) {
  const at = wav.indexOf("data") + 8;
  const pcm = wav.subarray(at, at + wav.readUInt32LE(at - 4));
  const out = Buffer.concat([wav.subarray(0, at), ...Array(times).fill(pcm)]);
  out.writeUInt32LE(out.length - 8, 4);
  out.writeUInt32LE(pcm.length * times, at - 4);
  return out;
}
