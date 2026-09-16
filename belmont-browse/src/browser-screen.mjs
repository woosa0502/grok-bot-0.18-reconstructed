import { spawn } from 'node:child_process';
import net from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';

/** Streaming RFB client-message allowlist; WebSocket packet boundaries are not protocol boundaries. */
export class ReadOnlyRfbFilter {
  constructor(){this.buffer=Buffer.alloc(0);this.phase='version';}
  push(input){
    this.buffer=Buffer.concat([this.buffer,Buffer.from(input)]);if(this.buffer.length>1_048_576)throw new Error('RFB input buffer limit');
    const out=[];const take=n=>{const b=this.buffer.subarray(0,n);this.buffer=this.buffer.subarray(n);return b;};
    for(;;){
      if(this.phase==='version'){if(this.buffer.length<12)break;const b=take(12);if(b.toString()!=='RFB 003.008\n')throw new Error('Only RFB 3.8 is supported');out.push(b);this.phase='security';continue;}
      if(this.phase==='security'){if(!this.buffer.length)break;if(take(1)[0]!==1)throw new Error('Unexpected internal VNC security selection');out.push(Buffer.from([1]));this.phase='shared';continue;}
      if(this.phase==='shared'){if(!this.buffer.length)break;take(1);out.push(Buffer.from([1]));this.phase='messages';continue;}
      if(!this.buffer.length)break;const type=this.buffer[0];
      if(type===0){if(this.buffer.length<20)break;const b=take(20);if(![16,32].includes(b[4])||b[5]>b[4])throw new Error('Invalid pixel format');out.push(b);}
      else if(type===2){if(this.buffer.length<4)break;const count=this.buffer.readUInt16BE(2);if(count>256)throw new Error('Too many RFB encodings');if(this.buffer.length<4+count*4)break;const b=take(4+count*4),enc=[];const allowed=new Set([0,1,5,7,16,-239,-223,-224]);for(let i=0;i<count;i++){const v=b.readInt32BE(4+i*4);if(allowed.has(v))enc.push(v);}if(!enc.includes(0))enc.push(0);const safe=Buffer.alloc(4+4*enc.length);safe[0]=2;safe.writeUInt16BE(enc.length,2);enc.forEach((v,i)=>safe.writeInt32BE(v,4+i*4));out.push(safe);}
      else if(type===3){if(this.buffer.length<10)break;out.push(take(10));}
      else if(type===4){if(this.buffer.length<8)break;take(8);} // keyboard: never forwarded
      else if(type===5){if(this.buffer.length<6)break;take(6);} // pointer: never forwarded
      else if(type===6){if(this.buffer.length<8)break;const n=this.buffer.readUInt32BE(4);if(n>262144)throw new Error('Clipboard/extended clipboard rejected');if(this.buffer.length<8+n)break;take(8+n);}
      else throw new Error(`RFB client message ${type} is not permitted`); // file transfer, desktop resize and unknown extensions
    }return out;
  }
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function isListening(port){return new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.setTimeout(250);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false);});});}
async function availablePort(port){if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid internal screen port');if(await isListening(port))throw new Error(`Internal screen port ${port} is already occupied`);}
async function stopChild(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');for(let i=0;i<30&&child.exitCode===null&&child.signalCode===null;i++)await sleep(50);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}

export async function createBrowserScreen({enabled,display,instanceId,botId,token,log=console.error,rfbPort=Number(process.env.BELMONT_SCREEN_RFB_PORT||5952),wsPort=Number(process.env.BELMONT_SCREEN_WS_PORT||6952)}){
  let ready=false,closed=false,vnc,bridge;const sockets=new Set();const wss=new WebSocketServer({noServer:true,maxPayload:1_048_576});
  const closeSockets=()=>{for(const s of sockets){try{s.terminate();}catch{}}sockets.clear();};
  if(enabled){try{
    if(!/^:\d+(?:\.\d+)?$/.test(display))throw new Error('Screen requires an explicitly selected local X display');
    await availablePort(rfbPort);await availablePort(wsPort);
    // x11vnc must attach to the owned Xvfb X11 display, not the WSLg Wayland session. WSLg exports
    // WAYLAND_DISPLAY, which makes x11vnc detect Wayland and exit before serving; strip it (and force
    // DISPLAY to the target) so the screen binds the private Xvfb.
    const screenEnv={...process.env,DISPLAY:display};delete screenEnv.WAYLAND_DISPLAY;delete screenEnv.WAYLAND_SOCKET;
    const start=(binary,args)=>{const p=spawn(binary,args,{stdio:['ignore','ignore','pipe'],env:screenEnv});p.on('error',e=>{ready=false;log(`[screen] ${e.message}`);closeSockets();});p.on('exit',()=>{ready=false;closeSockets();});p.stderr.on('data',b=>log(`[screen] ${String(b).slice(-1000).trim()}`));return p;};
    vnc=start(process.env.BELMONT_X11VNC_BIN||'x11vnc',['-display',display,'-localhost','-rfbport',String(rfbPort),'-forever','-shared','-viewonly','-noclipboard','-nosetclipboard','-nopw']);
    for(let i=0;i<60;i++){if(vnc.exitCode!==null||vnc.signalCode!==null)throw new Error('x11vnc exited before readiness');if(await isListening(rfbPort))break;await sleep(100);}
    if(!(await isListening(rfbPort)))throw new Error('x11vnc readiness timeout');
    bridge=start(process.env.BELMONT_WEBSOCKIFY_BIN||'websockify',[`127.0.0.1:${wsPort}`,`127.0.0.1:${rfbPort}`]);
    for(let i=0;i<40;i++){if(bridge.exitCode!==null||bridge.signalCode!==null)throw new Error('websockify exited before readiness');if(await isListening(wsPort)){ready=true;break;}await sleep(100);}
    if(!ready)throw new Error('websockify readiness timeout');
  }catch(e){log(`[screen] unavailable: ${e.message}`);await stopChild(bridge);await stopChild(vnc);ready=false;}}
  return{
    health:()=>({available:!closed&&ready,readOnly:true,instanceId,botId}),
    attach(server){server.on('upgrade',(req,socket,head)=>{
      let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{socket.destroy();return;}
      if(url.pathname!=='/browser-screen/ws')return socket.destroy();
      if(closed||!ready||req.headers.authorization!==`Bearer ${token}`||url.searchParams.get('instanceId')!==instanceId||url.searchParams.get('botId')!==botId)return socket.destroy();
      wss.handleUpgrade(req,socket,head,client=>{
        const upstream=new WebSocket(`ws://127.0.0.1:${wsPort}`),filter=new ReadOnlyRfbFilter(),pending=[];let bytes=0;
        sockets.add(client);sockets.add(upstream);let done=false;
        const close=()=>{if(done)return;done=true;sockets.delete(client);sockets.delete(upstream);client.terminate();upstream.terminate();};
        client.on('message',(data,binary)=>{if(!binary)return close();try{for(const b of filter.push(data)){if(upstream.readyState===WebSocket.OPEN){if(upstream.bufferedAmount>1_048_576)return close();upstream.send(b);}else{bytes+=b.length;if(bytes>1_048_576)return close();pending.push(b);}}}catch{close();}});
        upstream.on('open',()=>{for(const b of pending.splice(0))upstream.send(b);bytes=0;});
        upstream.on('message',data=>{if(client.readyState===WebSocket.OPEN){if(client.bufferedAmount>8_388_608)return close();client.send(data,{binary:true});}});
        for(const s of [client,upstream]){s.on('error',close);s.on('close',close);}
      });
    });},
    async close(){closed=true;ready=false;closeSockets();wss.close();await stopChild(bridge);await stopChild(vnc);}
  };
}
