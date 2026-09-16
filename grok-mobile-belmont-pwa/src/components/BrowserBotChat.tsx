import { useEffect, useRef, useState } from 'react';
import { MessageContent } from './MessageContent';

type Job={key:string;jobId:string;requesterAgentId:string;status:string;error?:string;result?:string;asideSessionId?:string;suspension?:{kind:string;toolCallId:string;description:string;request?:{questions?:{header?:string;question:string;options?:unknown[]}[]}}};
type Event={seq:number;eventId:string;origin:string;kind:string;jobKey?:string;jobId:string;role?:string;text:string;at:number};
type State={service?:{instanceId:string;observedAt:number};jobs:Job[];inbox:{key:string;jobId:string;state:string;error?:string}[];events:Event[];commands:{key:string;state:string;error?:string}[]};
async function api(path:string,body?:unknown){const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(v.error?.message??v.error??v.message??`${r.status}`);return v;}
export function BrowserBotChat({botId,onBack,onComputer}:{botId:string;onBack?:()=>void;onComputer?:()=>void}){
  const [state,setState]=useState<State>({jobs:[],inbox:[],events:[],commands:[]});const [error,setError]=useState('');const [selected,setSelected]=useState('new');const [task,setTask]=useState('');const [sending,setSending]=useState(false);const [answers,setAnswers]=useState<string[]>([]);
  const pending=useRef<{key:string;task:string;selected:string}|null>(null);const cursor=useRef(0);const seen=useRef(new Map<string,Event>());const base=`/api/bots/${encodeURIComponent(botId)}/browser`;
  useEffect(()=>{let closed=false;let timer:ReturnType<typeof setTimeout>;cursor.current=0;seen.current.clear();const poll=async()=>{try{const data:State=await api(`${base}/state?after=${cursor.current}`);if(closed)return;for(const e of data.events){seen.current.set(e.eventId,e);cursor.current=Math.max(cursor.current,e.seq);}setState({...data,events:[...seen.current.values()].sort((a,b)=>a.seq-b.seq)});setError('');}catch(e){if(!closed)setError(String(e));}finally{if(!closed)timer=setTimeout(()=>void poll(),1500);}};void poll();return()=>{closed=true;clearTimeout(timer);};},[base]);
  const current=state.jobs.find(j=>j.key===selected);useEffect(()=>setAnswers([]),[current?.suspension?.toolCallId]);
  const submit=async()=>{if(!task.trim()||sending)return;setSending(true);try{
    const p=pending.current?.task===task&&pending.current?.selected===selected?pending.current:{key:crypto.randomUUID(),task,selected};pending.current=p;
    if(current)await api(`${base}/commands`,{action:'followup',jobKey:current.key,requestKey:p.key,expectedInstanceId:state.service?.instanceId,task});
    else await api(`${base}/requests`,{jobId:`user-${p.key}`,requestId:p.key,requestKey:p.key,action:'start',task});
    pending.current=null;setTask('');setError('');
  }catch(e){setError(`${String(e)} · 다시 보내기는 동일 요청 키를 사용합니다.`);}finally{setSending(false);}};
  const command=async(action:string,extra:Record<string,unknown>={})=>{if(!current||sending)return;setSending(true);try{await api(`${base}/commands`,{action,jobKey:current.key,requestKey:crypto.randomUUID(),expectedInstanceId:state.service?.instanceId,expectedSessionId:current.asideSessionId,expectedToolCallId:current.suspension?.toolCallId,...extra});setError('');}catch(e){setError(String(e));}finally{setSending(false);}};
  const shown=state.events.filter(e=>selected==='new'||e.jobKey===selected||e.jobId===current?.jobId);
  return <section style={{display:'flex',flexDirection:'column',height:'100%',padding:12,gap:10,overflow:'auto'}}>
    <header style={{display:'flex',gap:8,alignItems:'center'}}>{onBack&&<button onClick={onBack}>뒤로</button>}<strong>브라우저 봇</strong>{onComputer&&<button onClick={onComputer}>실시간 화면 · 읽기 전용</button>}</header>
    <p>새 의뢰는 새 Aside 대화로 실행합니다. 기존 작업의 수정은 해당 작업을 선택하세요.</p>
    <select value={selected} onChange={e=>setSelected(e.target.value)}><option value="new">새 작업 / 전체 대화 보기</option>{state.jobs.map(j=><option key={j.key} value={j.key}>{j.jobId} · {j.status} · {j.requesterAgentId}</option>)}</select>
    {!state.service||Date.now()-state.service.observedAt>10000?<p role="status">브라우저 서비스 상태 미확인. 접수와 실제 실행은 별개입니다.</p>:null}
    {error&&<p role="alert">{error}</p>}
    {state.inbox.filter(r=>['queued','dispatching','unknown','expired'].includes(r.state)).map(r=><p key={r.key}>{r.jobId}: {r.state} {r.error}</p>)}
    {state.commands.filter(c=>['unknown','rejected'].includes(c.state)).map(c=><p role="alert" key={c.key}>명령 {c.state}: {c.error} — 실행 상태를 확인한 뒤 새 명령을 보내세요.</p>)}
    {current&&<div><b>{current.jobId}: {current.status}</b>{current.error&&<p>{current.error}</p>}<button disabled={sending} onClick={()=>void command('cancel')}>이 작업 중단 요청</button>{current.status==='unknown'&&<button disabled={sending} onClick={()=>void command('reconcile')}>실행 상태 재확인 · 재실행 아님</button>}</div>}
    {current?.status==='waiting-approval'&&current.suspension&&<section aria-label="사용자 확인">
      <b>{current.suspension.description}</b>
      {current.suspension.kind==='ask-user-question'?<>{(current.suspension.request?.questions??[{question:current.suspension.description}]).map((q,i)=><label key={`${current.suspension?.toolCallId}-${i}`} style={{display:'block'}}>{q.header} {q.question}<input value={answers[i]??''} onChange={e=>setAnswers(a=>{const next=[...a];next[i]=e.target.value;return next;})}/></label>)}<button disabled={sending} onClick={()=>void command('answer',{answerTexts:answers})}>현재 질문에 답변</button></>:<><button disabled={sending} onClick={()=>void command('answer',{answerTexts:[current.suspension?.kind==='action-confirmation'?'confirm':'allow']})}>현재 작업 허용</button><button disabled={sending} onClick={()=>void command('answer',{answerTexts:[current.suspension?.kind==='action-confirmation'?'cancel':'deny']})}>거절</button></>}
    </section>}
    <div aria-live="polite">{shown.map(e=><article key={e.eventId} data-origin={e.origin} style={{borderBottom:'1px solid #8884',padding:'8px 0'}}><small>{e.jobId} · {e.role??e.kind} · {new Date(e.at).toLocaleTimeString()}</small><MessageContent content={e.text??''}/></article>)}</div>
    <textarea aria-label={current?'이 작업에 추가':'새 브라우저 작업'} value={task} onChange={e=>setTask(e.target.value)} rows={4}/>
    <button disabled={sending||!task.trim()||current?.status==='unknown'} onClick={()=>void submit()}>{sending?'접수 중':current?'선택한 작업에 추가':'새 작업 접수'}</button>
  </section>;
}
export function BrowserBotScreen({botId,onBack}:{botId:string;onBack?:()=>void}){
  const[screen,setScreen]=useState<{available:boolean;instanceId:string;currentJobId?:string;viewerUrl?:string|null}|null>(null);const[error,setError]=useState('');
  useEffect(()=>{let closed=false;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const s=await api(`/api/bots/${encodeURIComponent(botId)}/browser/screen`);if(!closed){setScreen(s);setError('');}}catch(e){if(!closed){setScreen(null);setError(String(e));}}finally{if(!closed)timer=setTimeout(()=>void poll(),3000);}};void poll();return()=>{closed=true;clearTimeout(timer);};},[botId]);
  return <section style={{height:'100%',display:'flex',flexDirection:'column'}}><header>{onBack&&<button onClick={onBack}>뒤로</button>} 읽기 전용 화면 · 작업 {screen?.currentJobId??'없음'}</header>{error&&<p role="alert">{error}</p>}{screen?.available&&screen.viewerUrl?<iframe key={screen.instanceId} title="Aside browser read-only screen" src={screen.viewerUrl} sandbox="allow-scripts allow-same-origin" style={{border:0,flex:1,minHeight:300}}/>:<p>화면 연결이 없습니다. 브라우저 작업 상태와 별개입니다.</p>}</section>;
}
