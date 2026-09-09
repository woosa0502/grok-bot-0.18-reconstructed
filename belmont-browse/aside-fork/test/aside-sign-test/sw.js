async function probe(){
  let out={};
  try{ out.result = await chrome.asideAccount.signDaemonAuthChallenge("zvsZIC5tTqd5G86OKw3FhAly664bPqJi8ymbfco5J7k="); }catch(e){ out.err=String(e); }
  await chrome.tabs.create({url:"data:text/html,<title>SIGN "+encodeURIComponent(JSON.stringify(out))+"</title>",active:false});
}
chrome.runtime.onInstalled.addListener(probe); probe();
