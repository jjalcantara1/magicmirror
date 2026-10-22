// Every face implements this, so the mask can be swapped for another design.
export type FaceState = "asleep" | "waking" | "listening" | "thinking" | "speaking";

export const EFFECTS = ["sparkle", "thunder", "smoke", "glow", "crown"] as const;
export type Effect = (typeof EFFECTS)[number];

export interface Face {
  setState(state: FaceState): void;
  /** 0 = closed, 1 = wide open. Called every animation frame while audio plays. */
  setMouth(open: number): void;
  effect(name: Effect): void;
}
