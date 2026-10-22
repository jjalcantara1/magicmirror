import type { FaceState } from "./face/face.ts";

export type MirrorState = "SLEEPING" | "WAKING" | "LISTENING" | "THINKING" | "SPEAKING" | "GOODBYE";

const FACE: Record<MirrorState, FaceState> = {
  SLEEPING: "asleep",
  WAKING: "waking",
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
  GOODBYE: "speaking",
};

export function createState(onChange: (state: MirrorState, face: FaceState) => void) {
  let current: MirrorState = "SLEEPING";
  return {
    get: () => current,
    set(next: MirrorState) {
      if (next === current) return;
      current = next;
      onChange(next, FACE[next]);
    },
  };
}
