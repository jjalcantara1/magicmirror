export type Audio = { samples: Float32Array; sampleRate: number };

// Reads a WAV file: 16-bit PCM or 32-bit float, mixed down to mono. Piper and Groq both send WAV.
export function parseWav(wav: ArrayBuffer): Audio {
  const view = new DataView(wav);
  let format = 1;
  let channels = 1;
  let sampleRate = 22050;
  let bits = 16;
  for (let pos = 12; pos + 8 <= wav.byteLength; ) {
    const id = String.fromCharCode(view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3));
    let size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      // A streamed WAV can leave the data size open.
      if (size === 0 || body + size > wav.byteLength) size = wav.byteLength - body;
      const float = format === 3 || (format === 0xfffe && bits === 32);
      if (!float && bits !== 16) throw new Error(`WAV with ${bits}-bit samples is not supported`);
      const bytes = bits / 8;
      const frames = Math.floor(size / (bytes * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const at = body + (i * channels + c) * bytes;
          sum += float ? view.getFloat32(at, true) : view.getInt16(at, true) / 32768;
        }
        samples[i] = sum / channels;
      }
      return { samples, sampleRate };
    }
    pos = body + size + (size & 1);
  }
  throw new Error("the WAV has no audio");
}
