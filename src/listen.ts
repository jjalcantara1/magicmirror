import { MicVAD } from "@ricky0123/vad-web";
import { createNearGate, rms } from "./nearGate.ts";

/** nearDb: how far above the room a voice must be to be answered (see nearGate.ts); 0 = everyone. */
export type VadConfig = { positive: number; negative: number; redemptionMs: number; nearDb: number };

// Silero VAD cuts the mic into utterances, in the browser. Audio goes only to the onUtterance
// callback; nothing is recorded.
export async function createListener(
  audioContext: AudioContext,
  vad: VadConfig,
  handlers: {
    onUtterance(audio: Float32Array): void;
    onFrame(speechProbability: number, level: number): void;
    /** Every utterance: how far it stood above the room, and whether it was near enough to answer. */
    onHeard(aboveDb: number | undefined, near: boolean): void;
  },
) {
  const gate = createNearGate(vad.nearDb);
  const mic = await MicVAD.new({
    model: "v6",
    audioContext,
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/vad/",
    positiveSpeechThreshold: vad.positive,
    negativeSpeechThreshold: vad.negative,
    redemptionMs: vad.redemptionMs,
    preSpeechPadMs: 300,
    minSpeechMs: 250,
    startOnLoad: false,
    // Keep the mic open while paused. By default vad-web stops it and asks for it again on every reply.
    pauseStream: async () => {},
    resumeStream: async (stream) => stream,
    onSpeechEnd: (audio) => {
      const { aboveDb, near } = gate.judge(audio);
      handlers.onHeard(aboveDb, near);
      if (near) handlers.onUtterance(audio);
    },
    onFrameProcessed: (probs, frame) => {
      const level = rms(frame);
      gate.frame(level);
      handlers.onFrame(probs.isSpeech, level);
    },
  });
  return { start: () => mic.start(), pause: () => mic.pause() };
}
