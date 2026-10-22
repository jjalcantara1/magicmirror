import type { TtsReply, TtsRequest } from "./tts.worker.ts";

// Speaks reply pieces in order with no gaps, and reports the mouth level from the audio that is playing.
export function createSpeaker(
  initialVoice: string,
  hooks: { onLevel(level: number): void; onAudioStart(): void; onPiece(genMs: number, audioSec: number): void },
) {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.connect(audioContext.destination);
  const worker = new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" });
  const send = (msg: TtsRequest) => worker.postMessage(msg);

  let voice = initialVoice;
  let engine: "kokoro" | "browser" = "kokoro";
  let generation = 0; // stop() bumps this, so audio from an old reply is dropped
  let pending: string[] = []; // sent to the worker, audio not back yet
  let outstanding = 0; // pieces not finished playing
  let finished = true; // finish() was called: no more pieces for this reply
  let waitingForFirst = false;
  let nextStart = 0;
  let idle: (() => void)[] = [];
  let browserSpeaking = false;
  const sources = new Set<AudioBufferSourceNode>();

  function pieceDone() {
    outstanding--;
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

  function play(samples: Float32Array, sampleRate: number) {
    if (!samples.length) return pieceDone();
    const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    const at = Math.max(audioContext.currentTime + 0.03, nextStart);
    source.start(at);
    nextStart = at + buffer.duration;
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      pieceDone();
    };
    audioStarted();
  }

  // Fallback when Piper cannot run: Chrome's built-in voice. Local voices only, so no text leaves the laptop.
  function speakBrowser(text: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    const local = speechSynthesis.getVoices().find((v) => v.localService && v.lang.startsWith("en"));
    if (local) utterance.voice = local;
    utterance.pitch = 0.8;
    utterance.rate = 0.92;
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
        pending.shift();
        hooks.onPiece(msg.genMs, msg.samples.length / msg.sampleRate);
        play(msg.samples, msg.sampleRate);
      }
    };
  });
  send({ type: "init", voice });

  const frame = new Float32Array(analyser.fftSize);
  function mouthLoop() {
    let level = 0;
    if (engine === "browser") {
      // speechSynthesis gives no audio to measure, so flap the mouth while it talks.
      level = browserSpeaking ? 0.35 + 0.3 * Math.sin(performance.now() / 70) : 0;
    } else {
      analyser.getFloatTimeDomainData(frame);
      let sum = 0;
      for (const s of frame) sum += s * s;
      level = Math.min(1, Math.sqrt(sum / frame.length) * 5);
    }
    hooks.onLevel(level);
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
