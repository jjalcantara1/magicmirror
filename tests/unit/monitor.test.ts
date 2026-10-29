// The server window's live view of the D panel.
process.env.FORCE_COLOR = "0"; // plain text, so the lines can be compared
const { monitorLine } = await import("../../server/monitor.ts");
let bad = 0;
const ok = (c: boolean, w: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${w}`);
  bad += c ? 0 : 1;
};
const at = new Date(2026, 9, 31, 19, 4, 16);
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
ok(strip(monitorLine({ key: "state", value: "THINKING" }, at)) === "19:04:16  state    THINKING", "a time, the panel line's name and its value");
ok(strip(monitorLine({ key: "child", value: "I'm a\n witch!" }, at)) === "19:04:16  child    I'm a witch!", "line breaks are flattened");
ok(strip(monitorLine({ key: "ALERT", value: 'the child said: "I\'m lost"' }, at)).endsWith("<<< check on this child"), "an alert stands out");
ok(strip(monitorLine({ key: "mirror", value: "x".repeat(1000) }, at)).length < 330, "very long values are cut");
process.exit(bad ? 1 : 0);
