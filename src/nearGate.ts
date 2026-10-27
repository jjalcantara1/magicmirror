// Hears only the person at the mirror. At a loud party the speech detector also picks up talk further
// away, and noise filters cannot help there: they keep all speech (measured: they cut a child's voice
// as much as the crowd). But the child at the mirror is louder. So each utterance (its loud parts)
// is compared with the room (its quiet moments over the last 15 s of listening), and anything less
// than `nearDb` above the room is ignored. On party audio a child at the mirror was 8 to 16 dB above
// the room, and crowd chatter 5.5 dB (7 at most).
const FRAME = 512; // 32 ms at 16 kHz, the speech detector's frame
const ROOM_FRAMES = 470; // about 15 s
const MIN_ROOM_FRAMES = 60; // about 2 s; before that, everything is let through

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

export function createNearGate(nearDb: number) {
  const room: number[] = [];
  return {
    /** Every mic frame while listening. */
    frame(level: number) {
      room.push(level);
      if (room.length > ROOM_FRAMES) room.shift();
    },
    /** How far the utterance stands above the room, and whether it is near enough to answer. */
    judge(audio: Float32Array): { aboveDb?: number; near: boolean } {
      if (room.length < MIN_ROOM_FRAMES) return { near: true };
      const levels: number[] = [];
      for (let at = 0; at + FRAME <= audio.length; at += FRAME) levels.push(rms(audio, at, at + FRAME));
      if (!levels.length) return { near: true };
      const aboveDb = 20 * Math.log10((percentile(levels, 75) + 1e-9) / (percentile(room, 20) + 1e-9));
      return { aboveDb, near: nearDb <= 0 || aboveDb >= nearDb };
    },
  };
}

export { rms };
