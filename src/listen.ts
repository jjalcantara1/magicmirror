import { MicVAD } from "@ricky0123/vad-web";
import { createCloseTalk } from "./closeTalk.ts";
import { createNearGate, rms } from "./nearGate.ts";

/**
 * nearDb: how far above the room a voice must be to be answered (see nearGate.ts); 0 = everyone.
 * listenAfterMs: how long after the mirror stops speaking the mic opens again.
 * closeTalk: children speak straight into the mic (see closeTalk.ts): no automatic mic volume, and
 * a sentence ends when the child's voice drops back to the room, even in a loud crowd.
 */
export type VadConfig = { positive: number; negative: number; redemptionMs: number; nearDb: number; listenAfterMs: number; closeTalk: boolean };

const FRAME_MS = 32; // the speech detector's frame: 512 samples at 16 kHz
const PAD_FRAMES = Math.ceil(300 / FRAME_MS); // kept from before speech starts, so the first word is whole

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
  const close = vad.closeTalk && vad.nearDb > 0 ? createCloseTalk({ nearDb: vad.nearDb, endMs: vad.redemptionMs }) : undefined;
  let segment: Float32Array[] | undefined; // the frames of the speech being heard now
  const recent: Float32Array[] = [];
  let wanted = false; // whether the mirror wants the mic on (start) or off (pause)

  function heard(audio: Float32Array) {
    const { aboveDb, near } = gate.judge(audio);
    handlers.onHeard(aboveDb, near);
    if (near) handlers.onUtterance(audio);
  }

  // The sentence ended by loudness (or held only chatter): the speech detector starts afresh, as it
  // does after a sentence it ended itself, and the audio is judged like any other.
  async function cut(verdict: "end" | "drop") {
    const frames = segment ?? [];
    segment = undefined;
    const audio = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
    let at = 0;
    for (const f of frames) {
      audio.set(f, at);
      at += f.length;
    }
    await mic.pause();
    if (wanted) await mic.start();
    if (verdict === "end") heard(audio);
    else handlers.onHeard(gate.judge(audio).aboveDb, false);
  }

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
    // The browser cleans up the mic: echo cancellation (the mirror's own voice) and noise suppression.
    // Automatic volume stays off when children talk into the mic: it turns the room up between words,
    // which makes a close child and a loud crowd sound alike.
    getStream: () =>
      navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: !vad.closeTalk },
      }),
    // Keep the mic open while paused. By default vad-web stops it and asks for it again on every reply.
    pauseStream: async () => {},
    resumeStream: async (stream) => stream,
    onSpeechStart: () => {
      segment = [...recent];
      close?.start();
    },
    onVADMisfire: () => {
      segment = undefined;
    },
    onSpeechEnd: (audio) => {
      segment = undefined;
      heard(audio);
    },
    onFrameProcessed: (probs, frame) => {
      const level = rms(frame);
      gate.frame(level);
      handlers.onFrame(probs.isSpeech, level);
      const copy = frame.slice();
      recent.push(copy);
      if (recent.length > PAD_FRAMES) recent.shift();
      if (!segment || !close) return;
      segment.push(copy);
      const verdict = close.frame(level, gate.room());
      if (verdict) void cut(verdict);
    },
  });
  return {
    start: () => {
      wanted = true;
      segment = undefined;
      return mic.start();
    },
    pause: () => {
      wanted = false;
      segment = undefined;
      return mic.pause();
    },
  };
}
