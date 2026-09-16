import { readFile, realpath } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { browserConfig, hostStore, enqueueBrowserJob, enqueueBrowserCommand } from '../shared/browser-bot/host-store.mjs';
import { id, problem } from '../shared/browser-bot/store.mjs';

/** All targets are operator-owned. Neither browser clients nor models supply upstream URLs. */
export function browserBotApi({profileDir,authorized,skipPairing=false,readBody,json,gateway,now=Date.now}){
  const wss=new WebSocketServer({noServer:true,maxPayload:1_048_576});const peers=new Set();
  const config=()=>browserConfig(profileDir);
  async function scoped(botId){id(botId,'botId');const c=config();if(c?.botId!==botId)throw problem('NOT_BROWSER_BOT','Not the registered browser bot',404);const roster=await gateway.call('listAgents', {});const a=(Array.isArray(roster)?roster:Array.isArray(roster?.agents)?roster.agents:Array.isArray(roster?.result)?roster.result:Array.isArray(roster?.result?.agents)?roster.result.agents:[]).find(a=>a.id===botId&&!a.isGroup);if(!a)throw problem('BOT_GONE','Browser bot is not in the current roster',404);return c;}
  async function service(){const c=config();if(!c)throw problem('NOT_CONFIGURED','Browser bot is not registered',404);const stateFile=c.serviceStateFile||resolve(profileDir,'../../../belmont-browse/.state/serve.json');const s=JSON.parse(await readFile(stateFile,'utf8'));if(!Number.isInteger(s.port)||s.port<1024||s.port>65535||typeof s.token!=='string')throw new Error('Invalid private browse discovery');return{base:`http://127.0.0.1:${s.port}`,token:s.token};}
  async function health(){const s=await service();const r=await fetch(`${s.base}/health`,{headers:{authorization:`Bearer ${s.token}`},signal:AbortSignal.timeout(3000),redirect:'error'});if(!r.ok)throw problem('BROWSE_UNAVAILABLE','Browser service unavailable',503);return{s,h:await r.json()};}
  const guard=req=>{if(skipPairing||!authorized(req))throw problem('PAIRING_REQUIRED','Paired user session required',401);};
  return{
    async handle(req,res,url){const m=/^\/api\/bots\/([^/]+)\/browser(?:\/(.*))?$/.exec(url.pathname);if(!m)return false;guard(req);const botId=id(decodeURIComponent(m[1]));const suffix=m[2]||'';
      if(suffix==='runtime'&&req.method==='GET'){const c=config();json(res,200,{enabled:c?.botId===botId});return true;}
      await scoped(botId);const db=hostStore(profileDir);
      if(req.method==='GET'&&suffix==='state'){const metadata=db.get('meta','service'),jobs=db.get('meta','jobs');json(res,200,{botId,service:metadata?{instanceId:metadata.instanceId,ready:metadata.ready,screen:metadata.screen,observedAt:metadata.observedAt}:null,jobs:jobs?.jobs??[],inbox:db.values('inbox').map(r=>({key:r.key,jobId:r.payload.jobId,state:r.state,error:r.error,createdAt:r.createdAt})),commands:db.values('command').map(r=>({key:r.key,state:r.state,error:r.error})),events:db.events(botId,Number(url.searchParams.get('after')??0),500)});return true;}
      if(req.method==='POST'&&suffix==='requests'){const b=await readBody(req);const request=enqueueBrowserJob(profileDir,{botId,requesterAgentId:'user',replyTarget:null,jobId:b.jobId,requestId:b.requestId,requestKey:b.requestKey,action:b.action,task:b.task});json(res,202,{key:request.key,state:request.state,jobId:request.payload.jobId});return true;}
      if(req.method==='POST'&&suffix==='commands'){json(res,202,enqueueBrowserCommand(profileDir,botId,await readBody(req)));return true;}
      if(req.method==='GET'&&suffix==='screen'){const{h}=await health();if(h.browserJobs?.botId!==botId)throw problem('WRONG_SERVICE','Browser service bot mismatch',409);json(res,200,{...h.screen,currentJobId:h.browserJobs?.currentJobId??null,viewerUrl:h.screen?.available?`/api/bots/${botId}/browser/view?instanceId=${encodeURIComponent(h.instanceId)}`:null});return true;}
      if(req.method==='GET'&&suffix==='view'){const{h}=await health();if(h.browserJobs?.botId!==botId||!h.screen?.available||url.searchParams.get('instanceId')!==h.instanceId)throw problem('SCREEN_STALE','Screen instance changed or unavailable',409);
        const websocketPath=`/api/bots/${botId}/browser/ws?instanceId=${encodeURIComponent(h.instanceId)}`;
        const body=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Browser screen — read only</title><style>body{margin:0;background:#111;color:#fff;font-family:sans-serif}#status{padding:6px}#screen{height:calc(100vh - 32px)}</style><div id="status">연결 중 · 읽기 전용</div><div id="screen"></div><script type="module">import RFB from '/api/bots/${botId}/browser/assets/core/rfb.js';const u=new URL(${JSON.stringify(websocketPath)},location.href);u.protocol=location.protocol==='https:'?'wss:':'ws:';const r=new RFB(document.getElementById('screen'),u.href);r.viewOnly=true;r.scaleViewport=true;r.resizeSession=false;r.addEventListener('connect',()=>{document.getElementById('status').textContent='읽기 전용 · 연결됨'});r.addEventListener('disconnect',()=>{document.getElementById('status').textContent='연결 끊김 — 화면을 새로 열어 주세요';document.getElementById('screen').style.opacity='.25'});</script>`;
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'",'x-content-type-options':'nosniff'});res.end(body);return true;}
      if(req.method==='GET'&&suffix.startsWith('assets/')){const root=await realpath(process.env.BELMONT_NOVNC_DIR||'/usr/share/novnc');const relative=decodeURIComponent(suffix.slice(7));if(!/^[A-Za-z0-9_./-]+\.js$/.test(relative)||relative.split('/').includes('..'))throw problem('INVALID_ASSET','Invalid viewer asset',400);const target=await realpath(resolve(root,relative));if(!target.startsWith(root+sep))throw problem('INVALID_ASSET','Viewer asset escaped root',403);const body=await readFile(target);res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'private, max-age=300','x-content-type-options':'nosniff'});res.end(body);return true;}
      throw problem('NOT_FOUND','Unknown browser route',404);
    },
    async upgrade(req,socket,head){let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{return false;}const m=/^\/api\/bots\/([^/]+)\/browser\/ws$/.exec(url.pathname);if(!m)return false;
      try{guard(req);const botId=id(decodeURIComponent(m[1]));await scoped(botId);
        // Cookie-authenticated WebSockets also require an exact same-origin browser Origin.
        const expected=process.env.BELMONT_PWA_PUBLIC_ORIGIN;const origin=req.headers.origin;
        const requestOrigin=expected||`${req.socket.encrypted?'https':'http'}://${req.headers.host}`;
        if(!origin||new URL(origin).origin!==new URL(requestOrigin).origin)throw new Error('Wrong WebSocket origin');
        const{s,h}=await health();if(!h.screen?.available||h.browserJobs?.botId!==botId||url.searchParams.get('instanceId')!==h.instanceId)throw new Error('Stale screen scope');
        const target=s.base.replace(/^http/,'ws')+`/browser-screen/ws?botId=${encodeURIComponent(botId)}&instanceId=${encodeURIComponent(h.instanceId)}`;
        wss.handleUpgrade(req,socket,head,client=>{const upstream=new WebSocket(target,{headers:{authorization:`Bearer ${s.token}`}}),queue=[];let size=0,closed=false;peers.add(client);peers.add(upstream);
          const close=()=>{if(closed)return;closed=true;clearInterval(expiry);peers.delete(client);peers.delete(upstream);client.terminate();upstream.terminate();};
          const expiry=setInterval(()=>{if(!authorized(req)||config()?.botId!==botId)close();},5000);expiry.unref?.();
          client.on('message',(data,binary)=>{if(!binary)return close();if(upstream.readyState===WebSocket.OPEN){if(upstream.bufferedAmount>1_048_576)return close();upstream.send(data,{binary:true});}else{size+=data.length;if(size>1_048_576)return close();queue.push(data);}});
          upstream.on('open',()=>{for(const b of queue.splice(0))upstream.send(b,{binary:true});size=0;});upstream.on('message',data=>{if(client.readyState===WebSocket.OPEN){if(client.bufferedAmount>8_388_608)return close();client.send(data,{binary:true});}});
          for(const s of [client,upstream]){s.on('error',close);s.on('close',close);}
        });
      }catch{socket.destroy();}return true;
    },
    close(){for(const s of peers)s.terminate();peers.clear();wss.close();}
  };
}
