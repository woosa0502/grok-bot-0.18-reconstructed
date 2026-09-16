import { useEffect, useRef, useState } from 'react';
import { MessageContent } from './MessageContent';

type Job={key:string;jobId:string;requesterAgentId:string;status:string;error?:string;result?:string;asideSessionId?:string;suspension?:{kind:string;toolCallId:string;description:string;request?:{questions?:{header?:string;question:string;options?:unknown[]}[]}}};
type Event={seq:number;eventId:string;origin:string;kind:string;jobKey?:string;jobId:string;role?:string;text:string;at:number};
type State={service?:{instanceId:string;observedAt:number};jobs:Job[];inbox:{key:string;jobId:string;state:string;error?:string}[];events:Event[];commands:{key:string;state:string;error?:string}[]};
async function api(path:string,body?:unknown){const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(v.error?.message??v.error??v.message??`${r.status}`);return v;}

// A browser-job lifecycle event is a status marker, not a chat turn. Only aside-mirror events carry
// the real Aside conversation, so those render as bubbles and lifecycle events as compact chips.
const KIND_LABEL:Record<string,string>={accepted:'접수 · 대기',running:'실행 중',done:'완료',error:'오류',stopped:'중단됨',expired:'만료',unknown:'확인 필요','waiting-approval':'승인 대기'};
const KIND_CLASS:Record<string,string>={done:'done',error:'error',expired:'error',unknown:'error',stopped:'error',running:'running','waiting-approval':'waiting'};
const KIND_SHOW_TEXT=new Set(['error','expired','unknown','stopped']); // show the reason inline; results live in the mirror bubble
const time=(ms:number)=>new Date(ms).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});

export function BrowserBotChat({botId,onBack,onComputer}:{botId:string;onBack?:()=>void;onComputer?:()=>void}){
  const [state,setState]=useState<State>({jobs:[],inbox:[],events:[],commands:[]});const [error,setError]=useState('');const [selected,setSelected]=useState('new');const [task,setTask]=useState('');const [sending,setSending]=useState(false);const [answers,setAnswers]=useState<string[]>([]);
  const pending=useRef<{key:string;task:string;selected:string}|null>(null);const cursor=useRef(0);const seen=useRef(new Map<string,Event>());const base=`/api/bots/${encodeURIComponent(botId)}/browser`;
  const bodyRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{let closed=false;let timer:ReturnType<typeof setTimeout>;cursor.current=0;seen.current.clear();const poll=async()=>{try{const data:State=await api(`${base}/state?after=${cursor.current}`);if(closed)return;for(const e of data.events){seen.current.set(e.eventId,e);cursor.current=Math.max(cursor.current,e.seq);}setState({...data,events:[...seen.current.values()].sort((a,b)=>a.seq-b.seq)});setError('');}catch(e){if(!closed)setError(String(e));}finally{if(!closed)timer=setTimeout(()=>void poll(),1500);}};void poll();return()=>{closed=true;clearTimeout(timer);};},[base]);
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
  return <section className="bb-screen">
    <header className="bb-top">
      {onBack&&<button className="bb-icon" onClick={onBack} aria-label="뒤로">‹</button>}
      <div className="bb-title"><strong>브라우저 봇</strong><small>{stale?'서비스 상태 확인 중':`Aside 914 · ${state.jobs.length}개 작업`}</small></div>
      {onComputer&&<button className="bb-screen-btn" onClick={onComputer}><span aria-hidden="true">🖥</span> 실시간 화면</button>}
    </header>
    <div className="bb-body" ref={bodyRef} aria-live="polite">
      <select className="bb-select" value={selected} onChange={e=>setSelected(e.target.value)} aria-label="작업 선택">
        <option value="new">새 작업 / 전체 대화</option>
        {state.jobs.map(j=><option key={j.key} value={j.key}>{j.jobId} · {KIND_LABEL[j.status]??j.status} · {j.requesterAgentId}</option>)}
      </select>
      <p className="bb-note">{current?`이 작업을 이어갑니다. 새 의뢰를 하려면 위에서 "새 작업"을 고르세요.`:`새 의뢰는 새 Aside 대화로 실행됩니다. 다른 봇이 지시한 작업도 여기에 함께 뜹니다.`}</p>
      {stale&&<p className="bb-banner warn">브라우저 서비스 상태 미확인 · 접수와 실제 실행은 별개입니다.</p>}
      {error&&<p className="bb-banner error">{error}</p>}
      {pendingInbox.map(r=><p className="bb-banner warn" key={r.key}>{r.jobId}: {KIND_LABEL[r.state]??r.state}{r.error?` · ${r.error}`:''}</p>)}
      {badCommands.map(c=><p className="bb-banner error" key={c.key} role="alert">명령 {c.state}: {c.error} · 실행 상태를 확인한 뒤 다시 보내세요.</p>)}

      {shown.length===0
        ? <p className="bb-empty">아직 대화가 없습니다.<br/>아래에 웹 작업을 적어 보내 보세요.</p>
        : shown.map(e=>e.origin==='aside-mirror'
            ? <div className={`message-line ${e.role==='user'?'user':'assistant'}`} key={e.eventId}>
                <div className="message-stack"><div className="message-bubble"><MessageContent content={e.text??''}/></div></div>
              </div>
            : <div className={`bb-status ${KIND_CLASS[e.kind]??''}`} key={e.eventId}>
                <span>{KIND_LABEL[e.kind]??e.kind}{KIND_SHOW_TEXT.has(e.kind)&&e.text?` · ${e.text}`:''}</span>
                <span className="bb-time">{time(e.at)}</span>
              </div>)}

      {current?.status==='waiting-approval'&&current.suspension&&<section className="bb-card" aria-label="사용자 확인">
        <b>{current.suspension.description}</b>
        {current.suspension.kind==='ask-user-question'
          ? <>{(current.suspension.request?.questions??[{question:current.suspension.description}]).map((q,i)=><label key={`${current.suspension?.toolCallId}-${i}`}>{q.header?`${q.header} · `:''}{q.question}<input value={answers[i]??''} onChange={e=>setAnswers(a=>{const next=[...a];next[i]=e.target.value;return next;})}/></label>)}
              <div className="bb-actions"><button disabled={sending} onClick={()=>void command('answer',{answerTexts:answers})}>답변 보내기</button></div></>
          : <div className="bb-actions"><button disabled={sending} onClick={()=>void command('answer',{answerTexts:[current.suspension?.kind==='action-confirmation'?'confirm':'allow']})}>허용</button><button className="ghost" disabled={sending} onClick={()=>void command('answer',{answerTexts:[current.suspension?.kind==='action-confirmation'?'cancel':'deny']})}>거절</button></div>}
      </section>}

      {current&&current.status!=='waiting-approval'&&['running','starting','dispatching','queued','unknown'].includes(current.status)&&<div className="bb-actions">
        <button className="danger" disabled={sending} onClick={()=>void command('cancel')}>이 작업 중단</button>
        {current.status==='unknown'&&<button className="ghost" disabled={sending} onClick={()=>void command('reconcile')}>실행 상태 재확인</button>}
      </div>}
    </div>
    <div className="bb-compose">
      <div className="composer-inner">
        <textarea aria-label={current?'이 작업에 추가':'새 브라우저 작업'} placeholder={current?'이 작업에 추가 지시…':'예) 쿠팡에서 무선 이어폰 최저가 찾아줘'} value={task} onChange={e=>setTask(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit();}}} rows={1}/>
        <button className="bb-send" aria-label={current?'추가 지시 보내기':'새 작업 보내기'} disabled={sending||!task.trim()||current?.status==='unknown'} onClick={()=>void submit()}>{sending?'…':'↑'}</button>
      </div>
    </div>
  </section>;
}

export function BrowserBotScreen({botId,onBack}:{botId:string;onBack?:()=>void}){
  const[screen,setScreen]=useState<{available:boolean;instanceId:string;currentJobId?:string;viewerUrl?:string|null}|null>(null);const[error,setError]=useState('');
  useEffect(()=>{let closed=false;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const s=await api(`/api/bots/${encodeURIComponent(botId)}/browser/screen`);if(!closed){setScreen(s);setError('');}}catch(e){if(!closed){setScreen(null);setError(String(e));}}finally{if(!closed)timer=setTimeout(()=>void poll(),3000);}};void poll();return()=>{closed=true;clearTimeout(timer);};},[botId]);
  return <section className="bb-screen">
    <header className="bb-top">
      {onBack&&<button className="bb-icon" onClick={onBack} aria-label="뒤로">‹</button>}
      <div className="bb-title"><strong>실시간 화면</strong><small>읽기 전용 · 작업 {screen?.currentJobId??'없음'}</small></div>
    </header>
    <div className="bb-viewer">
      {error&&<p className="bb-banner error">{error}</p>}
      {screen?.available&&screen.viewerUrl
        ? <iframe key={screen.instanceId} title="Aside 브라우저 읽기 전용 화면" src={screen.viewerUrl} sandbox="allow-scripts allow-same-origin"/>
        : <p className="bb-empty">화면 연결이 없습니다.<br/>작업이 실행될 때 브라우저 화면이 여기에 표시됩니다.</p>}
    </div>
  </section>;
}
