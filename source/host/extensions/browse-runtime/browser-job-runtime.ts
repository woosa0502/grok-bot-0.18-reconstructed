import { readFileSync } from 'node:fs';
import { parseSuspensionAnswer, suspensionQuestions } from './browse-suspension.js';
import { parseAutomationWake } from './aside-bot-runner.js';
import { randomUUID } from 'node:crypto';
import { getSandRootDir } from '../../host-paths.js';
import type { RunnerUpdate, SandAgentRunnerResult } from '../../runner/sand-agent-runner.js';
import { BrowseClient } from './browse-client.js';
import { createBrowseMemoryHooks, type BrowseMemoryFacade } from './browse-memory.js';
import { browserConfig, hostStore, parseBrowserRequest, enqueueBrowserJob } from '../../../../shared/browser-bot/host-store.mjs';
import { digest } from '../../../../shared/browser-bot/store.mjs';

type Sender=(from:string,to:string,text:string,images:unknown[],priority:boolean)=>unknown;
type JobView={key:string;jobId:string;status:string;result?:string|null;error?:string|null;[key:string]:unknown};
/** Durable broker adapter. Its timer owns no model session and never replays an unknown dispatch. */
export class BrowserJobRuntime {
  private readonly root=getSandRootDir();
  private readonly store=hostStore(this.root);
  private timer:ReturnType<typeof setTimeout>|undefined;
  private closed=false;
  private ticking=false;
  private readonly hooks=new Map<string,ReturnType<typeof createBrowseMemoryHooks>>();
  constructor(private readonly memory:BrowseMemoryFacade|undefined,private readonly sender:Sender|undefined,private readonly log:(s:string)=>void){}
  start():void {const loop=async()=>{try{await this.tick();}catch(e){this.log(`[browser-jobs] ${e instanceof Error?e.message:String(e)}`);}finally{if(!this.closed){this.timer=setTimeout(()=>void loop(),1000);this.timer.unref?.();}}};this.timer=setTimeout(()=>void loop(),0);this.timer.unref?.();}
  close():void{this.closed=true;if(this.timer)clearTimeout(this.timer);}
  configured(botId:string):boolean{return browserConfig(this.root)?.botId===botId;}
  private client():BrowseClient{
    const config=browserConfig(this.root);
    if(config?.serviceStateFile && !(process.env.SAND_ASIDE_BROWSE_URL&&process.env.SAND_ASIDE_BROWSE_TOKEN)){
      const s=JSON.parse(readFileSync(config.serviceStateFile,'utf8')) as {port?:number;token?:string};
      if(!Number.isInteger(s.port)||!s.port||s.port<1024||s.port>65535||typeof s.token!=='string')throw new Error('Invalid private browse service discovery');
      return new BrowseClient(`http://127.0.0.1:${s.port}`,s.token);
    }
    const c=BrowseClient.fromEnvironment();if(!c)throw new Error('Browse service is unavailable');return c;
  }
  private memoryHooks(botId:string,jobKey:string){
    if(!this.memory?.isCanonical())throw new Error('Dedicated browser jobs require Belmont canonical memory');
    let h=this.hooks.get(jobKey);if(!h){h=createBrowseMemoryHooks(this.memory,{agentId:botId,conversationId:()=>`browser-job:${jobKey}`},this.log);this.hooks.set(jobKey,h);}return h;
  }
  private async tick():Promise<void>{
    if(this.closed||this.ticking)return;this.ticking=true;
    try{
      const config=browserConfig(this.root);if(!config)return;
      await this.deliverOutbox(config.botId);
      const client=this.client();const health=await client.jobHealth();
      if(health.ready===false)throw new Error('Browser service is not ready');
      if(health.memoryAuthority!=='belmont'||health.memoryProtocolVersion!==1||health.browserJobs?.botId!==config.botId)throw new Error('Browser service identity/canonical-memory mismatch');
      this.store.put('meta','service',{...health,observedAt:Date.now()});
      for(const row of this.store.values('inbox')){
        if(this.closed)break;
        if(row.state==='queued'){
          if(Date.now()>=row.queueDeadlineMs){row.state='expired';row.error='QUEUE_WAIT_EXPIRED';this.store.put('inbox',row.key,row);continue;}
          const jobKey=digest([row.payload.botId,row.payload.requesterAgentId,row.payload.jobId]);
          const metadata=await client.jobMemoryMetadata(row.payload.task);
          // Only the browser bot's host-bound memory scope is used. Requester ids are routing metadata,
          // never passed as the memory actor or a request to merge a sender's private memory.
          const memoryContext=await this.memoryHooks(config.botId,jobKey).prepare(row.payload.task,{...metadata,context:{...(metadata.context??{}),browserJobId:row.payload.jobId,browserRequesterId:row.payload.requesterAgentId}});
          row.prepared={...row.payload,memoryContext,expectedInstanceId:health.instanceId,queueWaitMs:Math.max(1000,row.queueDeadlineMs-Date.now()),executionBudgetMs:config.executionBudgetMs??1_800_000};
          row.state='dispatching';row.serviceInstanceId=health.instanceId;this.store.put('inbox',row.key,row);
          try{const result=await client.submitJob(row.prepared);row.state='accepted';row.jobKey=result.jobKey;row.error=null;this.store.put('inbox',row.key,row);}catch(e){row.error=e instanceof Error?e.message:String(e);const rejection=e as {status?:number;code?:string};if(rejection.status===400||rejection.status===403||rejection.code==='JOB_EXISTS'||rejection.code==='REQUEST_CONFLICT'||rejection.code==='CLOSED_JOB')row.state='rejected';if(rejection.code==='INSTANCE_CHANGED')row.state='unknown';this.store.put('inbox',row.key,row);}
        }else if(row.state==='dispatching'){
          const observed=await client.jobReceipt(row.payload.requesterAgentId,row.payload.requestKey);
          if(observed.receipt){row.state='accepted';row.jobKey=observed.receipt.jobKey;row.error=null;this.store.put('inbox',row.key,row);}
          else if(row.serviceInstanceId===health.instanceId){try{const r=await client.submitJob(row.prepared);row.state='accepted';row.jobKey=r.jobKey;this.store.put('inbox',row.key,row);}catch(e){this.log(`[browser-jobs] receipt reconciliation: ${String(e)}`);}}
          else{row.state='unknown';row.error='Service changed and no receipt exists. Automatic resubmission is disabled.';this.store.put('inbox',row.key,row);}
        }
      }
      for(const row of this.store.values('command')){
        if(row.state!=='queued')continue;
        if(row.payload.expectedInstanceId!==health.instanceId){row.state='rejected';row.error='STALE_INSTANCE';this.store.put('command',row.key,row);continue;}
        row.state='dispatching';this.store.put('command',row.key,row);
        try{
          const job=(await client.jobs()).jobs.find((j:JobView)=>j.key===row.payload.jobKey);
          if(!job)throw new Error('Browser job disappeared; command not dispatched');
          if(row.payload.action==='followup'){
            const metadata=await client.jobMemoryMetadata(row.payload.task);
            const memoryContext=await this.memoryHooks(config.botId,job.key).prepare(row.payload.task,metadata);
            await client.submitJob({botId:config.botId,requesterAgentId:job.requesterAgentId,replyTarget:job.replyTarget,jobId:job.jobId,requestId:row.payload.requestKey,requestKey:row.payload.requestKey,action:'followup',task:row.payload.task,memoryContext,expectedInstanceId:health.instanceId});
          }else{
            const command={...row.payload};
            if(command.action==='answer'){
              const suspension=job.suspension;
              if(!suspension||suspension.toolCallId!==command.expectedToolCallId)throw new Error('Stale approval question');
              const answers=command.answerTexts;
              if(!Array.isArray(answers)||answers.some((v:unknown)=>typeof v!=='string'||!v.trim()))throw new Error('An answer is required for each question');
              const questions=suspensionQuestions(suspension.request);
              if(suspension.kind==='ask-user-question'&&questions.length>1){
                if(answers.length!==questions.length)throw new Error('Question count changed');
                command.response={answers:questions.flatMap((q,i)=>(parseSuspensionAnswer(suspension.kind,answers[i],{questions:[q]}) as {answers:unknown[]}).answers)};
              }else{if(answers.length!==1)throw new Error('Exactly one answer is required');command.response=parseSuspensionAnswer(suspension.kind,answers[0],suspension.request);}
            }
            await client.jobCommand(row.payload.jobKey,row.payload.action,command);
          }
          row.state='acknowledged';this.store.put('command',row.key,row);
        }
        catch(e){row.state='unknown';row.error=String(e);this.store.put('command',row.key,row);} // never auto-repeat an approval/steer
      }
      const jobs=await client.jobs();this.store.put('meta','jobs',{botId:config.botId,jobs:jobs.jobs,observedAt:Date.now()});
      let cursor=this.store.get('meta','event-cursor')??{seq:0,storeId:health.browserJobs.storeId};
      if(cursor.storeId!==health.browserJobs.storeId){
        for(const row of this.store.values('inbox'))if(['accepted','dispatching'].includes(row.state)){row.state='unknown';row.error='Browser job database identity changed';this.store.put('inbox',row.key,row);}
        cursor={seq:0,storeId:health.browserJobs.storeId};
      }
      const received=await client.jobEvents(cursor.seq);
      this.store.transaction(()=>{for(const event of received.events){
        this.store.event(event.eventId,config.botId,event);
        if(['waiting-approval','done','error','stopped','expired','unknown'].includes(event.kind)&&event.origin!=='aside-mirror'&&event.replyTarget&&event.replyTarget!==config.botId){
          const payload=`[browser-event:${digest(event.eventId)}][job:${event.jobId}]\n${event.kind}\n${String(event.text??'').slice(0,24000)}`;
          this.store.insert('outbox',event.eventId,{key:event.eventId,botId:config.botId,target:event.replyTarget,text:payload,state:'pending',attempts:0,nextAttempt:0});
        }
        if(event.observation&&event.memoryContext)this.store.insert('memory-outbox',event.eventId,{event,state:'pending'});
        cursor.seq=Math.max(cursor.seq,event.seq);
      }this.store.put('meta','event-cursor',cursor);});
      // Mirror events never enter inference/transcript mutation hooks. Only typed native observations
      // take the existing, canonical idempotent ingestion path.
      for(const item of this.store.values('memory-outbox')){
        if(item.state!=='pending')continue;const event=item.event;
        try{const h=this.memoryHooks(config.botId,event.jobKey);await h.validate(event.memoryContext);
          const binding=event.memoryContext,observation=event.observation;
          if(binding.agentId!==config.botId||binding.conversationId!==`browser-job:${event.jobKey}`)throw new Error('Memory job scope mismatch');
          if(typeof binding.ownerKey!=='string')throw new Error('Canonical owner key is absent');
          if(observation.experience)await this.memory!.ingestAsideOutcome({agentId:config.botId,conversationId:binding.conversationId,ownerKey:binding.ownerKey,experience:observation.experience,expectedEpoch:binding.expectedEpoch,...(binding.procedure?.id?{procedureId:binding.procedure.id}:{})});
          else await this.memory!.captureAsideObservation({agentId:config.botId,conversationId:binding.conversationId,ownerKey:binding.ownerKey,eventId:observation.eventId,at:observation.at,content:JSON.stringify(observation),expectedEpoch:binding.expectedEpoch});
          item.state='accepted';this.store.put('memory-outbox',event.eventId,item);
        }catch(e){this.log(`[browser-jobs] memory observation retained for retry: ${String(e)}`);}
      }
      while(this.hooks.size>256)this.hooks.delete(this.hooks.keys().next().value!);
      await this.deliverOutbox(config.botId);
    }finally{this.ticking=false;}
  }
  private async deliverOutbox(botId:string):Promise<void>{
    if(!this.sender)return;
    for(const row of this.store.values('outbox')){if(row.state!=='pending'||row.nextAttempt>Date.now())continue;
      try{const ack=await this.sender(botId,row.target,row.text,[],false);if(typeof ack!=='string'||!ack.startsWith('Sent to ')||ack.includes('warning:'))throw new Error(String(ack));row.state='accepted';row.error=null;}
      catch(e){row.attempts++;row.error=String(e);row.nextAttempt=Date.now()+Math.min(60_000,1000*2**Math.min(6,row.attempts));}
      this.store.put('outbox',row.key,row);
    }
  }
  run(botId:string,prompt:string,options:Record<string,unknown>={}):Promise<SandAgentRunnerResult>{
    return this.runImpl(botId,prompt,options);
  }
  private async runImpl(botId:string,prompt:string,options:Record<string,unknown>):Promise<SandAgentRunnerResult>{
    if(!this.configured(botId))throw new Error('Browser bot is not registered');
    if(options.upgradeResume===true)return{text:'Browser job state was preserved; automatic execution replay is disabled.',sentMessageCount:0,reacted:false,aborted:true};
    // Hidden generic reminders must not become new jobs. Peer messages enter through the trusted
    // sendToAgent intake hook; automation occurrences need the separately fixed occurrence id.
    const inbound=options.browserInbound as {fromAgentId?:string;requestId?:string;text?:string;receivedAt?:number}|undefined;
    if(options.hidden===true&&inbound){
      if(!inbound.fromAgentId||!inbound.requestId||typeof inbound.text!=='string')throw new Error('Trusted inbound identity is missing');
      const parsed=parseBrowserRequest(inbound.text,{requestId:inbound.requestId});
      const row=enqueueBrowserJob(this.root,{...parsed,botId,requesterAgentId:inbound.fromAgentId,replyTarget:inbound.fromAgentId,receivedAt:inbound.receivedAt});
      return{text:`[${row.payload.jobId}] accepted / queued`,sentMessageCount:0,reacted:true,aborted:false};
    }
    const wake=options.automationWake as {id?:string;name?:string;browserRequestId?:string;browserTask?:string}|undefined;
    if(options.hidden===true&&!wake)return{text:'',sentMessageCount:0,reacted:true,aborted:false};
    if(wake&&!wake.browserRequestId)throw new Error('Routine occurrence identity is not wired; refusing an unkeyed browser automation');
    const requestId=wake?.browserRequestId??(typeof options.messageId==='string'?options.messageId:typeof options.requestId==='string'?options.requestId:randomUUID());
    const input=parseBrowserRequest((wake?parseAutomationWake(prompt):null)??prompt,{requestId,human:true});
    if(wake){input.jobId=`routine-${wake.id}-${requestId}`;input.requestKey=input.jobId;}
    const accepted=enqueueBrowserJob(this.root,{...input,botId,requesterAgentId:'user',replyTarget:null});
    if(!wake)return{text:`[${input.jobId}] accepted / queued; follow the browser job panel.`,sentMessageCount:0,reacted:true,aborted:false};
    // A routine is not reported completed merely because its request was accepted. This wait owns
    // no model call; independent peer/PWA submissions bypass the host turn lane via durable intake.
    while(!this.closed){const inbox=this.store.get('inbox',accepted.key);const views=this.store.get('meta','jobs')?.jobs??[];const j=views.find((v:JobView)=>v.key===inbox?.jobKey) as JobView|undefined;
      if(j&&['done','error','stopped','interrupted','expired','unknown'].includes(j.status))return{text:j.result??j.error??j.status,sentMessageCount:0,reacted:false,aborted:j.status!=='done'};
      if(inbox&&['expired','unknown'].includes(inbox.state))return{text:inbox.error??inbox.state,sentMessageCount:0,reacted:false,aborted:true};
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    return{text:'Browser job remains persisted for reconciliation.',sentMessageCount:0,reacted:false,aborted:true};
  }
  interrupt(botId:string,reason:string):boolean{
    if(/superseded/i.test(reason))return true;
    const j=(this.store.get('meta','jobs')?.jobs??[]).find((j:JobView)=>['running','starting','waiting-approval'].includes(j.status));
    const health=this.store.get('meta','service');if(j&&health){const key=randomUUID();this.store.put('command',key,{key,botId,payload:{jobKey:j.key,action:'cancel',actor:'user',requestKey:key,expectedInstanceId:health.instanceId},state:'queued',createdAt:Date.now()});}
    return true;
  }
  wrapper<T extends object>(runner:T,botId:string,emit:(u:RunnerUpdate)=>void):T{
    const runtime=this;return new Proxy(runner,{get(target,key,receiver){
      if(key==='run')return async(prompt:string,options?:Record<string,unknown>)=>{const r=await runtime.run(botId,prompt,options);if(r.text){emit({type:'send-message',message:{type:'text',content:r.text,origin:'browser-job'},timestampMs:Date.now()});return{...r,sentMessageCount:1};}return r;};
      if(key==='interrupt')return(reason:string)=>runtime.interrupt(botId,reason);
      if(key==='wouldRecoverViaPrepend')return undefined;
      const v=Reflect.get(target,key,receiver);return typeof v==='function'?v.bind(target):v;
    }});
  }
}
