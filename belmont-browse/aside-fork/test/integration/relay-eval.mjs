import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
const WSURL = process.argv[2];
const ws = new WebSocket(WSURL);
let id = 1; const pending = new Map();
const call = (method, params={}, sessionId) => new Promise((res,rej)=>{ const i=id++; pending.set(i,{res,rej}); ws.send(JSON.stringify({id:i,method,params,...(sessionId?{sessionId}:{})})); setTimeout(()=>rej(new Error("timeout "+method)),8000); });
ws.on("message",(d)=>{ const m=JSON.parse(d); if(m.id&&pending.has(m.id)){ const{res,rej}=pending.get(m.id); pending.delete(m.id); m.error?rej(new Error(JSON.stringify(m.error))):res(m.result); }});
ws.on("open", async () => {
  try{
    const {targetInfos} = await call("Target.getTargets");
    const sw = targetInfos.find(t=>t.type==="service_worker" && t.url.includes("fjdhphbdlfjogobd"));
    if(!sw){ console.log("Aside SW 없음. 타깃들:", targetInfos.filter(t=>t.type==="service_worker").map(t=>t.url.slice(0,50))); process.exit(0); }
    console.log("Aside SW:", sw.url);
    const {sessionId} = await call("Target.attachToTarget",{targetId:sw.targetId, flatten:true});
    // 원본 확장 컨텍스트에서 네이티브 API 확인 + 실제 서명
    const expr = `(async()=>{
      const has = typeof chrome?.asideAccount?.signDaemonAuthChallenge === 'function';
      let sig=null,err=null;
      try{ sig = await chrome.asideAccount.signDaemonAuthChallenge(btoa('integration-test-'+Date.now())); }catch(e){ err=String(e); }
      const prof = await chrome.asideAccount.getProfiles().catch(e=>'ERR:'+e);
      return JSON.stringify({hasSignFn:has, signResult:sig, signErr:err, profiles:prof});
    })()`;
    const r = await call("Runtime.evaluate",{expression:expr, awaitPromise:true, returnByValue:true}, sessionId);
    console.log("확장 컨텍스트 평가:", r.result?.value || JSON.stringify(r));
  }catch(e){ console.log("EVAL_ERR", String(e)); }
  process.exit(0);
});
ws.on("error",e=>{console.log("WS_ERR",String(e));process.exit(0);});
