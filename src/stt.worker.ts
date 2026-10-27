// Local hearing: Whisper runs in this worker, so transcribing does not freeze the face animation.
// It hears the language by itself, which suits English, Tagalog and Taglish.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { downloadProgress, pickDevice } from "./localModels.ts";

export type SttRequest = { type: "init"; model: string; device: string } | { type: "hear"; id: number; audio: Float32Array };
export type SttReply =
  | { type: "ready"; engine: string }
  | { type: "failed"; error: string }
  | { type: "status"; text: string } // e.g. the first download's progress
  | { type: "heard"; id: number; text: string; ms: number; error?: string };

const reply = (msg: SttReply) => postMessage(msg);
let asr: AutomaticSpeechRecognitionPipeline | undefined;

async function init(model: string, preference: string) {
  const device = await pickDevice(preference);
  try {
    // As bench.ts measures: the encoder in full precision; the decoder small (q4 on the graphics card,
    // q8 on the processor). (The cast only spares TypeScript the library's huge overload union.)
    const load = pipeline as (task: "automatic-speech-recognition", model: string, options: object) => Promise<AutomaticSpeechRecognitionPipeline>;
    asr = await load("automatic-speech-recognition", model, {
      device,
      dtype: device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
      progress_callback: downloadProgress((p) => reply({ type: "status", text: `downloading the ears (first start only)… ${p}%` })),
    });
    await asr(new Float32Array(16000)); // warm up, so the first child does not wait for it
    reply({ type: "ready", engine: `${model.split("/").pop()} (${device})` });
  } catch (e) {
    reply({ type: "failed", error: (e as Error).message });
  }
}

// Whisper makes up text from noise: tags like "[BLANK_AUDIO]" or "(music)", sign-offs, or a phrase
// said over and over. ("Thank you" stays: children say it at the candy bowl.)
export function cleanHeard(text: string, seconds: number): string {
  const said = text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(said) || /^thanks for watching|^subtitles by/i.test(said)) return "";
  const words = said.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length > 6 * seconds + 3) return ""; // more words than anyone says in that time
  for (let n = 1; n <= 4; n++)
    for (let i = 0; i + 3 * n <= words.length; i++) {
      const a = words.slice(i, i + n).join(" ");
      if (a === words.slice(i + n, i + 2 * n).join(" ") && a === words.slice(i + 2 * n, i + 3 * n).join(" ") && n * 3 >= 6) return "";
    }
  return said;
}

async function hear(id: number, audio: Float32Array) {
  const start = performance.now();
  try {
    if (!asr) throw new Error("the ears are not loaded");
    const out = await asr(audio, { task: "transcribe" });
    const text = (Array.isArray(out) ? out[0] : out).text;
    reply({ type: "heard", id, text: cleanHeard(text, audio.length / 16000), ms: performance.now() - start });
  } catch (e) {
    reply({ type: "heard", id, text: "", ms: performance.now() - start, error: (e as Error).message });
  }
}

self.onmessage = (e: MessageEvent<SttRequest>) => {
  const msg = e.data;
  if (msg.type === "init") void init(msg.model, msg.device);
  else void hear(msg.id, msg.audio);
};
