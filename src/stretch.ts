// Changes the length of speech without changing its pitch (WSOLA). Overlapping 30 ms grains are
// copied, and each grain is moved by up to 8 ms to where it best continues the one before, so the
// waveform stays smooth. factor 0.8 makes the audio 20% shorter.
//
// The mirror voice uses it to sound deeper at a natural speed: the audio is made shorter here, and
// then played slower (lower) by the same factor.
export function stretch(input: Float32Array, factor: number, sampleRate: number): Float32Array {
  const frame = Math.round(sampleRate * 0.03);
  if (factor === 1 || input.length < frame * 2) return input;
  const hop = frame >> 1;
  const tolerance = Math.round(sampleRate * 0.008);
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);
  const outLength = Math.floor(input.length * factor);
  const out = new Float32Array(outLength + frame);
  const weight = new Float32Array(outLength + frame);
  const last = input.length - frame;
  let previous = -1; // where in the input the previous grain started
  for (let at = 0; at < outLength; at += hop) {
    let from = Math.min(last, Math.round(at / factor));
    const follow = previous + hop; // where the previous grain would naturally carry on
    if (previous >= 0 && follow <= last) {
      // Compare every 4th sample at every 2nd offset: plenty for speech, and fast.
      let best = -Infinity;
      const centre = from;
      for (let d = -tolerance; d <= tolerance; d += 2) {
        const p = centre + d;
        if (p < 0 || p > last) continue;
        let dot = 0;
        let energy = 1e-9;
        for (let i = 0; i < hop; i += 4) {
          dot += input[p + i] * input[follow + i];
          energy += input[p + i] * input[p + i];
        }
        const score = dot / Math.sqrt(energy);
        if (score > best) {
          best = score;
          from = p;
        }
      }
    }
    for (let i = 0; i < frame; i++) {
      out[at + i] += input[from + i] * window[i];
      weight[at + i] += window[i];
    }
    previous = from;
  }
  for (let i = 0; i < outLength; i++) out[i] /= Math.max(weight[i], 0.1);
  return out.subarray(0, outLength);
}

// The same speech an octave lower and just as long: made half as long, then read at half speed.
export function octaveBelow(input: Float32Array, sampleRate: number): Float32Array {
  const half = stretch(input, 0.5, sampleRate);
  const out = new Float32Array(input.length);
  for (let i = 0; i < out.length; i++) {
    const k = i >> 1;
    out[i] = i & 1 ? 0.5 * ((half[k] ?? 0) + (half[k + 1] ?? 0)) : (half[k] ?? 0);
  }
  return out;
}
