import { useEffect, useRef, useState } from 'react';
import { MessageContent } from './MessageContent';
import { BabyGrokAvatar } from './BabyGrokAvatar';
import { Icon } from './Icon';
import type { Bot } from '../types';

type Job={key:string;jobId:string;requesterAgentId:string;status:string;error?:string;result?:string;asideSessionId?:string;suspension?:{kind:string;toolCallId:string;description:string;request?:{questions?:{header?:string;question:string;options?:unknown[]}[]}}};
type Event={seq:number;eventId:string;origin:string;kind:string;jobKey?:string;jobId:string;role?:string;text:string;at:number};
type State={service?:{instanceId:string;observedAt:number};jobs:Job[];inbox:{key:string;jobId:string;state:string;error?:string}[];events:Event[];commands:{key:string;state:string;error?:string}[]};
async function api(path:string,body?:unknown){const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(v.error?.message??v.error??v.message??`${r.status}`);return v;}

// A browser-job lifecycle event is a status marker, not a chat turn. Only aside-mirror events carry
// the real Aside conversation, so those render as bubbles and lifecycle events as compact chips.
const KIND_LABEL:Record<string,string>={accepted:'접수 · 대기',running:'실행 중',done:'완료',error:'오류',stopped:'중단됨',expired:'만료',unknown:'확인 필요','waiting-approval':'승인 대기',queued:'대기',dispatching:'전달 중'};
const KIND_CLASS:Record<string,string>={done:'done',error:'error',expired:'error',unknown:'error',stopped:'error',running:'running','waiting-approval':'waiting'};
const KIND_SHOW_TEXT=new Set(['error','expired','unknown','stopped']); // show the reason inline; results live in the mirror bubble
const time=(ms:number)=>new Date(ms).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
// Aside step trail line: "HH:MM:SS <tool> <args|-> result>". Turn it into a readable activity row.
function parseStep(text:string){const s=String(text||'');const m=/^(\d{2}:\d{2}:\d{2})\s+([A-Za-z_]+)\s*([\s\S]*)$/.exec(s);const tool=m?.[2]||'';let rest=(m?.[3]||'').trim();const isResult=rest.startsWith('->');if(isResult)rest=rest.slice(2).trim();let label=tool,icon='•';
  if(tool==='repl'){icon='🔧';if(!isResult){try{label=JSON.parse(rest).title||'브라우저 실행';}catch{label='브라우저 실행';}}else{label=rest.replace(/\s+/g,' ');}}
  else if(tool==='memory_search'){icon='🔍';label='메모리 검색';}
  else if(tool==='ERROR'){icon='⚠';label=rest||'오류';}
  else{label=(rest||tool).replace(/\s+/g,' ');}
  return {icon,label:label.slice(0,220),isResult};}

export function BrowserBotChat({bot,onBack,onComputer}:{bot:Bot;onBack?:()=>void;onComputer?:()=>void}){
  const botId=bot.id;
  const [state,setState]=useState<State>({jobs:[],inbox:[],events:[],commands:[]});const [error,setError]=useState('');const [selected,setSelected]=useState('new');const [task,setTask]=useState('');const [sending,setSending]=useState(false);const [answers,setAnswers]=useState<string[]>([]);const [names,setNames]=useState<Record<string,string>>({});
  const pending=useRef<{key:string;task:string;selected:string}|null>(null);const cursor=useRef(0);const seen=useRef(new Map<string,Event>());const base=`/api/bots/${encodeURIComponent(botId)}/browser`;
  const bodyRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{let closed=false;let timer:ReturnType<typeof setTimeout>;cursor.current=0;seen.current.clear();const poll=async()=>{try{const data:State=await api(`${base}/state?after=${cursor.current}`);if(closed)return;for(const e of data.events){seen.current.set(e.eventId,e);cursor.current=Math.max(cursor.current,e.seq);}setState({...data,events:[...seen.current.values()].sort((a,b)=>(a.at||0)-(b.at||0)||a.seq-b.seq)});setError('');}catch(e){if(!closed)setError(String(e));}finally{if(!closed)timer=setTimeout(()=>void poll(),1500);}};void poll();return()=>{closed=true;clearTimeout(timer);};},[base]);
  // Requester ids on jobs are raw agent ids; map them to bot names so it is clear which bot delegated.
  useEffect(()=>{let alive=true;api('/api/bots').then(r=>{if(!alive)return;const m:Record<string,string>={};for(const b of (r.bots??r??[]))if(b?.id)m[b.id]=b.name??b.id;setNames(m);}).catch(()=>{});return()=>{alive=false;};},[]);
  const who=(id?:string)=>!id?'':id==='user'?'직접':(names[id]??`${id.slice(0,8)}…`);
  const requesterFor=(jobId?:string)=>state.jobs.find(j=>j.jobId===jobId)?.requesterAgentId;
  const current=state.jobs.find(j=>j.key===selected);useEffect(()=>setAnswers([]),[current?.suspension?.toolCallId]);
  const shown=state.events.filter(e=>selected==='new'||e.jobKey===selected||e.jobId===current?.jobId);
  useEffect(()=>{const el=bodyRef.current;if(el)el.scrollTop=el.scrollHeight;},[shown.length,current?.status]);
  const submit=async()=>{if(!task.trim()||sending)return;setSending(true);try{
    const p=pending.current?.task===task&&pending.current?.selected===selected?pending.current:{key:crypto.randomUUID(),task,selected};pending.current=p;
    if(current)await api(`${base}/commands`,{action:'followup',jobKey:current.key,requestKey:p.key,expectedInstanceId:state.service?.instanceId,task});
    else await api(`${base}/requests`,{jobId:`user-${p.key}`,requestId:p.key,requestKey:p.key,action:'start',task});
    pending.current=null;setTask('');setError('');
  }catch(e){setError(`${String(e)} · 다시 보내기는 동일 요청 키를 사용합니다.`);}finally{setSending(false);}};
  const command=async(action:string,extra:Record<string,unknown>={})=>{if(!current||sending)return;setSending(true);try{await api(`${base}/commands`,{action,jobKey:current.key,requestKey:crypto.randomUUID(),expectedInstanceId:state.service?.instanceId,expectedSessionId:current.asideSessionId,expectedToolCallId:current.suspension?.toolCallId,...extra});setError('');}catch(e){setError(String(e));}finally{setSending(false);}};
  const stale=!state.service||Date.now()-state.service.observedAt>10000;
  const pendingInbox=state.inbox.filter(r=>['queued','dispatching','unknown','expired'].includes(r.state));
  const badCommands=state.commands.filter(c=>['unknown','rejected'].includes(c.state));
  const running=!!current&&['running','starting','dispatching','queued','unknown'].includes(current.status);
  const canSend=!!task.trim()&&!sending&&current?.status!=='unknown';
  return <main className="chat-screen">
    <header className="chat-toolbar">
      {onBack&&<button aria-label="홈으로" className="circle-button" onClick={onBack} type="button"><Icon name="back" size={22}/></button>}
      <span className="chat-identity" aria-label={bot.name}><BabyGrokAvatar color={bot.avatar.color} shape={bot.avatar.shape} size={38} state={bot.characterState??(state.jobs.some(j=>['running','starting'].includes(j.status))?'working':'idle')}/><strong>{bot.name}</strong></span>
      <div className="chat-actions">
        {onComputer&&<button aria-label="실시간 화면 보기" className="circle-button" onClick={onComputer} type="button"><Icon name="display" size={20}/></button>}
      </div>
    </header>

    <div className="transcript" ref={bodyRef} aria-live="polite">
      <div className="bb-jobbar">
        <select className="bb-select" value={selected} onChange={e=>setSelected(e.target.value)} aria-label="작업 선택">
          <option value="new">새 작업 · 전체 대화</option>
          {state.jobs.map(j=><option key={j.key} value={j.key}>{j.jobId} · {KIND_LABEL[j.status]??j.status} · {who(j.requesterAgentId)}</option>)}
        </select>
      </div>
      {current
        ? <p className="bb-note"><b>요청: {who(current.requesterAgentId)}</b> · 이 작업을 이어갑니다. 새 의뢰는 위에서 "새 작업"을 고르세요.</p>
        : <p className="bb-note">새 의뢰는 새 Aside 대화로 실행됩니다. 다른 봇이 지시한 작업도 여기에 함께 뜹니다.</p>}
      {stale&&<p className="bb-banner warn">브라우저 서비스 상태 미확인 · 접수와 실제 실행은 별개입니다.</p>}
      {error&&<p className="bb-banner error" role="alert">{error}</p>}
      {pendingInbox.map(r=><p className="bb-banner warn" key={r.key}>{r.jobId}: {KIND_LABEL[r.state]??r.state}{r.error?` · ${r.error}`:''}</p>)}
      {badCommands.map(c=><p className="bb-banner error" key={c.key} role="alert">명령 {c.state}: {c.error} · 실행 상태를 확인한 뒤 다시 보내세요.</p>)}

      {shown.length===0
        ? <p className="bb-empty">아직 대화가 없습니다.<br/>아래에 웹 작업을 적어 보내 보세요.</p>
        : <div className="bb-thread">{shown.map(e=>{
            if(e.origin==='aside-mirror'&&e.kind==='step'){const p=parseStep(e.text);return <div className={`bb-act ${p.isResult?'result':''}`} key={e.eventId}><span className="bb-act-icon" aria-hidden="true">{p.icon}</span><span className="bb-act-text">{p.label}</span></div>;}
            if(e.origin==='aside-mirror'&&e.role==='user')return <div className="message-line user" key={e.eventId}><div className="message-stack">{selected==='new'&&<small className="bb-sender">{who(requesterFor(e.jobId))}</small>}<div className="message-bubble"><MessageContent content={e.text??''}/></div></div></div>;
            if(e.origin==='aside-mirror')return <div className="bb-answer" key={e.eventId}><MessageContent content={e.text??''}/></div>;
            return <div className={`bb-step ${KIND_CLASS[e.kind]??''}`} key={e.eventId}><span className="bb-step-dot" aria-hidden="true"/><span>{KIND_LABEL[e.kind]??e.kind}{KIND_SHOW_TEXT.has(e.kind)&&e.text?` · ${e.text}`:''}</span><span className="bb-time">{time(e.at)}</span></div>;
          })}</div>}

      {current?.status==='waiting-approval'&&current.suspension&&<section className="bb-card" aria-label="사용자 확인">
        <b>{current.suspension.description}</b>
        {current.suspension.kind==='ask-user-question'
          ? <>{(current.suspension.request?.questions??[{question:current.suspension.description}]).map((q,i)=><label key={`${current.suspension?.toolCallId}-${i}`}>{q.header?`${q.header} · `:''}{q.question}<input value={answers[i]??''} onChange={e=>setAnswers(a=>{const next=[...a];next[i]=e.target.value;return next;})}/></label>)}
              <div className="bb-actions"><button disabled={sending} onClick={()=>void command('answer',{answerTexts:answers})}>답변 보내기</button></div></>
          : <div className="bb-actions"><button disabled={sending} onClick={()=>void command('answer',{answerTexts:[current.suspension?.kind==='action-confirmation'?'confirm':'allow']})}>허용</button><button className="ghost" disabled={sending} onClick={()=>void command('answer',{answerTexts:[current.suspension?.kind==='action-confirmation'?'cancel':'deny']})}>거절</button></div>}
      </section>}

      {current&&current.status!=='waiting-approval'&&running&&<div className="bb-actions">
        <button className="danger" disabled={sending} onClick={()=>void command('cancel')}>이 작업 중단</button>
        {current.status==='unknown'&&<button className="ghost" disabled={sending} onClick={()=>void command('reconcile')}>실행 상태 재확인</button>}
      </div>}
    </div>

    <footer className="composer-wrap">
      {error&&<p className="composer-error" role="alert">{error}</p>}
      <div className="composer">
        <textarea aria-label={current?'이 작업에 추가':'새 브라우저 작업'} placeholder={current?`${bot.name} 작업에 추가 지시…`:`${bot.name}에게 웹 작업 지시`} value={task} onChange={e=>setTask(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}} rows={1}/>
        {running&&current?.status!=='unknown'?<button aria-label="이 작업 중단" className="send-button cancel-send" disabled={sending} onClick={()=>void command('cancel')} type="button"><Icon name="close" size={16}/></button>:null}
        {canSend?<button aria-label={current?'추가 지시 보내기':'새 작업 보내기'} className="send-button" onClick={()=>void submit()} type="button"><Icon name="send" size={18}/></button>:null}
      </div>
      <div className="bb-modebar"><span className="bb-modebar-dot" aria-hidden="true"/>Aside 914 · Guard · GPT-5.5</div>
    </footer>
  </main>;
}

export function BrowserBotScreen({botId,onBack}:{botId:string;onBack?:()=>void}){
  const[screen,setScreen]=useState<{available:boolean;instanceId:string;currentJobId?:string;viewerUrl?:string|null}|null>(null);const[error,setError]=useState('');
  useEffect(()=>{let closed=false;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const s=await api(`/api/bots/${encodeURIComponent(botId)}/browser/screen`);if(!closed){setScreen(s);setError('');}}catch(e){if(!closed){setScreen(null);setError(String(e));}}finally{if(!closed)timer=setTimeout(()=>void poll(),3000);}};void poll();return()=>{closed=true;clearTimeout(timer);};},[botId]);
  return <main className="chat-screen">
    <header className="chat-toolbar">
      {onBack&&<button aria-label="뒤로" className="circle-button" onClick={onBack} type="button"><Icon name="back" size={22}/></button>}
      <span className="chat-identity" aria-label="실시간 화면"><span className="bb-screen-badge"><Icon name="display" size={18}/></span><strong>실시간 화면</strong></span>
      <div className="chat-actions"><span className="bb-screen-sub">읽기 전용 · {screen?.currentJobId?`작업 ${screen.currentJobId}`:'작업 없음'}</span></div>
    </header>
    <div className="bb-viewer">
      {error&&<p className="bb-banner error" role="alert">{error}</p>}
      {screen?.available&&screen.viewerUrl
        ? <iframe key={screen.instanceId} title="Aside 브라우저 읽기 전용 화면" src={screen.viewerUrl} sandbox="allow-scripts allow-same-origin"/>
        : <p className="bb-empty">화면 연결이 없습니다.<br/>작업이 실행될 때 브라우저 화면이 여기에 표시됩니다.</p>}
    </div>
  </main>;
}
