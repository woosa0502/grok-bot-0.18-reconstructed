import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../shared/browser-bot/store.mjs';
function identity(pid){try{const s=readFileSync(`/proc/${pid}/stat`,'utf8');const fields=s.slice(s.lastIndexOf(')')+2).split(' ');return{state:fields[0],ticks:fields[19]};}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return null;throw new Error('Cannot verify existing browser-service owner');}}
/** Acquired before daemon/bootstrap side effects. PID + start ticks are checked under one transaction. */
export function acquireBrowserServiceLease(stateDir){
  if(!process.env.BELMONT_BROWSER_BOT_ID)return()=>{};
  if(process.platform!=='linux')throw new Error('This dedicated service lease is for the WSL/Linux deployment');
  const own=identity(process.pid);if(!own?.ticks)throw new Error('Current process identity unavailable');
  const db=new Store(join(stateDir,'browser-service-lease.sqlite')),token=randomUUID();
  db.transaction(()=>{const old=db.get('lease','owner');if(old){const live=identity(old.pid);if(live&&live.state!=='Z'&&live.ticks===old.ticks)throw new Error(`Browser service already owned by live pid ${old.pid}`);}db.put('lease','owner',{pid:process.pid,ticks:own.ticks,token});});
  let done=false;const release=()=>{if(done)return;done=true;try{db.transaction(()=>{if(db.get('lease','owner')?.token===token)db.remove('lease','owner');});}finally{db.close();}};
  process.once('exit',release);return release;
}
