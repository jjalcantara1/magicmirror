import { createChunker } from "../../src/conversation.ts";
const out: string[] = [];
const c = createChunker((ch) => out.push(ch.text));
const reply = "[[mood:grand]] Fair art thou, a thousand times fairer than the Queen! [[mood:wink]] She will be so grumpy about it all night long! What costume dost thou wear tonight, brave one? Tell me everything about it!";
for (const w of reply.split(/(?<= )/)) if (!c.push(w)) break;
c.end();
const words = c.spoken().split(/\s+/).length;
console.log(out, words);
console.log(words <= 30 && /[!?.]$/.test(c.spoken()) ? "ok   long replies stop at the last whole sentence within 30 words" : "FAIL");
