import type { TtsReply, TtsRequest } from "./tts.worker.ts";

/**
 * pitch: below 1 is deeper (at the same speed). speed: above 1 is faster (at the same pitch).
 * echo: 0 = dry, 1 = a big echoing hall. bass: how loud a rumble an octave below the voice is, 0 = none.
 */
export type VoiceFx = { pitch: number; speed: number; echo: number; bass: number };
/** engine: the main voice. voice: its voice id. piperVoice: the local backup voice. */
export type TtsConfig = { engine: "groq" | "piper"; voice: string; piperVoice: string };

// A stone hall: noise that dies away by 60 dB over `seconds`, after a short gap before the first echo.
function hallImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const gap = Math.floor(ctx.sampleRate * 0.02);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = gap; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * i) / length);
  }
  return buffer;
}

// The Queen's mirror booms from deep inside the glass: more bass, softer highs, and an echoing hall.
// Returns the input node.
function mirrorVoice(ctx: BaseAudioContext, echo: number): AudioNode {
  const trim = new GainNode(ctx, { gain: 0.75 }); // Piper peaks at full scale; leave room for the bass boost
  const bass = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 180, gain: 6 });
  const soft = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 6500 });
  const out = new DynamicsCompressorNode(ctx, { threshold: -16, knee: 12, ratio: 4 });
  trim.connect(bass).connect(soft).connect(out).connect(ctx.destination);
  if (echo > 0) {
    const hall = new ConvolverNode(ctx, { buffer: hallImpulse(ctx, 1.6) });
    soft.connect(hall).connect(new BiquadFilterNode(ctx, { type: "lowpass", frequency: 3500 })).connect(new GainNode(ctx, { gain: echo })).connect(out);
    const delay = new DelayNode(ctx, { delayTime: 0.17 });
    const delayTone = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 2500 });
    soft.connect(delay).connect(delayTone).connect(new GainNode(ctx, { gain: echo * 0.45 })).connect(out);
    delayTone.connect(new GainNode(ctx, { gain: 0.25 })).connect(delay);
  }
  return trim;
}

// Speaks reply pieces in order with no gaps, and reports the mouth level and shape from the audio that is playing.
export function createSpeaker(
  tts: TtsConfig,
  fx: VoiceFx,
  hooks: { onLevel(level: number, shape: number): void; onAudioStart(): void; onPiece(genMs: number, audioSec: number, by: string): void },
) {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  // The analyser hears the voice before the echo, so the mouth closes when the words end.
  const voiceIn = mirrorVoice(audioContext, fx.echo);
  analyser.connect(voiceIn);
  // The octave-lower layer: only its low rumble goes under the voice, and the mouth does not hear it.
  const bassIn = new BiquadFilterNode(audioContext, { type: "lowpass", frequency: 280 });
  bassIn.connect(new GainNode(audioContext, { gain: fx.bass })).connect(voiceIn);
  const worker = new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" });
  const send = (msg: TtsRequest) => worker.postMessage(msg);

  let voice = tts.voice;
  let engine: "worker" | "browser" = "worker";
  let generation = 0; // stop() bumps this, so audio from an old reply is dropped
  let pending: string[] = []; // sent to the worker, audio not back yet
  let outstanding = 0; // pieces not finished playing
  let finished = true; // finish() was called: no more pieces for this reply
  let waitingForFirst = false;
  let nextStart = 0;
  let idle: (() => void)[] = [];
  let browserSpeaking = false;
  const sources = new Set<AudioBufferSourceNode>();

  function pieceDone(pieces = 1) {
    outstanding -= pieces;
    if (outstanding === 0 && finished) {
      const resolvers = idle;
      idle = [];
      resolvers.forEach((resolve) => resolve());
    }
  }

  function audioStarted() {
    if (!waitingForFirst) return;
    waitingForFirst = false;
    hooks.onAudioStart();
  }

  function play(samples: Float32Array, sampleRate: number, pieces: number, bass: Float32Array) {
    if (!samples.length) return pieceDone(pieces);
    const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = fx.pitch;
    source.connect(analyser);
    const at = Math.max(audioContext.currentTime + 0.03, nextStart);
    source.start(at);
    nextStart = at + buffer.duration / fx.pitch;
    if (bass.length) {
      const low = audioContext.createBuffer(1, bass.length, sampleRate);
      low.copyToChannel(new Float32Array(bass), 0);
      const under = audioContext.createBufferSource();
      under.buffer = low;
      under.playbackRate.value = fx.pitch;
      under.connect(bassIn);
      under.start(at);
      sources.add(under);
      under.onended = () => sources.delete(under);
    }
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      pieceDone(pieces);
    };
    audioStarted();
  }

  // Fallback when Piper cannot run: Chrome's built-in voice. Local voices only, so no text leaves the laptop.
  function speakBrowser(text: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    const local = speechSynthesis.getVoices().find((v) => v.localService && v.lang.startsWith("en"));
    if (local) utterance.voice = local;
    utterance.pitch = 0.6;
    utterance.rate = 0.88;
    const gen = generation;
    utterance.onstart = () => {
      browserSpeaking = true;
      audioStarted();
    };
    utterance.onend = utterance.onerror = () => {
      browserSpeaking = false;
      if (gen === generation) pieceDone();
    };
    speechSynthesis.speak(utterance);
  }

  const ready = new Promise<string>((resolve) => {
    worker.onmessage = (e: MessageEvent<TtsReply>) => {
      const msg = e.data;
      if (msg.type === "ready") resolve(msg.engine);
      else if (msg.type === "failed") {
        engine = "browser";
        resolve(`browser voice (Piper failed: ${msg.error})`);
        const texts = pending;
        pending = [];
        texts.forEach(speakBrowser);
      } else if (msg.generation === generation) {
        pending.splice(0, msg.pieces);
        hooks.onPiece(msg.genMs, msg.samples.length / msg.sampleRate / fx.pitch, msg.by);
        play(msg.samples, msg.sampleRate, msg.pieces, msg.bass);
      }
    };
  });
  send({ type: "init", engine: tts.engine, voice, piperVoice: tts.piperVoice, pitch: fx.pitch, speed: fx.speed, bass: fx.bass > 0 });

  const frame = new Float32Array(analyser.fftSize);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const binHz = audioContext.sampleRate / analyser.fftSize;
  const power = (fromHz: number, toHz: number) => {
    let sum = 0;
    for (let i = Math.round(fromHz / binHz); i < Math.round(toHz / binHz); i++) sum += 10 ** (spectrum[i] / 10);
    return sum;
  };
  const decibels = (a: number, b: number) => 10 * Math.log10((a + 1e-12) / (b + 1e-12));
  function mouthLoop() {
    let level = 0;
    let shape = 0;
    if (engine === "browser") {
      // speechSynthesis gives no audio to measure, so flap the mouth while it talks.
      const t = performance.now();
      level = browserSpeaking ? 0.35 + 0.3 * Math.sin(t / 70) : 0;
      shape = 0.5 * Math.sin(t / 130);
    } else {
      analyser.getFloatTimeDomainData(frame);
      let sum = 0;
      for (const s of frame) sum += s * s;
      level = Math.min(1, Math.sqrt(sum / frame.length) * 5);
      // Mouth shape from the spectrum (calibrated on test vowels through the mirror voice): "ee", "ih"
      // and "s" are loud above 1.6 kHz, "oo" and "oh" below 500 Hz, and "ah" and "uh" in between.
      analyser.getFloatFrequencyData(spectrum);
      const mid = power(500, 1300);
      const wide = Math.max(0, Math.min(1, (decibels(power(1600, 8000), mid) + 12) / 16));
      const round = Math.max(0, Math.min(1, (decibels(power(150, 500), mid) + 1) / 8));
      shape = wide - round * (1 - wide);
    }
    hooks.onLevel(level, shape);
    requestAnimationFrame(mouthLoop);
  }
  mouthLoop();

  function tone(freq: number, type: OscillatorType, start: number, peak: number, length: number) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    // Straight to the speakers, not through the analyser, so the mouth stays still.
    osc.connect(gain).connect(audioContext.destination);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }

  return {
    audioContext,
    ready,
    say(text: string) {
      if (finished) waitingForFirst = true;
      finished = false;
      outstanding++;
      if (engine === "browser") speakBrowser(text);
      else {
        pending.push(text);
        send({ type: "speak", generation, text, voice });
      }
    },
    /** Resolves when everything said so far has finished playing. */
    finish(): Promise<void> {
      finished = true;
      if (outstanding === 0) return Promise.resolve();
      return new Promise((resolve) => idle.push(resolve));
    },
    stop() {
      generation++;
      send({ type: "cancel" });
      pending = [];
      for (const source of sources) {
        source.onended = null;
        source.stop();
      }
      sources.clear();
      speechSynthesis.cancel();
      browserSpeaking = false;
      outstanding = 0;
      finished = true;
      waitingForFirst = false;
      nextStart = 0;
      const resolvers = idle;
      idle = [];
      resolvers.forEach((resolve) => resolve());
    },
    voice: () => voice,
    setVoice(next: string) {
      voice = next;
    },
    /** Browsers start audio only after a user gesture; call this from a key handler. */
    resume: () => audioContext.resume(),
    /** A short magical chime, so there is never dead silence while the mirror thinks. */
    chime() {
      const t = audioContext.currentTime;
      [1318.5, 1975.5, 2637].forEach((f, i) => tone(f, "sine", t + i * 0.09, 0.06, 1.4));
    },
    /** Operator alert beep. */
    beep() {
      const t = audioContext.currentTime;
      tone(880, "square", t, 0.04, 0.15);
      tone(660, "square", t + 0.2, 0.04, 0.15);
    },
  };
}
