async function probe() {
  const out = {};
  const nss = ["asideAccount","asideNotification","asideBrowserImport","asideMiniPopup","asideBrowserPreferences","asideOmnibox"];
  for (const ns of nss) {
    const obj = chrome[ns];
    if (typeof obj !== "object") { out[ns] = "MISSING"; continue; }
    const fns = Object.keys(obj).filter(k => typeof obj[k] === "function");
    out[ns] = { fnCount: fns.length, sample: fns.slice(0,3) };
  }
  // 실제 호출 샘플: miniPopup.getEnabled, notification 존재, omnibox 함수 수
  try { out.miniPopupGetEnabled = await chrome.asideMiniPopup.getEnabled(); } catch(e){ out.miniPopupErr=String(e); }
  try { out.importSources = await chrome.asideBrowserImport.getImportSources(); } catch(e){ out.importErr=String(e); }
  const enc = encodeURIComponent(JSON.stringify(out));
  try { await chrome.tabs.create({ url: "data:text/html,<title>ALLNS " + enc + "</title>", active:false }); } catch(e){}
}
chrome.runtime.onInstalled.addListener(probe);
probe();
