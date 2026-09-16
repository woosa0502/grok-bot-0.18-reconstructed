import { randomUUID } from 'node:crypto';
import { Store, boundedText, digest, id, problem } from '../../shared/browser-bot/store.mjs';

const TERMINAL = new Set(['done','error','stopped','interrupted','expired']);
const BLOCKING = new Set(['starting','running','waiting-approval','stopping','unknown']);
const keyFor = r => digest([r.botId,r.requesterAgentId,r.requestKey]);
const jobFor = r => digest([r.botId,r.requesterAgentId,r.jobId]);
function positive(v, d) { if (v === undefined) return d; if (!Number.isFinite(v) || v < 1000 || v > 86_400_000) throw problem('INVALID_LIMIT','Budget must be between 1 second and 24 hours',400); return v; }

/** Service-side, durable single-browser arbiter. All side-effect intents precede execution. */
export class BrowserJobBroker {
  constructor({ file, engine, botId, instanceId, now = Date.now, log = console.error }) {
    this.store = new Store(file); this.engine=engine; this.botId=id(botId,'botId'); this.instanceId=id(instanceId,'instanceId');
    this.now=now; this.log=log; this.busy=false; this.closed=false; this.timer=null;
    this.storeId=this.store.get('meta','store-id')?.id??randomUUID(); this.store.put('meta','store-id',{id:this.storeId});
    // Old process absence is NOT non-execution evidence. Never re-dispatch an old intent.
    this.store.transaction(() => {
      for (const j of this.store.values('job')) {
        if (BLOCKING.has(j.status) && j.lastServiceInstance !== instanceId) {
          j.status='unknown'; j.error='SERVICE_RESTART_REQUIRES_RECONCILIATION';
          this.store.put('job',j.key,j); this.emit(j,'unknown','Service restarted. Existing execution must be reconciled; it will not be replayed.');
        }
      }
    });
  }
  emit(j, kind, text, extra={}) {
    const revision=(j.eventRevision??0)+1; j.eventRevision=revision;
    const eventId=digest([j.key,revision,kind]);
    this.store.put('job',j.key,j);
    this.store.event(eventId,j.botId,{eventId,origin:'browser-job',kind,jobKey:j.key,jobId:j.jobId,requesterAgentId:j.requesterAgentId,replyTarget:j.replyTarget,requestId:j.requestId,at:this.now(),text,...extra});
  }
  view(j) {
    if (!j) return null;
    const { key,botId,jobId,requesterAgentId,requestId,replyTarget,asideSessionId,status,createdAt,queueDeadlineMs,runningMs,error,result,originInstanceId,lastServiceInstance,suspension }=j;
    return {key,botId,jobId,requesterAgentId,requestId,replyTarget,asideSessionId,status,createdAt,queueDeadlineMs,runningMs,error,result,originInstanceId,lastServiceInstance,suspension};
  }
  receipt(requesterAgentId,requestKey) { return this.store.get('request',keyFor({botId:this.botId,requesterAgentId:id(requesterAgentId),requestKey:id(requestKey)})); }
  submit(raw) {
    if (this.closed) throw problem('BROKER_CLOSED','Browser broker is closing',503);
    if (raw.botId !== this.botId) throw problem('WRONG_BROWSER_BOT','Browser bot scope mismatch',403);
    const r={botId:this.botId,requesterAgentId:id(raw.requesterAgentId),requestId:id(raw.requestId),requestKey:id(raw.requestKey),jobId:id(raw.jobId),task:boundedText(raw.task),action:raw.action??'start',memoryContext:raw.memoryContext};
    if (!['start','followup'].includes(r.action)) throw problem('INVALID_ACTION','Use start or followup',400);
    if (raw.replyTarget !== r.requesterAgentId && raw.replyTarget !== null) throw problem('INVALID_REPLY_TARGET','A request cannot redirect its result to another bot',403);
    const rk=keyFor(r),hash=digest({...r,replyTarget:raw.replyTarget??null});
    return this.store.transaction(() => {
      const prior=this.store.get('request',rk);
      if (prior) { if(prior.hash!==hash) throw problem('REQUEST_CONFLICT','requestKey already identifies different input'); return {...prior,job:this.view(this.store.get('job',prior.jobKey))}; }
      if (raw.expectedInstanceId!==this.instanceId) throw problem('INSTANCE_CHANGED','Refresh service identity before a NEW submission');
      const jk=jobFor(r); let j=this.store.get('job',jk);
      if (r.action==='start' && j) throw problem('JOB_EXISTS','Use a new requestKey with action=followup for this job');
      if (r.action==='followup' && !j) throw problem('JOB_NOT_FOUND','Followup must name an existing job',404);
      if (j && ['stopped','expired'].includes(j.status)) throw problem('CLOSED_JOB','A cancelled/expired job needs a new job id');
      if (j?.status==='unknown') throw problem('UNKNOWN_EXECUTION','Reconcile unknown execution before continuing');
      if (!j) {
        j={key:jk,botId:r.botId,jobId:r.jobId,requesterAgentId:r.requesterAgentId,requestId:r.requestId,replyTarget:raw.replyTarget??null,
          asideSessionId:null,status:'queued',createdAt:this.now(),queueDeadlineMs:this.now()+positive(raw.queueWaitMs,30*60_000),
          executionBudgetMs:positive(raw.executionBudgetMs,30*60_000),runningMs:0,lastObservedAt:this.now(),originInstanceId:this.instanceId,lastServiceInstance:this.instanceId,
          task:r.task,memoryContext:r.memoryContext,error:null,result:null,suspension:null,eventRevision:0,command:null};
        this.store.put('job',jk,j);
      }
      const request={key:rk,hash,jobKey:jk,requestId:r.requestId,requesterAgentId:r.requesterAgentId,requestKey:r.requestKey,state:'queued',action:r.action,task:r.task,memoryContext:r.memoryContext,createdAt:this.now()};
      this.store.put('request',rk,request);
      this.emit(j,'accepted',`[${j.jobId}] accepted / queued`,{requestKey:r.requestKey});
      return {...request,job:this.view(j)};
    });
  }
  get(jobKey) { return this.view(this.store.get('job',id(jobKey))); }
  list() { return this.store.values('job').map(j=>this.view(j)); }
  current() { return this.store.values('job').find(j=>BLOCKING.has(j.status))??null; }
  events(after=0) { return this.store.events(this.botId,after); }
  answer(jobKey, raw) {
    return this.store.transaction(()=>{
      const j=this.store.get('job',id(jobKey)); if(!j) throw problem('JOB_NOT_FOUND','Unknown browser job',404);
      const opKey=digest([j.key,'answer',id(raw.requestKey)]),hash=digest(raw);
      const old=this.store.get('operation',opKey); if(old) { if(old.hash!==hash) throw problem('REQUEST_CONFLICT','Answer requestKey conflict'); return this.view(j); }
      if(raw.expectedInstanceId!==this.instanceId || raw.expectedSessionId!==j.asideSessionId) throw problem('STALE_ANSWER','Browser identity changed');
      if(j.status!=='waiting-approval' || !j.suspension?.toolCallId || raw.expectedToolCallId!==j.suspension.toolCallId) throw problem('STALE_ANSWER','The question is no longer current');
      if(raw.actor!=='user') throw problem('USER_APPROVAL_REQUIRED','Delegating bots cannot answer user approval',403);
      if(j.command) throw problem('COMMAND_PENDING','A prior command is still pending');
      this.store.put('operation',opKey,{key:opKey,hash,state:'queued'});
      j.command={kind:'answer',opKey,response:raw.response,expectedToolCallId:raw.expectedToolCallId}; this.store.put('job',j.key,j);
      return this.view(j);
    });
  }
  cancel(jobKey, raw) {
    return this.store.transaction(()=>{
      const j=this.store.get('job',id(jobKey)); if(!j) throw problem('JOB_NOT_FOUND','Unknown browser job',404);
      if(raw.actor!=='user' && raw.actor!==j.requesterAgentId) throw problem('WRONG_OWNER','Cannot cancel another requester job',403);
      if(TERMINAL.has(j.status)) return this.view(j);
      if(j.status==='queued') { j.status='stopped'; this.store.put('job',j.key,j); this.emit(j,'stopped','Cancelled before dispatch'); return this.view(j); }
      if(raw.expectedInstanceId!==this.instanceId) throw problem('INSTANCE_CHANGED','Refresh identity before cancelling');
      j.command={kind:'stop',opKey:digest([j.key,'stop',id(raw.requestKey)])}; this.store.put('job',j.key,j);return this.view(j);
    });
  }
  /** Explicit observation-only recovery. This never starts, answers or steers a native session. */
  reconcile(jobKey) {
    const j=this.store.get('job',id(jobKey)); if(!j) throw problem('JOB_NOT_FOUND','Unknown job',404);
    if(!j.asideSessionId) return this.view(j);
    const h=this.engine.get(j.asideSessionId);
    if(!h) {j.status='unknown';j.error='SESSION_MISSING_NO_REPLAY';this.store.put('job',j.key,j);return this.view(j);}
    const v=h.toJSON();
    if(v.status==='interrupted' || v.errorCode==='STOP_FAILED') return this.view(j);
    // Explicit operator action only. Recovered terminal state is not evidence of an unexecuted job.
    j.lastServiceInstance=this.instanceId; j.lastObservedAt=this.now(); j.error=null;
    this.observe(j,v); return this.view(j);
  }
  observe(j,v) {
    const prior=j.status,now=this.now();
    if(prior==='running') j.runningMs+=Math.max(0,now-j.lastObservedAt);
    j.lastObservedAt=now;
    if(v.errorCode==='STOP_FAILED' || v.status==='interrupted') {j.status='unknown';j.error=v.error??v.errorCode;}
    else if(v.status==='suspended') {j.status='waiting-approval';j.suspension=v.suspension;}
    else if(v.status==='queued') j.status='starting';
    else j.status=v.status;
    j.result=v.result??j.result;j.error=v.error??j.error;
    if(j.status!=='waiting-approval') j.suspension=null;
    this.store.transaction(()=>{
      this.store.put('job',j.key,j);
      if(prior!==j.status) this.emit(j,j.status,j.result??j.error??`[${j.jobId}] ${j.status}`,{suspension:j.suspension,observation:v.memoryObservation??null,memoryContext:v.memoryContext??null});
    });
  }
  async mirror(j) {
    if(!j.asideSessionId || (!TERMINAL.has(j.status) && j.status!=='waiting-approval')) return;
    const rows=await this.engine.asideMessages(j.asideSessionId,0);
    this.store.transaction(()=>{for(const m of rows){
      if(typeof m.id!=='string'||!m.id) { this.log('[browser-jobs] native message without stable id: not mirrored'); continue; }
      const mirrorId=digest([j.originInstanceId,j.asideSessionId,m.id]);
      this.store.event(mirrorId,j.botId,{eventId:mirrorId,origin:'aside-mirror',kind:'message',jobKey:j.key,jobId:j.jobId,instanceId:j.originInstanceId,asideSessionId:j.asideSessionId,messageId:m.id,role:m.role,text:m.text,at:m.timestamp});
    }});
  }
  async tick() {
    if(this.closed||this.busy) return; this.busy=true;
    try {
      let current=this.current();
      if(current) {
        if(current.status==='unknown' && current.command?.kind!=='stop') return; // global hold: the old execution might still be acting
        const h=current.asideSessionId?this.engine.get(current.asideSessionId):null;
        if(!h) {current.status='unknown';current.error='SESSION_MISSING_NO_REPLAY';this.store.transaction(()=>this.emit(current,'unknown',current.error));return;}
        if(current.command) {
          const command=current.command; current.command=null;
          // An unacknowledged mutation remains unknown after a crash, never replayed.
          current.status=command.kind==='stop'?'stopping':'starting';
          this.store.transaction(()=>{this.store.put('job',current.key,current);this.store.put('operation',command.opKey,{...(this.store.get('operation',command.opKey)??{}),state:'intent',kind:command.kind});});
          try {
            if(command.kind==='answer') await h.answer(command.response,command.expectedToolCallId); else await h.stop();
            this.store.put('operation',command.opKey,{...(this.store.get('operation',command.opKey)??{}),state:'acknowledged',kind:command.kind});
          } catch(error) {current.status='unknown';current.error=String(error.message);this.store.transaction(()=>this.emit(current,'unknown','Native command outcome needs reconciliation'));return;}
        }
        this.observe(current,h.toJSON());await this.mirror(current);
        if(current.status==='running' && current.runningMs>=current.executionBudgetMs) {
          current.command={kind:'stop',opKey:digest([current.key,'execution-budget'])};this.store.put('job',current.key,current);return;
        }
        if(BLOCKING.has(current.status)) {
          // Only a same-job followup may become a steer. Never steer across jobs.
          if(current.status==='running') {
            const r=this.store.values('request').find(r=>r.jobKey===current.key&&r.state==='queued'&&r.action==='followup');
            if(r) await this.dispatch(current,r,h);
          }
          return;
        }
      }
      const now=this.now();
      for(const j of this.store.values('job')) if(j.status==='queued' && now>=j.queueDeadlineMs) {j.status='expired';this.store.transaction(()=>this.emit(j,'expired','Queue waiting budget expired; no browser execution started'));}
      if ((this.engine.stats?.().running??0)>0) return; // do not overlap a native drain
      const r=this.store.values('request').filter(r=>r.state==='queued').sort((a,b)=>a.createdAt-b.createdAt).find(r=>{
        const j=this.store.get('job',r.jobKey);return j&&(j.status==='queued'||(r.action==='followup'&&TERMINAL.has(j.status)&&j.status!=='expired'&&j.status!=='stopped'));
      });
      if(r) {const j=this.store.get('job',r.jobKey);await this.dispatch(j,r,j.asideSessionId?this.engine.get(j.asideSessionId):null);}
    } finally {this.busy=false;}
  }
  async dispatch(j,r,h) {
    if(r.action==='followup' && !h) {j.status='unknown';j.error='SESSION_MISSING_NO_REPLAY';this.store.transaction(()=>this.emit(j,'unknown',j.error));return;}
    // Reserve the intent BEFORE the existing engine allocates its native id. A crash in
    // this small gap is deliberately UNKNOWN, not permission to create another session.
    if(r.action==='start')j.originInstanceId=this.instanceId;
    j.lastServiceInstance=this.instanceId;j.lastObservedAt=this.now();
    const wasRunning=j.status==='running';j.status='starting';r.state='intent';
    this.store.transaction(()=>{this.store.put('request',r.key,r);this.store.put('job',j.key,j);});
    try {
      if(r.action==='start') { h=this.engine.startSession({task:r.task,mode:'guard',autoApprove:false,memoryContext:r.memoryContext}); j.asideSessionId=h.id; this.store.put('job',j.key,j); }
      else if(wasRunning) await h.steer(r.task);
      else await h.continue(r.task,r.memoryContext);
      r.state='acknowledged';this.store.put('request',r.key,r);
      this.observe(j,h.toJSON());
    } catch(error) {j.status='unknown';j.error=String(error.message);this.store.transaction(()=>this.emit(j,'unknown','Native dispatch outcome is unknown; automatic replay is disabled'));}
  }
  start(intervalMs=1000) {
    const loop=async()=>{try{await this.tick();}catch(e){this.log(`[browser-jobs] tick: ${e.message}`);}finally{if(!this.closed){this.timer=setTimeout(loop,intervalMs);this.timer.unref?.();}}};
    this.timer=setTimeout(loop,0);this.timer.unref?.();
  }
  async close() {this.closed=true;clearTimeout(this.timer);while(this.busy) await new Promise(r=>setTimeout(r,10));this.store.close();}
}

export async function routeBrowserJobs({broker,req,res,url,readBody,json}) {
  const p=url.pathname.split('/').filter(Boolean);
  if(p[0]!=='browser-jobs') return false;
  if(req.method==='GET'&&p.length===1){json(res,200,{jobs:broker.list()});return true;}
  if(req.method==='POST'&&p.length===1){json(res,202,broker.submit(await readBody(req)));return true;}
  if(req.method==='GET'&&p[1]==='events'){json(res,200,{events:broker.events(Number(url.searchParams.get('after')??0))});return true;}
  if(req.method==='GET'&&p[1]==='receipt'){json(res,200,{receipt:broker.receipt(url.searchParams.get('requester'),url.searchParams.get('key'))});return true;}
  if(req.method==='GET'&&p.length===2){const j=broker.get(p[1]);json(res,j?200:404,j??{code:'JOB_NOT_FOUND'});return true;}
  if(req.method==='POST'&&p.length===3){const body=await readBody(req);let result;
    if(p[2]==='answer')result=broker.answer(p[1],body);
    else if(p[2]==='cancel')result=broker.cancel(p[1],body);
    else if(p[2]==='reconcile'&&body.actor==='user')result=broker.reconcile(p[1]);
    else throw problem('INVALID_COMMAND','Unknown browser job command',400);
    json(res,200,result);return true;
  }
  throw problem('NOT_FOUND','Unknown browser job endpoint',404);
}
