// Ends a sentence by loudness when a child talks straight into the mic. Their voice is far louder
// than the room, but at a loud party the speech detector also hears the crowd as speech, so after
// the child stops it may keep "hearing someone talk" and never end the sentence. Here the sentence
// ends once the child's voice has dropped back to the room's level for `endMs`, whatever the crowd
// does. A stretch with no child in it at all (only chatter) is dropped after `noChildMs`, so it
// cannot swallow the start of a child's sentence; and no sentence runs past `maxMs`.
export type CloseTalkVerdict = "end" | "drop" | undefined;

export function createCloseTalk(o: { nearDb: number; endMs: number; noChildMs?: number; maxMs?: number; frameMs?: number }) {
  const frameMs = o.frameMs ?? 32;
  const noChildMs = o.noChildMs ?? 2000;
  const maxMs = o.maxMs ?? 12_000;
  // A frame this many times louder than the room is the child's voice. A little under the gate's own
  // bar (nearDb), as a sentence's quieter syllables are below its loudest ones.
  const bar = 10 ** ((o.nearDb - 3) / 20);
  let ms = 0;
  let quietMs = 0;
  let childSeen = false;
  return {
    /** A new stretch of speech starts. */
    start() {
      ms = 0;
      quietMs = 0;
      childSeen = false;
    },
    /** Each frame while the detector hears speech; `room` is the room's level (undefined until measured). */
    frame(level: number, room: number | undefined): CloseTalkVerdict {
      ms += frameMs;
      if (room === undefined) return undefined; // the room is not measured yet: the detector decides
      if (level >= room * bar) {
        childSeen = true;
        quietMs = 0;
      } else quietMs += frameMs;
      if (childSeen && (quietMs >= o.endMs || ms >= maxMs)) return "end";
      if (!childSeen && ms >= noChildMs) return "drop";
      return undefined;
    },
  };
}
