// Checks the mirror stays in its world, with the real AI: npm run topics
// Asks a dozen sample questions (scripts/topicCases.ts), each as the first question of a fresh visit
// right after the opening, and prints each reply with a rough verdict. Uses your Groq key: about a
// dozen short requests, a fraction of a cent.
import "../server/env.ts"; // first: loads .env
import { chatWithFallback } from "../server/providers/llm.ts";
import { parseTags } from "../src/conversation.ts";
import { ARRIVAL, OPENING } from "../src/lines.ts";
import { CASES, judge } from "./topicCases.ts";

let odd = 0;
for (const c of CASES) {
  let raw = "";
  let line: string;
  try {
    const turns = [
      { role: "user" as const, content: ARRIVAL },
      { role: "assistant" as const, content: `[[effect:thunder]] [[mood:grand]] ${OPENING}` },
      { role: "user" as const, content: c.ask },
    ];
    const r = await chatWithFallback(turns, (d) => (raw += d), new AbortController().signal);
    const reply = parseTags(raw).text;
    const problem = judge(c, reply);
    if (problem) odd++;
    line = `${problem ? "ODD " : "ok  "} ${c.expect === "answer" ? "answers " : "redirects"}  "${c.ask}"\n       -> "${reply}"${problem ? `\n       (${problem})` : ""}  [${r.target}]`;
  } catch (e) {
    odd++;
    line = `FAIL "${c.ask}": ${(e as Error).message}`;
  }
  console.log(line);
}
console.log(odd ? `\n${odd} of ${CASES.length} replies look odd: read them above` : `\nall ${CASES.length} replies look right`);
