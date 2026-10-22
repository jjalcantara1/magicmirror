// Every face implements this, so the mask can be swapped for another design.
export type FaceState = "asleep" | "waking" | "listening" | "thinking" | "speaking";

export const EFFECTS = ["sparkle", "thunder", "smoke", "glow", "crown"] as const;
export type Effect = (typeof EFFECTS)[number];

export const MOODS = ["happy", "laugh", "surprised", "sly", "wink", "spooky", "gentle"] as const;
export type Mood = (typeof MOODS)[number];

export interface Face {
  setState(state: FaceState): void;
  /**
   * Called every animation frame while audio plays.
   * open: 0 = closed, 1 = wide open. shape: -1 = round lips (oo), 0 = relaxed, 1 = wide lips (ee, s).
   */
  setMouth(open: number, shape: number): void;
  /** Shows an expression for the reply that is starting. The next state other than speaking clears it. */
  setMood(mood: Mood): void;
  effect(name: Effect): void;
}
