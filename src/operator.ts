type Handlers = { wake(): void; reset(): void; newVisitor(): void; nextVoice(): void; candy(): void; halloween(): void };
type Status = {
  keys: string[];
  llm: { target: string; requests: number; tokens: number; remainingRequests?: number; coolingDownSec: number; lastError?: string }[];
  stt: { target: string; requestsToday: number };
  tts: { target: string; requestsToday: number; fromDiskToday: number; coolingDownSec: number; lastError?: string };
};

// Operator hotkeys and the debug overlay. Transcripts show here only and are wiped per visitor.
export function createOperator(handlers: Handlers) {
  const panel = document.querySelector<HTMLPreElement>("#debug")!;
  const alertDot = document.querySelector<HTMLDivElement>("#alert")!;
  const fields = new Map<string, string>([
    ["keys", "G wake (or say \"hello mirror\") · N new visitor · C treat · H happy halloween · R sleep · X restart · V next voice · D this panel"],
  ]);
  let transcript: string[] = [];
  let status = "";
  let scheduled = false;

  function render() {
    scheduled = false;
    if (panel.hidden) return;
    const lines = [...fields].map(([key, value]) => `${key.padEnd(8)} ${value}`);
    panel.textContent = [...lines, "", status, "", ...transcript].join("\n");
  }
  const schedule = () => {
    if (!scheduled) (scheduled = true), requestAnimationFrame(render);
  };

  async function pollStatus() {
    try {
      const s = (await (await fetch("/api/status")).json()) as Status;
      status = [
        `groq keys: ${s.keys.length ? s.keys.join("  ") : "none"}`,
        "free tier today:",
        ...s.llm.map(
          (p) =>
            `  ${p.target.padEnd(28)} ${String(p.requests).padStart(4)} req ${String(p.tokens).padStart(7)} tok` +
            (p.remainingRequests !== undefined ? `  ${p.remainingRequests} left` : "") +
            (p.coolingDownSec ? `  COOLDOWN ${p.coolingDownSec}s` : "") +
            (p.lastError ? `  (${p.lastError.slice(0, 60)})` : ""),
        ),
        `  ${s.stt.target.padEnd(28)} ${String(s.stt.requestsToday).padStart(4)} req`,
        `  ${s.tts.target.padEnd(28)} ${String(s.tts.requestsToday).padStart(4)} req  (${s.tts.fromDiskToday} lines from disk)` +
          (s.tts.coolingDownSec ? `  COOLDOWN ${s.tts.coolingDownSec}s` : "") +
          (s.tts.lastError ? `  (${s.tts.lastError.slice(0, 60)})` : ""),
      ].join("\n");
    } catch {
      status = "server status unavailable";
    }
    schedule();
  }
  setInterval(() => {
    if (!panel.hidden) void pollStatus();
  }, 5000);

  addEventListener("keydown", (e) => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    switch (e.key.toLowerCase()) {
      case "g":
        handlers.wake();
        break;
      case "r":
        alertDot.hidden = true;
        handlers.reset();
        break;
      case "n":
        alertDot.hidden = true;
        handlers.newVisitor();
        break;
      case "x":
        // A full restart, for when something is stuck (sound, mic, face): the page loads again, asleep.
        location.reload();
        break;
      case "v":
        handlers.nextVoice();
        break;
      case "c":
        handlers.candy();
        break;
      case "h":
        handlers.halloween();
        break;
      case "d":
        panel.hidden = !panel.hidden;
        if (!panel.hidden) void pollStatus();
        schedule();
        break;
    }
  });

  return {
    set(key: string, value: string) {
      fields.set(key, value);
      schedule();
    },
    transcript(line: string) {
      transcript = [...transcript, line].slice(-12);
      schedule();
    },
    clearTranscript() {
      transcript = [];
      schedule();
    },
    alert() {
      alertDot.hidden = false;
    },
  };
}
