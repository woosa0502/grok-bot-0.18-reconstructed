async function probe() {
  const out = {};
  // 1) 네임스페이스 존재?
  out.hasNamespace = (typeof chrome.asideAccount === "object");
  out.hasGetProfiles = out.hasNamespace && (typeof chrome.asideAccount.getProfiles === "function");
  // 2) getProfiles 실제 호출
  if (out.hasGetProfiles) {
    try {
      const profiles = await chrome.asideAccount.getProfiles();
      out.profiles = profiles;
    } catch (e) { out.getProfilesError = String(e); }
  }
  // 3) getProfileContext
  if (out.hasNamespace && typeof chrome.asideAccount.getProfileContext === "function") {
    try { out.context = await chrome.asideAccount.getProfileContext(); }
    catch (e) { out.contextError = String(e); }
  }
  // 4) signDaemonAuthChallenge
  if (out.hasNamespace && typeof chrome.asideAccount.signDaemonAuthChallenge === "function") {
    try { out.sign = await chrome.asideAccount.signDaemonAuthChallenge("test-challenge-123"); }
    catch (e) { out.signError = String(e); }
  }
  const enc = encodeURIComponent(JSON.stringify(out));
  try { await chrome.tabs.create({ url: "data:text/html,<title>ACCTRESULT " + enc + "</title>", active:false }); } catch(e){}
}
chrome.runtime.onInstalled.addListener(probe);
probe();
