async function probe() {
  let result;
  try {
    const tab = await chrome.tabs.create({ url: "data:text/html,<title>target</title>", active: false });
    await new Promise(r => setTimeout(r, 900));
    result = await new Promise((resolve) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (sid) => {
        const err = chrome.runtime.lastError;
        resolve({ ok: !err && !!sid, streamId: sid || null, error: err ? err.message : null });
      });
    });
  } catch (e) { result = { ok:false, error:String(e) }; }
  const payload = result.ok ? ("OK|" + result.streamId) : ("FAIL|" + (result.error||"?"));
  try { await chrome.tabs.create({ url: "data:text/html," + encodeURIComponent("<title>CAPRESULT " + payload + "</title>done"), active:false }); } catch(e){}
}
chrome.runtime.onInstalled.addListener(probe);
probe();
