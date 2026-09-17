import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, digest, id, boundedText, problem } from './store.mjs';
const stores=new Map();
export function hostStore(root){let s=stores.get(root);if(!s){s=new Store(join(root,'browser-bot','host.sqlite'));stores.set(root,s);}return s;}
export function browserConfig(root){
  let raw;try{raw=readFileSync(join(root,'browser-bot.json'),'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}
  let c;try{c=JSON.parse(raw);}catch{throw new Error('Browser-bot configuration is corrupt; legacy fallback is forbidden');}
  id(c.botId);if(c.version!==1)throw new Error('Unsupported browser-bot protocol');
  for(const name of ['queueWaitMs','executionBudgetMs'])if(c[name]!==undefined&&(!Number.isFinite(c[name])||c[name]<1000||c[name]>86400000))throw new Error(`Invalid browser ${name}`);
  return c;
}
export function isDedicatedBrowserBot(root,botId){return browserConfig(root)?.botId===botId;}
export function parseBrowserRequest(text,{requestId=randomUUID(),human=false}={}){
  const source=boundedText(text),first=source.split(/\r?\n/,1)[0];let rest=first;const tags={};
  while(rest.startsWith('[')){const end=rest.indexOf(']');if(end<0)throw problem('INVALID_HEADER','Unclosed browser job header',400);const tag=rest.slice(1,end),cut=tag.indexOf(':');if(cut<1)break;const k=tag.slice(0,cut).toLowerCase(),v=tag.slice(cut+1);if(['job','request','action'].includes(k)){if(tags[k]!==undefined)throw problem('INVALID_HEADER','Duplicate browser header',400);tags[k]=id(v,k);}rest=rest.slice(end+1).trimStart();}
  if(!human&&!tags.job)throw problem('JOB_HEADER_REQUIRED','Use [job:<id>][request:<id>][action:start|followup] before the browser instruction',400);
  const jobId=tags.job??`user-${requestId}`,action=tags.action??'start';
  if(!['start','followup'].includes(action))throw problem('INVALID_ACTION','Use start or followup',400);
  if(action==='followup'&&!tags.request)throw problem('REQUEST_KEY_REQUIRED','A followup needs a new, stable [request:<id>]',400);
  const task=[rest,...source.split(/\r?\n/).slice(1)].join('\n').trim();
  return{jobId,action,requestId,requestKey:tags.request??`${jobId}:start`,task:boundedText(task)};
}
export function enqueueBrowserJob(root,raw){
  const config=browserConfig(root);if(!config||config.botId!==raw.botId)throw problem('WRONG_BROWSER_BOT','This is not the configured browser bot',403);
  const payload={botId:id(raw.botId),requesterAgentId:id(raw.requesterAgentId),replyTarget:raw.replyTarget===null?null:id(raw.requesterAgentId),jobId:id(raw.jobId),requestId:id(raw.requestId),requestKey:id(raw.requestKey),action:raw.action??'start',task:boundedText(raw.task)};
  if(!['start','followup'].includes(payload.action))throw problem('INVALID_ACTION','Invalid job action',400);
  const key=digest([payload.botId,payload.requesterAgentId,payload.requestKey]);
  // An application retry may have a new transport message id; the business requestKey remains authoritative.
  const hash=digest({...payload,requestId:undefined});const db=hostStore(root);
  return db.transaction(()=>{const old=db.get('inbox',key);if(old){if(old.hash!==hash)throw problem('REQUEST_CONFLICT','requestKey was used for different input');return old;}
    const admittedAt=typeof raw.receivedAt==='number'&&Number.isFinite(raw.receivedAt)?Math.min(Date.now(),raw.receivedAt):Date.now();
    const row={key,hash,payload,state:'queued',createdAt:admittedAt,queueDeadlineMs:admittedAt+(config.queueWaitMs??1_800_000),serviceInstanceId:null,jobKey:null,error:null};
    db.put('inbox',key,row);db.event(`accepted:${key}`,payload.botId,{origin:'browser-job',eventId:`accepted:${key}`,kind:'accepted',jobId:payload.jobId,at:Date.now(),text:`[${payload.jobId}] accepted / queued`});return row;});
}
export function enqueueBrowserCommand(root,botId,raw){const c=browserConfig(root);if(c?.botId!==botId)throw problem('WRONG_BROWSER_BOT','Scope mismatch',403);if(!['answer','cancel','reconcile','followup'].includes(raw.action))throw problem('INVALID_ACTION','Unknown command',400);
  const payload={...raw,actor:'user',jobKey:id(raw.jobKey),requestKey:id(raw.requestKey)};const key=digest([botId,'command',payload.requestKey]);const hash=digest(payload),db=hostStore(root);
  return db.transaction(()=>{const old=db.get('command',key);if(old){if(old.hash!==hash)throw problem('REQUEST_CONFLICT','Command key conflict');return old;}return db.put('command',key,{key,hash,botId,payload,state:'queued',createdAt:Date.now()});});}
export function deliveryIdentity(root,from,to,text){const m=/^\[browser-event:([a-f0-9]{64})\](?:\[job:[A-Za-z0-9._:-]{1,192}\])?\n/.exec(text);if(!m)return null;const key=digest([from,to,m[1]]),db=hostStore(root),hash=digest(text),prior=db.get('delivery',key);if(prior&&prior.hash!==hash)throw problem('DELIVERY_CONFLICT','Event id payload changed');return{key,hash,id:`browser-event-${key}`,accepted:!!prior};}
export function acceptDelivery(root,identity){hostStore(root).put('delivery',identity.key,{hash:identity.hash,acceptedAt:Date.now()});}
