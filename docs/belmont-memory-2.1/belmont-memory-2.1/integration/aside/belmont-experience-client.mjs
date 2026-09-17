/** Actual Aside-side HTTP adapter; call after a browser task has produced measured output.
 * Aside keeps no separate canonical memory file. The host owns scope and policy.
 */
export async function submitBelmontExperience(experience, { endpoint=process.env.BELMONT_MEMORY_URL, token=process.env.BELMONT_MEMORY_TOKEN, signal=AbortSignal.timeout(10000) }={}) {
  if (!endpoint || !token) throw new Error('BELMONT_MEMORY_URL and BELMONT_MEMORY_TOKEN are required');
  const url=new URL('/v1/experience',endpoint);
  if (url.protocol!=='https:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('Use TLS for non-loopback ingestion');
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(experience),signal});
  if(!response.ok)throw new Error(`Belmont ingestion failed: ${response.status}`);
  return response.json();
}
