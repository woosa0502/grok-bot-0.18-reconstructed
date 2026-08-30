import { ModelRuntime } from "@earendil-works/pi-coding-agent";
const rt = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
const prov = "openai-codex";
const all = rt.getModels(prov);
console.log("codex models:", all.length);
for (const m of all.slice(0, 12)) console.log(String(m.id).padEnd(16), "ctxWindow=", m.contextWindow, " maxOut=", m.maxTokens, " reasoning=", m.reasoning);
