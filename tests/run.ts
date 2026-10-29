// npm test: every unit test, then the browser tests (when Playwright is installed), each in its own
// process. They use a fake Groq key and a temporary folder: never your .env, your key, or the voice
// recordings in .mirror-cache. Groq, hearing and the AI are faked, so nothing is sent anywhere.
//
//   npm test               everything
//   npm test -- wake take  only the tests whose names contain "wake" or "take"
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.TEST_PORT ?? 5180);
const TIMEOUT_MS = 240_000;
const only = process.argv.slice(2);
const wanted = (name: string) => !only.length || only.some((w) => name.includes(w));

// None of your mirror settings reach the tests: they would change what the tests expect.
const SETTING = /^(GROQ|APIKEY|LLM_|TTS_|STT_|VOICE_|VAD_|WAKE_|IDLE_|LISTEN_|MIC_|OLLAMA|CANDY|STARTUP|AI_ENGINE|KOKORO|LOCAL_DEVICE|PORT$)/i;
const tmp = mkdtempSync(join(tmpdir(), "mirror-test-"));
const baseEnv: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !SETTING.test(name))),
  MIRROR_ENV_FILE: join(tmp, "no-settings.env"),
  MIRROR_CACHE_DIR: join(tmp, "cache"),
  MIRROR_MEMORY_FILE: join(tmp, "memory.json"),
};

let failures = 0;
let passed = 0;

function run(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const name = [file.replace(`${ROOT}`, "").replace(/\\/g, "/"), ...args].join(" ");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: ROOT, env });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      const ok = (output.match(/^ok\b/gm) ?? []).length;
      const fail = (output.match(/^FAIL\b/gm) ?? []).length;
      const pageErrors = /^PAGE ERRORS/m.test(output);
      const broken = code !== 0 || fail > 0 || pageErrors || ok === 0;
      passed += ok;
      if (broken) failures++;
      console.log(`${broken ? "FAIL" : "ok  "} ${name}: ${ok} passed${fail ? `, ${fail} failed` : ""}${code ? ` (exit ${code})` : ""}`);
      if (broken) console.log(output.replace(/^/gm, "      "));
      resolve();
    });
  });
}

async function waitForMirror(server: ChildProcess): Promise<boolean> {
  for (let i = 0; i < 120 && server.exitCode === null; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Unit tests.
console.log("Unit tests");
for (const file of readdirSync(join(ROOT, "tests/unit")).filter((f) => f.endsWith(".test.ts")).sort())
  if (wanted(file)) await run(join(ROOT, "tests/unit", file), [], baseEnv);

// Browser tests, against a test mirror on PORT with a fake key. Some need other settings.
const groups: { env: Record<string, string>; tests: [string, ...string[]][] }[] = [
  { env: {}, tests: [["opening"], ["acting", "on"], ["take"], ["taglish"], ["keys"], ["reset"], ["think"], ["loop"], ["party"]] },
  { env: { VOICE_ACTING: "off" }, tests: [["acting", "off"]] },
  { env: { IDLE_SLEEP_S: "4" }, tests: [["wake"]] },
];
const playwright = await import("playwright").catch(() => {
  try {
    return createRequire(import.meta.url)("playwright");
  } catch {
    return undefined;
  }
});
console.log("\nBrowser tests");
if (!playwright) console.log("skipped: Playwright is not installed (npm i -D playwright && npx playwright install chromium)");
else
  for (const group of groups) {
    const tests = group.tests.filter(([name]) => wanted(name));
    if (!tests.length) continue;
    const env = { ...baseEnv, GROQ_API_KEY: "gsk_testkeyAAAA1234", GROQ_TTS_VOICE: "troy", STARTUP_CHECK: "off", PORT: String(PORT), ...group.env };
    const server = spawn(process.execPath, ["server/index.ts"], { cwd: ROOT, env });
    let log = "";
    server.stdout?.on("data", (d) => (log += d));
    server.stderr?.on("data", (d) => (log += d));
    if (!(await waitForMirror(server))) {
      failures++;
      console.log(`FAIL the test mirror did not start on port ${PORT}:\n${log.replace(/^/gm, "      ")}`);
    } else
      for (const [name, ...args] of tests)
        await run(join(ROOT, "tests/browser", `${name}.test.mjs`), args, { ...baseEnv, MIRROR_URL: `http://127.0.0.1:${PORT}/` });
    server.kill();
    await new Promise((r) => server.once("close", r));
  }

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures ? `${failures} test file(s) failed` : "all tests passed"} (${passed} checks passed)`);
process.exit(failures ? 1 : 0);
