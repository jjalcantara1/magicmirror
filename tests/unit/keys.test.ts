process.env.GROQ_API_KEY = "k1, k2";
process.env.GROQ_API_KEY_3 = "k3";
process.env.GROQ_API_KEY_10 = "k10";
process.env.GROQ_API_KEY_2 = "k2"; // duplicate of one already listed
const { groqKeyCount, keysFor, rest, restingFor, keyName } = await import("../../server/providers/groqKeys.ts");
let bad = 0;
const ok = (c: boolean, w: string) => { console.log(`${c ? "ok  " : "FAIL"} ${w}`); bad += c ? 0 : 1; };
const order = (use: string) => keysFor(use).map((k) => k.key).join(",");
ok(groqKeyCount() === 4, `4 different keys read (commas, _3, _10, duplicate dropped): ${groqKeyCount()}`);
ok([order("chat"), order("chat"), order("chat"), order("chat"), order("chat")].join(" | ") === "k1,k2,k3,k10 | k2,k3,k10,k1 | k3,k10,k1,k2 | k10,k1,k2,k3 | k1,k2,k3,k10", "each request starts one key further along");
ok(order("stt") === "k1,k2,k3,k10", "each use has its own turn");
rest("chat", 1, 30);
ok(!order("chat").includes("k2") && order("stt").includes("k2"), "a resting key is skipped for that use only");
for (const i of [0, 2, 3]) rest("chat", i, 5 + i);
ok(keysFor("chat").length === 0 && restingFor("chat") === 5, `all resting: none to use, first free in ${restingFor("chat")} s`);
ok(keyName(2) === "key 3", "keys are named by number, never shown");
process.exit(bad ? 1 : 0);
