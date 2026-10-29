// Everything the mirror says in its own words is in everyday words children use: its fixed lines
// and the example replies in its instructions. Only the classic opening line is old-fashioned.
const { CUES, FOGGY, GOODBYES, OPENING, SMUDGE } = await import("../../src/lines.ts");
const { systemPrompt } = await import("../../src/prompt.ts");
const { OLD_WORDS } = await import("../../scripts/topicCases.ts");
let bad = 0;
const ok = (c: boolean, w: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${w}`);
  bad += c ? 0 : 1;
};
const words = (s: string) => s.match(/\S+/g)?.length ?? 0;
const lines = [...Object.values(CUES).flatMap((c) => c.lines), ...GOODBYES, FOGGY, SMUDGE];
const old = lines.filter((l) => OLD_WORDS.test(l));
ok(old.length === 0, `no old-fashioned words in the fixed lines${old.length ? `: ${old.join(" | ")}` : ""}`);
ok(lines.every((l) => words(l) <= 15), "every fixed line is short (15 words at most)");
ok(OPENING.startsWith("Mirror, mirror, on the wall, who is the fairest of them all?"), "the classic opening line stays");
const examples = systemPrompt("One treat each.")
  .split("\n")
  .filter((l) => l.startsWith("You: "))
  .map((l) => l.slice(5).replace(/\[\[[^\]]*\]\]\s*/g, ""));
ok(examples.length >= 4 && examples.every((e) => !OLD_WORDS.test(e) && words(e) <= 15), `the example replies are short, in everyday words: ${examples.join(" | ")}`);
ok(/No old-fashioned words: never thou, thee, thy/.test(systemPrompt("x")), "the instructions forbid old-fashioned words");
process.exit(bad ? 1 : 0);
