import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { BrowseClient } from "./browse-client.ts";
import { wrapRunnerForAsideBot, forgetAsideBotLink } from "./aside-bot-runner.ts";

const ROOT = process.env.BOTLAB_ROOT ?? process.cwd();
const AGENT = "test-browser-bot";
mkdirSync(join(ROOT, "agents", AGENT), { recursive: true });
const state = JSON.parse(readFileSync("/home/hoon/_roots/labs/work/Belmont/belmont-browse/.state/serve.json", "utf8"));
const client = new BrowseClient(`http://127.0.0.1:${state.port}`, state.token);
const shown: string[] = [];
const log = (m: string) => console.log("  log:", m);
const emitUpdate = (u: any) => { const m = u.message; const text = m?.type === "text" ? m.content : JSON.stringify(m); shown.push(text); console.log("  BOT>", String(text).slice(0, 140)); };
const runner = wrapRunnerForAsideBot({} as object, AGENT, { client: () => client, emitUpdate, log }) as any;
const link = () => { try { return JSON.parse(readFileSync(join(ROOT, "agents", AGENT, "browse-runtime.json"), "utf8")); } catch { return null; } };

console.log("== A. no link + hidden nudge -> adopt the chat open in Aside and mirror it");
forgetAsideBotLink(AGENT);
let r = await runner.run("nudge", { hidden: true });
console.log("  result:", JSON.stringify(r), "link:", JSON.stringify(link()));

console.log("== B. user turn -> continues the adopted chat");
r = await runner.run("And 5+5? Number only.");
console.log("  result:", JSON.stringify(r).slice(0, 160), "link:", JSON.stringify(link()));

console.log("== C. user starts a NEW chat in the Aside UI (tRPC createAndPrompt) -> hidden nudge follows it");
const out = execFileSync("python3", [process.env.ASIDE_UI_CHAT!, "What is 7+7? Number only."], { env: { ...process.env }, encoding: "utf8" });
console.log("  aside-ui-chat:", out.trim().split("\n").pop()!.slice(0, 80));
await new Promise((res) => setTimeout(res, 8000));
r = await runner.run("nudge", { hidden: true });
console.log("  result:", JSON.stringify(r), "link:", JSON.stringify(link()));

console.log("== D. user turn continues the followed chat");
r = await runner.run("And 9+9? Number only.");
console.log("  result:", JSON.stringify(r).slice(0, 160), "link:", JSON.stringify(link()));
console.log("== messages shown to the user:", shown.length);
