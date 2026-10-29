// A check at start-up, printed in the server window, so problems show before the first child does:
//   [check] voice ok: 18 scripted lines ready (18 new, 9.4 s)
//   [check] hearing ok: "Mirror, mirror, on the wall, who is the fairest…" (412 ms)
//   [check] AI ok: groq:qwen/qwen3.8-27b, first word 388 ms
// It also records every scripted line (the opening, the C, H and goodbye lines, the "oops" lines)
// with Groq's voice, once: they are kept on disk, so they play at once and cost nothing again.
// Each start then costs one short hearing request and one short AI request.
import { scriptedTakes } from "../src/lines.ts";
import { chatWithFallback } from "./providers/llm.ts";
import { transcribe } from "./providers/stt.ts";
import { isCached, speakCached } from "./providers/tts.ts";

type Options = { voiceEngine: "groq" | "piper"; voice: string; voiceModel: string; acting: boolean; sttModels: string[] };

const seconds = (since: number) => `${((performance.now() - since) / 1000).toFixed(1)} s`;
const ms = (since: number) => `${Math.round(performance.now() - since)} ms`;
const why = (e: unknown) => (e as Error).message.slice(0, 120);

// One second of silence as a WAV file, to check hearing when there is no Groq voice to hear.
function silentWav(): Buffer {
  const rate = 16000;
  const wav = Buffer.alloc(44 + rate * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + rate * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(rate * 2, 40);
  return wav;
}

/** Runs the checks and returns the lines to print; never throws. */
export async function startupCheck(o: Options): Promise<string[]> {
  const lines: string[] = [];
  let ok = true;
  let opening: Buffer | undefined;

  if (o.voiceEngine === "groq") {
    const takes = scriptedTakes(o.acting);
    const fresh = takes.filter((t) => !isCached(t, o.voice, o.voiceModel)).length;
    const start = performance.now();
    let failed = 0;
    let lastError = "";
    for (const take of takes) {
      try {
        const wav = await speakCached(take, o.voice, o.voiceModel);
        if (take === takes[0]) opening = wav;
      } catch (e) {
        failed++;
        lastError = why(e);
      }
    }
    if (failed) {
      ok = false;
      lines.push(`voice FAILED for ${failed} of ${takes.length} scripted lines (${lastError}): the local backup voice says those`);
    } else lines.push(`voice ok: ${takes.length} scripted lines ready${fresh ? ` (${fresh} new, ${seconds(start)})` : ""}`);
  } else lines.push("voice: the local Piper voice (TTS_ENGINE=piper or no Groq key), nothing to check");

  try {
    const start = performance.now();
    const { text } = await transcribe(opening ?? silentWav(), o.sttModels);
    const heard = opening ? ` "${text.length > 48 ? `${text.slice(0, 48)}…` : text}"` : "";
    if (opening && !/mirror/i.test(text)) {
      ok = false;
      lines.push(`hearing ODD: it heard the opening as "${text}" (${ms(start)})`);
    } else lines.push(`hearing ok:${heard} (${ms(start)})`);
  } catch (e) {
    ok = false;
    lines.push(`hearing FAILED (${why(e)}): the mirror cannot hear children`);
  }

  try {
    const start = performance.now();
    const r = await chatWithFallback(
      [{ role: "user", content: "(A grown-up is testing the mirror before the party. Say hello in five words.)" }],
      () => {},
      new AbortController().signal,
    );
    lines.push(`AI ok: ${r.target}, first word ${Math.round(r.firstTokenMs)} ms (${ms(start)} in all)`);
  } catch (e) {
    ok = false;
    lines.push(`AI FAILED (${why(e)}): the mirror cannot answer children`);
  }

  lines.push(ok ? "all good: the mirror is ready for the party" : "something failed: see above (and the D panel on the mirror)");
  return lines.map((line) => `[check] ${line}`);
}
