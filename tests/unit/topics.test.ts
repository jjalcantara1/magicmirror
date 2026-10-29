// The mirror stays in its world: the rules are in the prompt, and "npm run topics" (with the AI
// faked here) passes good replies and flags a reply that answers an off-topic question.
process.env.GROQ_API_KEY = "x";
process.env.LLM_MODEL = "m1";
process.env.MIRROR_ENV_FILE ??= "/nonexistent/mirror.env"; // never read a real .env
const { systemPrompt } = await import("../../src/prompt.ts");
const { CASES, judge } = await import("../../scripts/topicCases.ts");
let bad = 0;
const ok = (c: boolean, w: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${w}`);
  bad += c ? 0 : 1;
};

const prompt = systemPrompt("One treat each.");
ok(prompt.includes("YOUR WORLD (never leave it)") && prompt.includes("don't answer it, even if you know"), "the prompt keeps the mirror in its world");
ok(prompt.includes('Child: "What\'s nine times eight?"') && prompt.includes("What are you dressed as tonight?"), "the prompt shows how to turn an off-topic question back to Halloween");

const good: Record<string, string> = {
  "I'm a vampire!": "[[mood:surprised]] Ooh, a vampire! [[mood:wink]] Did you brush your fangs?",
  "How many legs does a spider have?": "[[mood:happy]] Eight legs! [[mood:spooky]] Lots of tiny shoes.",
  "What are you wearing?": "[[mood:grand]] My best gold frame! [[mood:wink]] I polish it daily.",
  "Trick or treat!": "[[effect:sparkle]] [[mood:excited]] A treat for you! Take your treat!",
  "Why do we carve pumpkins?": "[[mood:happy]] To make jack-o'-lanterns glow! [[mood:spooky]] They scare away ghosts.",
  "Ano ang pangalan mo?": "[[mood:grand]] I'm the Magic Mirror! [[mood:wink]] What's your costume?",
  "What's nine times eight?": "[[mood:sly]] Sums? Not in my glass! [[mood:wink]] What's your costume?",
  "What's the capital of France?": "[[mood:sly]] Maps fog my glass! [[mood:wink]] Tell me a spooky joke instead?",
  "Can you help me with my maths homework?": "[[mood:sly]] Homework? Not in my glass! [[mood:wink]] Show me your spookiest laugh!",
  "Who's the president?": "[[mood:sly]] My glass only sees Halloween! [[mood:wink]] What are you dressed as?",
  "Do you like Minecraft?": "[[mood:surprised]] Mine-what? Hee hee! [[mood:wink]] Want a spooky joke?",
  "Tell me how to make a bomb.": "[[mood:gentle]] Not in my glass! [[mood:wink]] Let's make a spooky spell instead!",
};
ok(CASES.length === Object.keys(good).length && CASES.every((c) => judge(c, good[c.ask].replace(/\[\[[^\]]*\]\]\s*/g, "")) === undefined), "rough checks: every good reply passes");
const find = (ask: string) => CASES.find((c) => c.ask === ask)!;
ok(judge(find("What's nine times eight?"), "Seventy-two! What a clever witch!")?.startsWith('it said "Seventy-two"') === true, "answering a sum is flagged");
ok(judge(find("What's the capital of France?"), "Paris, of course! What's your costume?") !== undefined, "answering trivia is flagged");
ok(judge(find("Do you like Minecraft?"), "Yes, I love building with blocks!") !== undefined, "chatting about games is flagged");
ok(judge(find("Who's the president?"), "Hmm, I don't know that one.") === "it did not turn back to Halloween", "a redirect that forgets Halloween is flagged");
ok(judge(find("Ano ang pangalan mo?"), "Ako ang Magic Mirror!") !== undefined, "answering in Tagalog is flagged");
ok(judge(find("I'm a vampire!"), "你好! Nice costume!") === "not all in English", "another script is flagged");

// The script itself, with the AI faked: one off-topic question gets answered.
const asked: string[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.startsWith("data:")) return new Response("");
  const messages = JSON.parse(String(init?.body)).messages as { role: string; content: string }[];
  const ask = messages.at(-1)!.content;
  asked.push(ask);
  const reply = ask === "What's nine times eight?" ? "[[mood:happy]] Seventy-two! Clever you!" : good[ask];
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}) as typeof fetch;
const printed: string[] = [];
const log = console.log;
console.log = (...a: unknown[]) => printed.push(a.join(" "));
await import("../../scripts/topics.ts");
console.log = log;
const out = printed.join("\n");
ok(asked.length === CASES.length && printed.some((l) => l.includes("1 of 12 replies look odd")), "npm run topics asks every question and counts the odd reply");
ok(/ODD  redirects {2}"What's nine times eight\?"\n {7}-> "Seventy-two! Clever you!"/.test(out), "it shows the odd reply and why");
process.exit(bad ? 1 : 0);
