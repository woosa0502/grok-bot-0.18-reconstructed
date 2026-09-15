import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const REPO="/home/hoon/_roots/labs/work/Belmont";
const { createEvaluationApi } = await import(pathToFileURL(path.join(REPO,"belmont-browse/src/procedure-evaluation.mjs")).href);
const SP=process.argv[2]; const STATE=path.join(REPO,"belmont-browse/.state");
const api=createEvaluationApi(JSON.parse(fs.readFileSync(path.join(STATE,"serve.json"),"utf8")));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TERMINAL=new Set(["done","error","stopped","interrupted"]);
// count host bwrap processes (the sandbox namespace init is host-visible even though its children are not)
function bwrapCount(){let n=0;for(const d of fs.readdirSync("/proc")){if(!/^\d+$/.test(d))continue;try{const c=fs.readFileSync(`/proc/${d}/comm`,"utf8").trim();if(c==="bwrap")n++;}catch{}}return n;}
const view=id=>api("GET",`/sessions/${id}`);
async function waitFor(id,pred,t,e=500){const t0=Date.now();let v;do{v=await view(id);if(pred(v))return v;await sleep(e);}while(Date.now()-t0<t);return v;}
const base=bwrapCount();
const c=await api("POST","/sessions",{task:`Run this one bash command and nothing else (do not reply until it ends): sleep 300 & ( sleep 300 & ) ; wait`,model:"gpt-5.5",thinking:"high",mode:"guard",autoApprove:false});
let during=base; for(let i=0;i<40;i++){during=bwrapCount();if(during>base)break;await sleep(1000);}
const runningStatus=(await view(c.id))?.status;
await api("POST",`/sessions/${c.id}/stop`,{});
const term=await waitFor(c.id,v=>TERMINAL.has(v?.status),15000,500);
await sleep(4000);
const after=bwrapCount();
const out={case:"l18-shell-tree-bwrap-r5",at:new Date().toISOString(),
  gate:"bash runs in a bwrap --unshare-pid namespace (internals host-invisible by design); on cancel the sandbox namespace is torn down, reaping the whole tree atomically",
  evidence:{sessionId:c.id,bwrapBaseline:base,bwrapDuringRun:during,sandboxSpawned:during>base,runningStatus,finalStatus:term?.status,bwrapAfterStop:after,sandboxReaped:after<=base},
  verdict_pass: during>base && TERMINAL.has(term?.status) && after<=base};
fs.writeFileSync(path.join(SP,"ev-l18-shell-tree-r5.json"),JSON.stringify(out,null,2));
console.log(JSON.stringify(out.evidence)); console.log("PASS:",out.verdict_pass);
