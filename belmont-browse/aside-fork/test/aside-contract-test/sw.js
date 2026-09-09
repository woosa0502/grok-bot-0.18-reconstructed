// Adversarial-verification contract test: asserts the RE'd original semantics
// (patches 024-026) against the running fork on a FRESH profile.
const R = { pass: [], fail: [] };
const ok = (name, cond, got) => (cond ? R.pass.push(name) : R.fail.push({ name, got }));
const keys = o => Object.keys(o || {}).sort().join(",");
const rej = async (p) => { try { await p; return null; } catch (e) { return String(e && e.message || e); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const P = chrome.asideBrowserPreferences, M = chrome.asideMiniPopup, O = chrome.asideOmnibox,
        A = chrome.asideAccount, I = chrome.asideBrowserImport;
  try {
    // ---- defaults (fresh profile) ----
    ok("tabStyle default vertical", (await P.getTabStyle()) === "vertical", await P.getTabStyle());
    ok("colorScheme default system", (await P.getBrowserColorScheme()) === "system", await P.getBrowserColorScheme());
    ok("shrink default false", (await P.getHorizontalTabShrinkEnabled()) === false);
    ok("tabSwitcher default true", (await P.getTabSwitcherSortByRecentlyUsed()) === true, await P.getTabSwitcherSortByRecentlyUsed());
    ok("bookmarksSection default true", (await P.getVerticalTabsBookmarksSectionEnabled()) === true, await P.getVerticalTabsBookmarksSectionEnabled());
    ok("autoPip default false", (await P.getAutoPipEnabled()) === false);
    ok("miniPopup enabled default false", (await M.getEnabled()) === false, await M.getEnabled());
    ok("miniPopup shortcut default Alt+Space", (await M.getShortcut()) === "Alt+Space", await M.getShortcut());
    const pc = await A.getProfileContext();
    ok("profileContext omits bound fields when unbound", pc && !("boundAccountId" in pc) && !("boundUserId" in pc) && typeof pc.profileId === "string" && typeof pc.profileIndex === "number", pc);

    // ---- round trips / errors ----
    ok("setTabStyle invalid -> Invalid tab style", (await rej(P.setTabStyle("bogus"))) === "Invalid tab style", await rej(P.setTabStyle("bogus")));
    await P.setTabStyle("horizontal"); ok("tabStyle roundtrip horizontal", (await P.getTabStyle()) === "horizontal");
    await P.setTabStyle("vertical");   ok("tabStyle roundtrip vertical", (await P.getTabStyle()) === "vertical");
    await P.setBrowserColorScheme("dark"); ok("colorScheme roundtrip dark", (await P.getBrowserColorScheme()) === "dark", await P.getBrowserColorScheme());
    await P.setBrowserColorScheme("system");
    await P.setHorizontalTabShrinkEnabled(true); ok("shrink roundtrip true", (await P.getHorizontalTabShrinkEnabled()) === true);
    ok("miniPopup setShortcut empty -> error", (await rej(M.setShortcut(""))) === "Invalid mini popup shortcut", await rej(M.setShortcut("")));
    await M.setShortcut("Ctrl+Space"); ok("miniPopup shortcut roundtrip", (await M.getShortcut()) === "Ctrl+Space");
    await M.setEnabled(true); ok("miniPopup enabled roundtrip", (await M.getEnabled()) === true);

    // ---- keep tasks ----
    const k = await P.getKeepTasksRunningState();
    ok("keepTasks keys", keys(k) === "canSet,enabled,policyDisabled,supported", k);
    ok("keepTasks supported/canSet true, policyDisabled false", k.supported === true && k.canSet === true && k.policyDisabled === false, k);
    await P.setKeepTasksRunningEnabled(false); ok("keepTasks roundtrip false", (await P.getKeepTasksRunningState()).enabled === false);
    await P.setKeepTasksRunningEnabled(true);  ok("keepTasks roundtrip true", (await P.getKeepTasksRunningState()).enabled === true);

    // ---- default browser / dock ----
    const d = await P.getDefaultBrowserState();
    ok("defaultBrowser keys", keys(d) === "canSet,isDefault,policyDisabled,state", d);
    ok("defaultBrowser state enum", ["not_default","default","unknown","other_mode_default"].includes(d.state), d);
    ok("defaultBrowser isDefault==(state==default)", d.isDefault === (d.state === "default"), d);
    ok("defaultBrowser policyDisabled false", d.policyDisabled === false, d);
    const dk = await P.getDockState();
    ok("dock shape", JSON.stringify(dk) === JSON.stringify({ canAdd: false, isAdded: false, supported: false }), dk);
    ok("addToDock shape", keys(await P.addToDock()) === "canAdd,isAdded,supported");

    // ---- languages ----
    const l = await P.getLanguageSettings();
    ok("languageSettings keys", keys(l) === "preferredLanguages,spellCheckEnabled,spellCheckSupported", l);
    ok("languageSettings spellCheckSupported true", l.spellCheckSupported === true, l);
    await P.setPreferredLanguages(["ko", "en"]);
    const l2 = await P.getLanguageSettings();
    ok("preferredLanguages roundtrip", JSON.stringify(l2.preferredLanguages) === JSON.stringify(["ko", "en"]), l2);
    const sl = await P.getSupportedLanguages();
    ok("supportedLanguages count", Array.isArray(sl.languages) && sl.languages.length > 50, sl.languages && sl.languages.length);
    ok("supportedLanguages item keys", keys(sl.languages[0]) === "code,displayName,nativeDisplayName,supportsSpellcheck,supportsTranslate", sl.languages[0]);
    const ko = (sl.languages || []).find(x => x.code === "ko");
    ok("supportedLanguages ko native", ko && ko.nativeDisplayName === "한국어", ko);

    // ---- search engines (wait for TemplateURLService) ----
    let se = null;
    for (let i = 0; i < 40; i++) { se = await P.getSearchEngines(); if (se.searchEngines && se.searchEngines.length) break; await sleep(250); }
    ok("prefs searchEngines keys", keys(se) === "defaultEngineId,searchEngines", se && keys(se));
    ok("prefs searchEngines item keys", se.searchEngines.length > 0 && keys(se.searchEngines[0]) === "id,isDefault,keyword,name", se.searchEngines[0]);
    ok("prefs defaultEngineId matches isDefault", typeof se.defaultEngineId === "string" && (se.searchEngines.find(x => x.isDefault) || {}).id === se.defaultEngineId, se.defaultEngineId);
    const oe = await O.getSearchEngines();
    ok("omnibox searchEngines keys", keys(oe) === "defaultEngineId,engines,loaded", oe && keys(oe));
    ok("omnibox engine has shortName/searchUrlTemplate", oe.engines.length > 0 && "shortName" in oe.engines[0] && "searchUrlTemplate" in oe.engines[0] && "faviconUrl" in oe.engines[0], oe.engines[0]);

    // ---- patch 027: original error strings / contracts (77-function RE) ----
    ok("colorScheme invalid -> error", (await rej(P.setBrowserColorScheme("bogus"))) === "Invalid browser color scheme", await rej(P.setBrowserColorScheme("bogus")));
    ok("defaultZoom out of range -> error", (await rej(P.setDefaultZoom(10))) === "Invalid default zoom", await rej(P.setDefaultZoom(10)));
    await P.setDefaultZoom(1.25); ok("defaultZoom roundtrip", Math.abs((await P.getDefaultZoom()) - 1.25) < 1e-6, await P.getDefaultZoom());
    ok("browserVersion is Aside literal", (await P.getBrowserVersion()) === "1.0.825.1", await P.getBrowserVersion());
    ok("setDefaultSearchEngine bad id -> error", (await rej(P.setDefaultSearchEngine("abc"))) === "Invalid search engine id", await rej(P.setDefaultSearchEngine("abc")));
    ok("import bad job -> error", (await rej(I.getImportProgress("nope"))) === "Invalid import job id", await rej(I.getImportProgress("nope")));
    ok("import empty options -> error", (await rej(I.startImport({}))) === "Invalid import source", await rej(I.startImport({})));
    ok("miniPopup switchProfile bad index -> error", (await rej(M.switchProfile(99))) === "Invalid Chromium profile index", await rej(M.switchProfile(99)));
    ok("notification bad tab -> error", (await rej(chrome.asideNotification.requestPermission(999999))) === "Invalid tabId for requestPermission", await rej(chrome.asideNotification.requestPermission(999999)));
    ok("notification bad origin -> error", (await rej(chrome.asideNotification.revokePermission("not a url"))) === "Invalid origin for revokePermission", await rej(chrome.asideNotification.revokePermission("not a url")));
    // omnibox session contract
    const sess = await O.createSession({});
    ok("omnibox createSession keys", keys(sess) === "aimEligible,canShowAiMode,contentSharingEnabled,sessionId,targetInternalTabId,targetTabId,targetUrl" || keys(sess) === "aimEligible,canShowAiMode,contentSharingEnabled,sessionId,targetTabId,targetUrl", sess && keys(sess));
    ok("omnibox sessionId 32 hex", /^[0-9A-F]{32}$/.test(sess.sessionId), sess.sessionId);
    ok("omnibox bad session -> error", (await rej(O.getInputState("NOPE"))) === "asideOmnibox session not found or not owned by this extension", await rej(O.getInputState("NOPE")));
    ok("omnibox addTabContext bad tab -> error", (await rej(O.addTabContext(sess.sessionId, 999999))) === "Invalid tabId", await rej(O.addTabContext(sess.sessionId, 999999)));
    ok("omnibox deleteContext bad token -> error", (await rej(O.deleteContext(sess.sessionId, "nope"))) === "Invalid contextToken", await rej(O.deleteContext(sess.sessionId, "nope")));
    ok("omnibox addFileContext bad base64 -> error", (await rej(O.addFileContext(sess.sessionId, { bytesBase64: "!!!" }))) === "Invalid bytesBase64 payload", await rej(O.addFileContext(sess.sessionId, { bytesBase64: "!!!" })));
    const fc = await O.addFileContext(sess.sessionId, { bytesBase64: btoa("hello"), fileName: "a.txt", mimeType: "text/plain" });
    ok("omnibox addFileContext ok+token", fc && fc.ok === true && /^[0-9A-F]{32}$/.test(fc.contextToken), fc);
    ok("omnibox deleteContext known token ok", (await rej(O.deleteContext(sess.sessionId, fc.contextToken))) === null);
    const st = await O.getInputState(sess.sessionId);
    ok("omnibox getInputState keys", keys(st) === "inputText,modelMode,toolMode", st);
    const oe2 = await O.getSearchEngines();
    ok("omnibox engine extra fields", oe2.engines.length > 0 && "prepopulateId" in oe2.engines[0] && "dateCreatedMs" in oe2.engines[0] && "alternateUrls" in oe2.engines[0], oe2.engines[0] && keys(oe2.engines[0]));
    await O.destroySession(sess.sessionId);
    ok("omnibox destroyed session -> error", (await rej(O.getInputState(sess.sessionId))) === "asideOmnibox session not found or not owned by this extension");

    // ---- misc ----
    ok("syncStatus keys", keys(await P.getSyncStatus()) === "isSyncing");
    const src = await I.getImportSources();
    ok("importSources shape", Array.isArray(src.sources) && src.sources.every(s => keys(s) === "id,name,profiles"), src);
    ok("importProgress unknown job -> error", (await rej(I.getImportProgress("job-x"))) === "Invalid import job id");
  } catch (e) { R.fail.push({ name: "EXCEPTION", got: String(e && e.stack || e) }); }
  const trunc = v => { try { const t = JSON.stringify(v); return t.length > 160 ? t.slice(0, 160) + "…" : t; } catch (e) { return String(v); } };
  const enc = encodeURIComponent(JSON.stringify({ passCount: R.pass.length, failCount: R.fail.length,
    fail: R.fail.map(f => ({ name: f.name, got: trunc(f.got) })) }));
  try { await chrome.tabs.create({ url: "data:text/html,<title>CONTRACT " + enc + "</title>", active: false }); } catch (e) {}
}
let started = false;
const once = () => { if (started) return; started = true; run(); };
chrome.runtime.onInstalled.addListener(once);
once();
