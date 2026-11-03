// Records the demo for the README: docs/demo.mp4 (full quality), docs/demo.webp (the whole visit,
// animated, small enough for the README), docs/demo.gif (a short highlight, for sites that only take
// GIFs) and two stills.
//
// One visit to the mirror, start to finish. The children's voices, the AI and Groq's voice are
// simulated with scripted lines (so the recording is the same every time and needs no Groq key),
// and captions are added on top, as a README video has no sound. Everything else is the real
// mirror: the face, its moods and effects, the timing, waking, the instant reaction and sleeping.
//
//   node scripts/record-demo.mjs        (needs Playwright, as for the browser tests, and ffmpeg)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, launch } from "../tests/browser/helper.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS = join(ROOT, "docs");
const PORT = 5184;
const MIRROR = `http://127.0.0.1:${PORT}/`;
const SIZE = { width: 1280, height: 720 };

// The visit. Each child line is "said" into a fake microphone; each reply is what the AI "writes".
const OPENING_LABEL = "Asleep: the mirror listens for its name";
const VISIT = [
  { label: "A child says the magic words", child: "Hello, Mirror!" },
  { label: "Crowning the fairest", child: "Me! I'm the fairest!", reply: "[[effect:thunder]] [[mood:grand]] Yes, you are! [[mood:wink]] The Queen's so jealous. What's your costume?" },
  { label: "Praising the costume", child: "I'm a witch!", reply: "[[mood:surprised]] Ooh, a witch! [[mood:wink]] Is your broom super fast?" },
  { label: "Halloween facts, kept simple", child: "How many legs does a spider have?", reply: "[[mood:happy]] Eight legs! [[mood:spooky]] So many tiny shoes!" },
  { label: "Off topic? Back to Halloween", child: "What's nine times eight?", reply: "[[mood:sly]] Sums? Not in my glass! [[mood:wink]] Want a spooky joke instead?" },
  { label: "Giving out the treat", child: "Trick or treat!", reply: "[[effect:sparkle]] [[mood:excited]] Abraca-pumpkin! [[mood:happy]] Take your treat, little witch!" },
];
const ENDING_LABEL = "Quiet for a while: goodbye, then back to sleep";

// --- The test mirror: a fake key, temporary folders, and none of your own settings. ---
const SETTING = /^(GROQ|APIKEY|LLM_|TTS_|STT_|VOICE_|VAD_|WAKE_|IDLE_|LISTEN_|MIC_|OLLAMA|CANDY|STARTUP|AI_ENGINE|KOKORO|LOCAL_DEVICE|PORT$|REACTIONS|MONITOR)/i;
const tmp = mkdtempSync(join(tmpdir(), "mirror-demo-"));
const server = spawn(process.execPath, ["server/index.ts"], {
  cwd: ROOT,
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !SETTING.test(name))),
    MIRROR_ENV_FILE: join(tmp, "no.env"),
    MIRROR_CACHE_DIR: join(tmp, "cache"),
    MIRROR_MEMORY_FILE: join(tmp, "memory.json"),
    GROQ_API_KEY: "gsk_demoKEY0000",
    GROQ_TTS_VOICE: "troy",
    STARTUP_CHECK: "off",
    MONITOR: "off",
    IDLE_SLEEP_S: "5", // 30 s on the night; short here so the video shows the goodbye
    PORT: String(PORT),
  },
});
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(MIRROR)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

// --- Simulated voice: the sample voice, as long as the line needs (about 0.28 s a word). ---
const SAMPLE = fixture("groq-like.wav");
function voiceFor(text) {
  const words = text.replace(/\[[^\]]*\]\s*/g, "").match(/\S+/g)?.length ?? 1;
  const seconds = Math.max(0.5, words * 0.28);
  const at = SAMPLE.indexOf("data") + 8;
  const pcm = SAMPLE.subarray(at, at + SAMPLE.readUInt32LE(at - 4));
  const bytes = Math.floor((seconds * 24000 * 2) / 2) * 2;
  const body = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += pcm.length) pcm.copy(body, i, 0, Math.min(pcm.length, bytes - i));
  const header = Buffer.from(SAMPLE.subarray(0, at));
  header.writeUInt32LE(header.length - 8 + bytes, 4);
  header.writeUInt32LE(bytes, at - 4);
  return Buffer.concat([header, body]);
}

const browser = await launch();
const videoDir = join(tmp, "video");
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: videoDir, size: SIZE } });
const heard = [];
const replies = [];
await context.route("**/@ricky0123_vad-web.js*", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `
    export const utils = { encodeWAV: () => new ArrayBuffer(44) };
    export const MicVAD = { async new(o) { window.__vad = { o, running: false }; return {
      start() { window.__vad.running = true; }, pause() { window.__vad.running = false; } }; } };
    window.__say = () => { if (!window.__vad?.running) return false; window.__vad.o.onSpeechEnd(new Float32Array(16000)); return true; };
    export default { utils, MicVAD };`,
  }),
);
await context.route("**/api/stt", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: heard.shift() ?? "", ms: 380, provider: "groq whisper-large-v3" }) }));
await context.route("**/api/tts", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: voiceFor(JSON.parse(route.request().postData()).text) }));
await context.route("**/api/chat", (route) => {
  const reply = replies.shift() ?? "[[mood:happy]] Happy Halloween!";
  const deltas = reply.split(/(?<=[!?.] )/);
  setTimeout(
    () =>
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: deltas.map((d) => `data: ${JSON.stringify({ delta: d })}\n\n`).join("") + 'data: {"done":true,"provider":"groq:demo","firstTokenMs":380}\n\n',
      }),
    450, // about how long the AI takes to start answering
  );
});

// Captions and a stage label, drawn over the mirror for the video only.
await context.addInitScript(() => {
  const css = `
    #demo-label { position: fixed; top: 22px; left: 24px; padding: 8px 14px; border-radius: 999px;
      background: rgb(10 8 20 / 0.7); border: 1px solid rgb(242 199 92 / 0.6); color: #f2c75c;
      font: 600 19px/1.2 Georgia, "Times New Roman", serif; letter-spacing: 0.02em; z-index: 50; }
    #demo-label:empty { display: none; }
    #demo-caption { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); width: min(1100px, 90vw);
      display: grid; gap: 6px; padding: 12px 20px; border-radius: 14px; background: rgb(8 6 16 / 0.72);
      font: 500 25px/1.3 Georgia, "Times New Roman", serif; z-index: 50; text-align: center; }
    #demo-caption.empty { display: none; }
    #demo-caption .who { display: block; }
    #demo-caption .who:empty { display: none; }
    #demo-caption .child { color: #cfe3ff; }
    #demo-caption .mirror { color: #f6d27a; }
    #demo-caption b { font: 700 13px/1 ui-monospace, Consolas, monospace; letter-spacing: 0.12em; margin-right: 10px; vertical-align: 3px; opacity: 0.85; }
    #demo-note { position: fixed; top: 26px; right: 24px; color: rgb(255 255 255 / 0.55); font: 13px/1.3 ui-monospace, Consolas, monospace; z-index: 50; text-align: right; }`;
  addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="demo-label"></div><div id="demo-note">demo: simulated voices, captions added</div>
       <div id="demo-caption" class="empty"><span class="who child"></span><span class="who mirror"></span></div>`,
    );
  });
  const set = (sel, html) => (document.querySelector(sel).innerHTML = html);
  const refresh = () => {
    const cap = document.querySelector("#demo-caption");
    cap.classList.toggle("empty", !cap.querySelector(".child").innerHTML && !cap.querySelector(".mirror").innerHTML);
  };
  window.__label = (text) => set("#demo-label", text);
  window.__child = (text) => {
    set("#demo-caption .child", text ? `<b>CHILD</b>“${text}”` : "");
    set("#demo-caption .mirror", "");
    refresh();
  };
  window.__mirror = (text) => {
    set("#demo-caption .mirror", text ? `<b>MIRROR</b>${text}` : "");
    refresh();
  };
});

const started = Date.now();
const page = await context.newPage();
// The mirror's own panel lines (sent for the server window) drive the mirror's captions.
await context.route("**/api/monitor", async (route) => {
  for (const { key, value } of JSON.parse(route.request().postData()).events) {
    if (key === "react") await page.evaluate((t) => window.__mirror(t), value.match(/^"(.*)"/)?.[1] ?? value).catch(() => {});
    if (key === "mirror") await page.evaluate((t) => window.__mirror(t), value.replace(/\s*\(nobody spoke.*\)$/, "")).catch(() => {});
    if (key === "state" && value === "SLEEPING") await page.evaluate(() => (window.__child(""), window.__mirror(""))).catch(() => {});
  }
  route.fulfill({ status: 204 });
});
await page.goto(MIRROR);

const faceState = () => page.evaluate(() => document.querySelector("[data-state]")?.dataset.state);
const until = async (test, ms = 20000) => {
  for (let t = 0; t < ms; t += 50) {
    if (await test()) return true;
    await page.waitForTimeout(50);
  }
  throw new Error("the demo got stuck");
};
const mic = () => page.evaluate(() => window.__vad?.running === true);
const pause = (ms) => page.waitForTimeout(ms);

// Wait for the mirror to load, asleep, then start the visit.
await until(async () => (await faceState()) === "asleep" && (await mic()) && !(await page.$("#boot")));
await pause(800);
const trimFrom = (Date.now() - started) / 1000;
await page.evaluate((t) => window.__label(t), OPENING_LABEL);
await pause(3200);
mkdirSync(DOCS, { recursive: true });
await page.screenshot({ path: join(DOCS, "mirror-asleep.png") });

for (const [i, step] of VISIT.entries()) {
  await until(async () => (await mic()) && ["asleep", "listening"].includes(await faceState()));
  await pause(i === 0 ? 300 : 900);
  await page.evaluate((t) => window.__label(t), step.label);
  await page.evaluate((t) => window.__child(t), step.child);
  await pause(1300); // the child talking
  heard.push(step.child);
  if (step.reply) replies.push(step.reply);
  await page.evaluate(() => window.__say());
  await until(async () => (await faceState()) === "speaking");
  if (i === 1) {
    await pause(700);
    await page.screenshot({ path: join(DOCS, "mirror-speaking.png") });
  }
  await until(async () => (await faceState()) === "listening" && (await mic()));
}
await pause(600);
await page.evaluate((t) => window.__label(t), ENDING_LABEL);
await page.evaluate(() => (window.__child(""), window.__mirror("")));
await until(async () => (await faceState()) === "asleep", 30000);
await pause(3500);
await page.close();
await context.close();
await browser.close();
server.kill();

// --- Encode, from the start of the visit to the end of the recording (after the mirror sleeps). ---
const webm = join(videoDir, readdirSync(videoDir).find((f) => f.endsWith(".webm")));
const from = ["-ss", trimFrom.toFixed(2), "-i", webm];
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
ffmpeg(...from, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-preset", "slow", "-movflags", "+faststart", join(DOCS, "demo.mp4"));
ffmpeg(...from, "-vf", "fps=12,scale=800:-1:flags=lanczos", "-c:v", "libwebp_anim", "-quality", "55", "-loop", "0", join(DOCS, "demo.webp"));
// The GIF: the first 24 s (asleep, waking, the opening, a "Hmm!" and a reply), small enough to load.
ffmpeg("-ss", trimFrom.toFixed(2), "-t", "24", "-i", webm, "-vf", "fps=8,scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", join(DOCS, "demo.gif"));
rmSync(tmp, { recursive: true, force: true });
for (const f of ["demo.mp4", "demo.webp", "demo.gif", "mirror-asleep.png", "mirror-speaking.png"])
  console.log(`docs/${f}: ${(statSync(join(DOCS, f)).size / 1e6).toFixed(1)} MB`);
const seconds = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(DOCS, "demo.mp4")]).toString().trim();
console.log(`video: ${Number(seconds).toFixed(1)} s`);
