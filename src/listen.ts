import { MicVAD } from "@ricky0123/vad-web";

export type VadConfig = { positive: number; negative: number; redemptionMs: number };

function rms(frame: Float32Array): number {
  let sum = 0;
  for (const s of frame) sum += s * s;
  return Math.sqrt(sum / frame.length);
}

// Silero VAD cuts the mic into utterances, in the browser. Audio goes only to the onUtterance
// callback; nothing is recorded.
export async function createListener(
  audioContext: AudioContext,
  vad: VadConfig,
  handlers: { onUtterance(audio: Float32Array): void; onFrame(speechProbability: number, level: number): void },
) {
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
    onSpeechEnd: (audio) => handlers.onUtterance(audio),
    onFrameProcessed: (probs, frame) => handlers.onFrame(probs.isSpeech, rms(frame)),
  });
  return { start: () => mic.start(), pause: () => mic.pause() };
}
