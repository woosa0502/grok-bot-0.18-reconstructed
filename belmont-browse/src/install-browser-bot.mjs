import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { BrowserJobBroker,routeBrowserJobs } from './browser-job-broker.mjs';
import { createBrowserScreen } from './browser-screen.mjs';

export async function jsonBody(req){let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>262144)throw Object.assign(new Error('Browser request too large'),{statusCode:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{statusCode:400});}}
export function jsonReply(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));}

/** Installs the dedicated-mode authority at the existing native execution object, not in a prompt. */
export async function installBrowserBot({server,engine,stateDir,token,serviceIdentity,display,log=console.error}){
  const botId=process.env.BELMONT_BROWSER_BOT_ID;if(!botId)return{close:async()=>{}};
  if(engine.stats().memoryAuthority!=='belmont'||engine.stats().memoryProtocolVersion!==1)throw new Error('Dedicated browser bot requires the canonical-memory daemon');
  const internalKey=randomBytes(32).toString('hex');
  const allowed=new AsyncLocalStorage();const native=engine.A.GlobalAgentSessionServer;const originals=new Map();
  for(const name of ['startRun','steer']){
    const method=native?.[name];if(typeof method!=='function')throw new Error(`Native ${name} guard cannot be installed`);
    const replacement=function(...args){if(allowed.getStore()!==botId)throw new Error('Dedicated browser execution must enter through the job broker');return method.apply(this,args);};
    native[name]=replacement;if(native[name]!==replacement)throw new Error(`Native ${name} is not writable; refusing dedicated mode`);originals.set(name,method);
  }
  const authorized=fn=>(...args)=>allowed.run(botId,()=>fn(...args));
  const invoke=async(id,command,body)=>{
    const address=server.address();if(!address||typeof address==='string')throw new Error('Browser service is not listening');
    const response=await fetch(`http://127.0.0.1:${address.port}/sessions/${encodeURIComponent(id)}/${command}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-belmont-browser-internal':internalKey},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
    const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error?.message??value.error??'Native session command failed'),{code:value.code});return value;
  };
  // Reuse the existing HTTP command contract; do not guess private handle argument shapes.
  const handle=h=>h?new Proxy(h,{get(t,k,r){
    if(k==='continue')return(text,memoryContext)=>invoke(t.id,'continue',{text,memoryContext});
    if(k==='answer')return(response,expectedToolCallId)=>invoke(t.id,'answer',{response,expectedToolCallId});
    if(k==='steer')return text=>invoke(t.id,'steer',{text});
    if(k==='stop')return()=>invoke(t.id,'stop',{});
    const v=Reflect.get(t,k,r);return typeof v==='function'?authorized(v.bind(t)):v;
  }}):h;
  const scopedEngine={get:authorized(id=>handle(engine.get(id))),startSession:authorized(args=>handle(engine.startSession(args))),asideMessages:engine.asideMessages.bind(engine),stats:engine.stats.bind(engine)};
  const broker=new BrowserJobBroker({file:join(stateDir,'browser-jobs.sqlite'),engine:scopedEngine,botId,instanceId:serviceIdentity.instanceId,log});
  const screen=await createBrowserScreen({enabled:process.env.BELMONT_BROWSE_SCREEN==='1',display,instanceId:serviceIdentity.instanceId,botId,token,log});
  const handlers=server.listeners('request');server.removeAllListeners('request');
  server.on('request',async(req,res)=>{
    let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{return jsonReply(res,400,{error:'Invalid URL'});}
    if(req.headers.authorization===`Bearer ${token}` && req.headers['x-belmont-browser-internal']===internalKey && /^\/sessions\/[A-Za-z0-9_-]+\/(?:continue|answer|steer|stop)$/.test(url.pathname)){for(const handler of handlers)allowed.run(botId,()=>handler.call(server,req,res));return;}
    if(url.pathname==='/health'||url.pathname.startsWith('/browser-jobs')||(req.method!=='GET'&&url.pathname.startsWith('/sessions'))){
      if(req.headers.authorization!==`Bearer ${token}`)return jsonReply(res,401,{error:'Unauthorized'});
      try{
        if(url.pathname==='/health')return jsonReply(res,200,{ok:true,...serviceIdentity,engine:engine.version,model:engine.model,...engine.stats(),screen:screen.health(),browserJobs:{version:1,botId,currentJobId:broker.current()?.jobId??null,storeId:broker.storeId}});
        if(url.pathname.startsWith('/sessions'))return jsonReply(res,409,{code:'DEDICATED_BROWSER_JOBS_REQUIRED',error:'Use the browser-job ingress; direct execution is disabled in dedicated mode'});
        await routeBrowserJobs({broker,req,res,url,readBody:jsonBody,json:jsonReply});
      }catch(e){if(!res.headersSent)jsonReply(res,e.statusCode??500,{code:e.code??'BROWSER_JOB_ERROR',error:e.message});else res.destroy();}return;
    }
    for(const handler of handlers)handler.call(server,req,res);
  });
  screen.attach(server);broker.start();
  return{broker,screen,async close(){await broker.close();await screen.close();for(const[name,method]of originals)native[name]=method;}};
}
