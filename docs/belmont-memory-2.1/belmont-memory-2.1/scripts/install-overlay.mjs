import {existsSync,mkdirSync,cpSync,readFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),where=args.indexOf('--repo');
if(where<0||!args[where+1])throw new Error('Usage: node scripts/install-overlay.mjs --repo /path/Belmont [--apply]');
const repo=resolve(args[where+1]),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(!existsSync(join(repo,'source/host/extensions/memory/memory-service.ts')))throw new Error('Not the expected Belmont source tree');
const destinations=[['src','source/host/extensions/memory/kernel'],['integration/source/host/extensions/memory/memory-learning-runtime.ts','source/host/extensions/memory/memory-learning-runtime.ts']];
for(const[from,to]of destinations){console.log(from+' -> '+join(repo,to));if(existsSync(join(repo,to)))throw new Error('Refusing to overwrite '+to);}
if(!args.includes('--apply')){console.log('Dry run only. Existing MemoryService/runner/Aside remain unchanged.');process.exit(0);}
for(const[from,to]of destinations){mkdirSync(dirname(join(repo,to)),{recursive:true});cpSync(join(root,from),join(repo,to),{recursive:true});}
console.log('Additive files installed. Wire hooks at authenticated turn, closed episode, pre-tool action, and measured outcome boundaries; run Belmont full checks.');
