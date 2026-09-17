#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const root=resolve(arg('--sand-root')||'.cache/belmont-wsl-profile/sand-data');
const botId=arg('--bot-id');
if(!botId){console.error('Usage: node scripts/register-browser-bot.mjs --sand-root <sand-data> --bot-id <existing-roster-bot-id> [--service-state <serve.json>]');console.error('Create one normal roster bot through the existing PWA/CreateAgent UI first. This script never invents a roster record.');process.exit(2);}
if(!/^[A-Za-z0-9_-]{8,128}$/.test(botId))throw new Error('Invalid bot id');
const gateway=JSON.parse(readFileSync(join(root,'gateway.json'),'utf8'));
const response=await fetch(`http://127.0.0.1:${gateway.port}/api/listAgents`,{method:'POST',headers:{authorization:`Bearer ${gateway.token}`,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
if(!response.ok)throw new Error(`Roster lookup failed: ${response.status}`);
const payload=await response.json();const list=Array.isArray(payload)?payload:payload.agents??payload.result?.agents??payload.result;
if(!Array.isArray(list)||!list.some(a=>a.id===botId&&!a.isGroup))throw new Error('Bot id is not a live roster agent; no files changed');
const file=join(root,'agents',botId,'profile.json');const profile=JSON.parse(readFileSync(file,'utf8'));
if(typeof profile.name!=='string'||typeof profile.description!=='string')throw new Error('Existing profile lacks name/description; no files changed');
const configFile=join(root,'browser-bot.json');if(existsSync(configFile)){const old=JSON.parse(readFileSync(configFile,'utf8'));if(old.botId!==botId)throw new Error('Another dedicated browser bot is registered; migrate its jobs explicitly first');}
function atomic(file,value){const temp=`${file}.tmp-${randomUUID()}`;writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(temp,file);}
writeFileSync(`${file}.before-browser-bot-${Date.now()}`,JSON.stringify(profile,null,2)+'\n',{mode:0o600});
mkdirSync(join(root,'browser-bot'),{recursive:true,mode:0o700});
atomic(configFile,{version:1,botId,queueWaitMs:30*60000,executionBudgetMs:30*60000,serviceStateFile:resolve(arg('--service-state')||'belmont-browse/.state/serve.json')});
atomic(file,{...profile,runtime:'aside-browse',browserJobProtocol:1});
console.log(`Registered ${profile.name} (${botId}). Existing roster/profile fields preserved.`);
console.log(`Host: SAND_ASIDE_BROWSE=1. Browser service: BELMONT_BROWSER_BOT_ID=${botId}, BELMONT_MEMORY_AUTHORITY=belmont, engine 914.`);
