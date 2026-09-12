import { createServer } from "node:http";
import type { Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { ExperienceLoop,ExperienceEnvelope } from "./loop.js";
function authorized(header:string|undefined,secret:string):boolean{const a=Buffer.from(header??""),b=Buffer.from("Bearer "+secret);return a.length===b.length&&timingSafeEqual(a,b);}
/** Local Belmont-owned ingestion endpoint. No principal/scope/authority accepted in request JSON. */
export function createExperienceServer(loop:ExperienceLoop,secret:string):Server{
  if(secret.length<32)throw new Error("EXPERIENCE_TOKEN_TOO_SHORT");
  return createServer(async(req,res)=>{
    if(!authorized(req.headers.authorization,secret)){res.writeHead(401);res.end();return;}
    if(req.method!=="POST"||req.url!=="/v1/experience"){res.writeHead(404);res.end();return;}
    try{const chunks:Buffer[]=[];let length=0;for await(const part of req){length+=part.length;if(length>128000)throw new Error("BODY_TOO_LARGE");chunks.push(Buffer.from(part));}
      const raw=JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if(["principal","scope","authority","control","trials","approved"].some(k=>k in raw))throw new Error("UNTRUSTED_CONTROL_FIELD");
      const result=loop.ingest(raw as ExperienceEnvelope);res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(result));
    }catch{res.writeHead(400,{"content-type":"application/json"});res.end(JSON.stringify({error:"INVALID_EXPERIENCE"}));}
  });
}
export class AsideMemoryClient{
  constructor(private readonly endpoint:string,private readonly token:string){}
  async report(experience:ExperienceEnvelope,signal=AbortSignal.timeout(10000)){
    const r=await fetch(this.endpoint+"/v1/experience",{method:"POST",headers:{authorization:"Bearer "+this.token,"content-type":"application/json"},body:JSON.stringify(experience),signal});
    if(!r.ok)throw new Error(`BELMONT_INGEST_${r.status}`);return await r.json();
  }
}
