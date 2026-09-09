#!/usr/bin/env python3
"""belmont-browse: build a patched Aside daemon bundle from the untouched original (our code).
Patches exact pinned Aside 824 and 902/906/907 shapes: CDP routing, screenshot/numeric
readback corrections, account-owned memory hooks and its dedicated auth transport,
local web search, shell sandbox selection, and lazy __belmont exports.
Clean and previously patched bundles are accepted; unexpected anchors fail closed."""
import re, sys
import importlib.util
from pathlib import Path

password_patch_spec = importlib.util.spec_from_file_location("belmont_password_session_patch", Path(__file__).with_name("patch-password-session.py"))
password_patch_module = importlib.util.module_from_spec(password_patch_spec)
password_patch_spec.loader.exec_module(password_patch_module)
syms = """AgentSession AsideBrowser CdpClient globalCdpClient globalExtensionBridge ExtensionBridgeServer SessionStore AccountRegistry
getAccountRoot getSessionStorageDir settings models buildSystemPrompt createDefaultToolState resolveSuspension getActiveSuspension suspensionResponseSchemas
GlobalAgentSessionServer init_agent_session_server initializeSessionLifecycles startRoutineScheduler
startContextAwareness startContextAwarenessComprehension init_lifecycles init_scheduler init_start_context_awareness init_start_comprehension
registerStartupTabReconciliation RecentSessionsStore init_recent_sessions_store
init_store$3 init_store$1 init_skills$5 liveSuspensionRegistry BUILTIN_SKILLS_DIR ASIDE_HOME_PATH EventBus logger createAgentToolset ProjectStore
tryMigrateStateDb initAccountDirectory runAccountBootstrap stateDb syncAccountBuiltinSkills MemoryManager recoverSuspensionsOnStartup
init_agent_session init_browser init_cdp init_extension_bridge init_accounts init_directory init_tool_states init_session_notifications init_suspension""".split()

def patch_cdp_shutdown(src, version):
    """Terminal close must cancel a 907 discovery, retry, or WS handshake."""
    if version != "907":
        return src
    start = src.index("CdpClient=class{")
    end = src.index("SessionManager,init_session_manager", start)
    body = src[start:end]
    body = body.replace("clean(),ri.terminate(),ni(Cn)", "clean(),(typeof ri.terminate===`function`?ri.terminate():ri.close()),ni(Cn)")
    pairs = [
        ("CdpClient=class{cdpUrl;", "CdpClient=class{#belmontClosed=!1;#belmontAbort=new AbortController;cdpUrl;"),
        ("start(){this.#s||", "start(){if(this.#belmontClosed)return;this.#s||"),
        ("async ensureConnected(){if(this.#s=!0", "async ensureConnected(){if(this.#belmontClosed)throw Error(`CDP client closed`);if(this.#s=!0"),
        ("async close(){this.#s=!1,", "async close(){this.#belmontClosed=!0;this.#s=!1;this.#belmontAbort.abort();this.#s=!1,"),
        ("await fetch(Cn,{headers:ni})", "await fetch(Cn,{headers:ni,signal:this.#belmontAbort.signal})"),
        ("for(let ti of this.#r){ti>0&&await sleep$12(ti);try{", "for(let ti of this.#r){if(this.#belmontClosed)throw Error(`CDP client closed`);if(ti>0)await new Promise((resolve,reject)=>{const signal=this.#belmontAbort.signal;const stop=()=>{clearTimeout(timer);signal.removeEventListener(`abort`,stop);reject(Error(`CDP client closed`))};const timer=setTimeout(()=>{signal.removeEventListener(`abort`,stop);resolve()},ti);signal.addEventListener(`abort`,stop,{once:!0});if(signal.aborted)stop()});try{"),
        ("await this.#_(Cn);await new Promise", "await this.#_(Cn);if(this.#belmontClosed)throw Error(`CDP client closed`);await new Promise"),
        ("ii=!1,ai=Cn=>{ii||(ii=!0,ni(Cn))};ri.addEventListener(`open`,()=>{ii||(ii=!0,this.#x(ri),Cn())})", "ii=!1,signal=this.#belmontAbort.signal,stop=()=>ai(Error(`CDP client closed`)),clean=()=>signal.removeEventListener(`abort`,stop),ai=Cn=>{ii||(ii=!0,clean(),(typeof ri.terminate===`function`?ri.terminate():ri.close()),ni(Cn))};signal.addEventListener(`abort`,stop,{once:!0});ri.addEventListener(`open`,()=>{if(this.#belmontClosed){stop();return}ii||(ii=!0,clean(),this.#x(ri),Cn())})"),
    ]
    for old, new in pairs:
        counts = (body.count(old), body.count(new))
        # Some replacement strings contain the original prefix.
        if body.count(new) == 1:
            continue
        assert counts == (1, 0), f"907 CDP shutdown anchor {old[:60]}: {counts}"
        body = body.replace(old, new, 1)
    return src[:start] + body + src[end:]


def export_line(src):
    present = [s for s in syms if re.search(r"(?<![A-Za-z0-9_$.])" + re.escape(s) + r"(?=[=,;(])", src)]
    getters = ",".join(f'get "{s}"(){{return {s}}}' for s in present)
    return f"export const __belmont={{{getters}}};", present

def patch_memory_routing(src):
    """Pinned 824/902/906/907 anchors; preserve numeric account ownership on every hook."""
    # Upgrade previously patched bundles as well as clean upstream input.
    src = re.sub(r"globalThis\.__belmontMemorySearch\(\{accountRoot:getAccountRoot\((\w+)\.accountId\),",
                 lambda m: f"globalThis.__belmontMemorySearch({{accountId:{m.group(1)}.accountId,accountRoot:getAccountRoot({m.group(1)}.accountId),", src)
    pat = re.compile(r"(\w+)=await MemoryManager\.forAccount\((\w+)\.accountId\)\.searchMany\((\{queries:\w+,maxResults:\w+,range:\w+,excludeContextAwareness:[^}]+\})\)")
    src, count = pat.subn(lambda m: f"{m.group(1)}=await (globalThis.__belmontMemorySearch?globalThis.__belmontMemorySearch({{accountId:{m.group(2)}.accountId,accountRoot:getAccountRoot({m.group(2)}.accountId),...{m.group(3)}}}):MemoryManager.forAccount({m.group(2)}.accountId).searchMany({m.group(3)}))", src)
    assert count <= 1, f"memory tool searchMany anchor mismatch: {count}"
    def replace_once(old, new, label):
        nonlocal src
        old_count, new_count = src.count(old), src.count(new)
        if new_count == 1 and old_count == 0:
            return
        assert old_count == 1 and new_count == 0, f"{label} anchor mismatch: old={old_count}, new={new_count}"
        src = src.replace(old, new, 1)

    if 'createMemoryReadTool=xn=>' in src:
        replace_once('let Jn=MemoryManager.forAccount(xn.accountId),Yn=new Set,Zn;',
                     'let Jn=globalThis.__belmontMemorySearch?null:MemoryManager.forAccount(xn.accountId),Yn=new Set,Zn;', '824 memory manager')
        old = 'Zn=(await Promise.all(Vn.map(xn=>Jn.search({query:xn,maxResults:qn})))).flat().filter(xn=>Yn.has(xn.chunkId)?!1:(Yn.add(xn.chunkId),!0))'
        new = 'Zn=globalThis.__belmontMemorySearch?await globalThis.__belmontMemorySearch({accountId:xn.accountId,accountRoot:getAccountRoot(xn.accountId),queries:Vn,maxResults:qn}):(await Promise.all(Vn.map(xn=>Jn.search({query:xn,maxResults:qn})))).flat().filter(xn=>Yn.has(xn.chunkId)?!1:(Yn.add(xn.chunkId),!0))'
        replace_once(old, new, '824 memory tool')
        old = 'name:`memory_search`,label:`Memory search`,description:MEMORY_SEARCH_TOOL_DESCRIPTION,parameters:'
        new = 'name:`memory_search`,label:`Memory search`,description:globalThis.__belmontMemoryDescription?.({dateRange:false})??MEMORY_SEARCH_TOOL_DESCRIPTION,parameters:'
        replace_once(old, new, '824 memory description')
        assert src.count('globalThis.__belmontMemorySearch({accountId:xn.accountId,accountRoot:getAccountRoot(xn.accountId),queries:') == 1, '824 final memory tool hook mismatch'
    elif 'createMemoryReadTool=Cn=>' in src:
        old = 'search:accountProcedure.input(object({queries:array(string$2().min(1)).min(1).max(3),maxResults:number$2().int().min(1).max(10).optional()})).query('
        new = 'search:accountProcedure.input(object({queries:array(string$2().min(1)).min(1).max(3),maxResults:number$2().int().min(1).max(10).optional(),range:object({from:string$2().optional(),to:string$2().optional()}).optional()})).query('
        replace_once(old, new, '902 memory UI date range')
        old = 'let ni=await MemoryManager.forAccount(ei.accountId).searchMany({...Cn,excludeContextAwareness:!ti});'
        new = 'let ni=await (globalThis.__belmontMemorySearch?globalThis.__belmontMemorySearch({accountId:ei.accountId,accountRoot:getAccountRoot(ei.accountId),...Cn,excludeContextAwareness:!ti}):MemoryManager.forAccount(ei.accountId).searchMany({...Cn,excludeContextAwareness:!ti}));'
        replace_once(old, new, '902 memory UI router')
        old = 'name:`memory_search`,label:`Memory search`,description:MEMORY_SEARCH_TOOL_DESCRIPTION({contextAwareness:!Cn.session.incognito&&!isOnboardingSessionTrigger(Cn.session.trigger)&&isContextAwarenessReadable(Cn.accountId)}),parameters:'
        new = 'name:`memory_search`,label:`Memory search`,description:globalThis.__belmontMemoryDescription?.()??MEMORY_SEARCH_TOOL_DESCRIPTION({contextAwareness:!Cn.session.incognito&&!isOnboardingSessionTrigger(Cn.session.trigger)&&isContextAwarenessReadable(Cn.accountId)}),parameters:'
        replace_once(old, new, '902 memory description')
        assert src.count('globalThis.__belmontMemorySearch({accountId:Cn.accountId,accountRoot:getAccountRoot(Cn.accountId),...{queries:') == 1, '902/906/907 final memory tool hook mismatch'
        assert src.count('globalThis.__belmontMemorySearch({accountId:ei.accountId,accountRoot:getAccountRoot(ei.accountId),...Cn,') == 1, '902/906/907 final memory UI hook mismatch'
    else:
        raise AssertionError('unsupported memory tool bundle; expected pinned 824 or 902/906/907 shape')
    return src

def patch_memory_transport(src):
    """Keep AsideMossAuthenticator intact; only its exact token endpoints use the hook.

    Original account refresh, output schema, typed errors and anonymous 401/403
    fallback remain upstream-owned. The runner installs the real HTTPS transport.
    """
    variants = [("Cn", "ri"), ("xn", "Jn")]
    matches = [(endpoint, options) for endpoint, options in variants
               if f"rawFetchAsideAPI({endpoint},{options})" in src]
    assert len(matches) == 1, "unsupported memory transport bundle; expected pinned API client shape"
    endpoint, options = matches[0]
    old = f"return await rawFetchAsideAPI({endpoint},{options})"
    new = f"return await (globalThis.__belmontMemoryApi?.accepts({endpoint})?globalThis.__belmontMemoryApi.request({endpoint},{options},createFetch):rawFetchAsideAPI({endpoint},{options}))"
    if src.count(new) == 1 and src.count(old) == 0:
        return src
    assert src.count(old) == 1 and src.count(new) == 0, "memory transport anchor mismatch"
    return src.replace(old, new, 1)

def patch_numeric_fill(src):
    """Accept only lossless thousands grouping in the pinned input readback path."""
    variants = {
        "824": ("async function fillElement(xn,jn,Vn){", "Jn"),
        "902": ("async function fillElement(Cn,ei,ti){", "ri"),
    }
    matches = [(version, value) for version, value in variants.items() if value[0] in src]
    assert len(matches) == 1, "unsupported numeric fill bundle; expected pinned 824 or 902"
    version, (start, result) = matches[0]
    assert src.count(start) == 1, f"{version} fill function anchor mismatch"
    begin = src.index(start)
    end = src.find("async function selectOptionElement(", begin)
    assert end > begin, f"{version} fill end anchor mismatch"
    body = src[begin:end]
    old = """`function(kind) {
        const target = globalThis.__aside?.retarget(this, 'follow-label') || this;
        if (kind === 'contenteditable') return target.innerText || '';
        return typeof target.value === 'string' ? target.value : '';
      }`,""" + result + ".kind)"
    # Use explicit ASCII digits; compare strings to preserve leading zeros and precision.
    new = r"""`function(kind, expectedValue) {
        const target = globalThis.__aside?.retarget(this, 'follow-label') || this;
        if (kind === 'contenteditable') return target.innerText || '';
        const actualValue = typeof target.value === 'string' ? target.value : '';
        const inputType = String(target.type || '').toLowerCase();
        if (kind === 'input' && target.tagName?.toUpperCase() === 'INPUT' &&
            ['text', 'search', 'tel'].includes(inputType) &&
            /^[0-9]+$/.test(expectedValue) && /^[0-9]{1,3}(?:,[0-9]{3})+$/.test(actualValue) &&
            actualValue.replace(/,/g, '') === expectedValue) return expectedValue;
        return actualValue;
      }`,""" + result + ".kind," + result + ".expectedValue)"
    old_count, new_count = body.count(old), body.count(new)
    if new_count == 1 and old_count == 0:
        return src
    assert old_count == 1 and new_count == 0, f"{version} numeric fill anchor mismatch: old={old_count}, new={new_count}"
    return src[:begin] + body.replace(old, new, 1) + src[end:]

def patch_local_web_search(src):
    """Replace only the websearch execute entry; retain the original cloud path and toolset."""
    variants = {
        "824": ("xn", "jn", "Vn", "qn", "Jn", "Yn", "Zn", "Qn"),
        "902": ("Cn", "ei", "ti", "ni", "ri", "ii", "ai", "oi"),
    }
    matches = [(version, args) for version, args in variants.items() if f"createWebSearchTool={args[0]}=>" in src]
    assert len(matches) == 1, "unsupported local websearch bundle; expected pinned 824 or 902"
    version, (context, call, objective, queries, mode, signal, details, result) = matches[0]
    for helper in ["function buildGoogleSearchUrl(", "function parseGoogleSearchHtml(", "function parseHtml(", "function withReplContext(", "function buildWebSearchToolResult(", "async function checkPermission(", "async function rejectSuspension(", "init_google_search=", "init_context$1=", "init_permission="]:
        assert src.count(helper) == 1, f"{version} local websearch helper anchor mismatch: {helper}"
    old = f"createWebSearchTool={context}=>({{name:`websearch`,label:`Web Search`,description:TOOL_DESCRIPTION,parameters,execute:async({call},{{objective:{objective},search_queries:{queries},mode:{mode}}},{signal})=>{{let{{details:{details},result:{result}}}="
    previous_branch = f"if(globalThis.__belmontLocalWebSearch?.enabled()){{init_google_search();init_context$1();return await globalThis.__belmontLocalWebSearch.execute({{context:{context},toolCallId:{call},args:{{objective:{objective},search_queries:{queries},mode:{mode}}},signal:{signal},native:{{withReplContext,parseHtml,parseGoogleSearchHtml,buildGoogleSearchUrl,buildWebSearchToolResult}}}});}}"
    previous = old.replace("=>{let{details:", "=>{" + previous_branch + "let{details:")
    cancel = "cancelPendingApproval:(context,id)=>{if(!liveSuspensionRegistry.has(context.session.id+`:`+id))return;let pending=SessionStore.get(context.accountId,context.session.id)?.suspension;if(pending?.kind===`approval`&&pending.toolCallId===id&&!pending.response&&!pending.error)return rejectSuspension({accountId:context.accountId,sessionId:context.session.id,toolCallId:id,error:`Local web search aborted`});}"
    branch = f"if(globalThis.__belmontLocalWebSearch?.enabled()){{init_google_search();init_context$1();init_permission();return await globalThis.__belmontLocalWebSearch.execute({{context:{context},toolCallId:{call},args:{{objective:{objective},search_queries:{queries},mode:{mode}}},signal:{signal},native:{{engine:`{version}`,withReplContext,parseHtml,parseGoogleSearchHtml,buildGoogleSearchUrl,buildWebSearchToolResult,checkPermission,{cancel}}}}});}}"
    new = old.replace("parameters,execute:", "parameters,...(globalThis.__belmontLocalWebSearch?.enabled()?{executionMode:`sequential`}:{}),execute:")
    new = new.replace("=>{let{details:", "=>{" + branch + "let{details:")
    old_count, previous_count, new_count = src.count(old), src.count(previous), src.count(new)
    if new_count == 1 and old_count == 0 and previous_count == 0:
        return src
    assert old_count + previous_count == 1 and new_count == 0, f"{version} local websearch anchor mismatch: old={old_count}, previous={previous_count}, new={new_count}"
    return src.replace(old if old_count else previous, new, 1)

if len(sys.argv) == 3 and sys.argv[1] == "--refresh-local-web-search":
    dst_path = sys.argv[2]
    src = open(dst_path, encoding="utf-8").read()
    src = patch_local_web_search(src)
    open(dst_path, "w", encoding="utf-8").write(src)
    print(f"{dst_path}: local websearch refreshed with exact anchors")
    sys.exit(0)

if len(sys.argv) == 3 and sys.argv[1] == "--refresh-numeric-fill":
    dst_path = sys.argv[2]
    src = open(dst_path, encoding="utf-8").read()
    src = patch_numeric_fill(src)
    open(dst_path, "w", encoding="utf-8").write(src)
    print(f"{dst_path}: numeric fill refreshed with exact anchors")
    sys.exit(0)

if len(sys.argv) == 3 and sys.argv[1] == "--refresh-memory":
    dst_path = sys.argv[2]
    src = open(dst_path, encoding="utf-8").read()
    src = patch_memory_routing(src)
    src = patch_memory_transport(src)
    open(dst_path, "w", encoding="utf-8").write(src)
    print(f"{dst_path}: memory routing refreshed with exact anchors")
    sys.exit(0)

if len(sys.argv) == 4 and sys.argv[1] == "--refresh-cdp-shutdown":
    dst_path, version = sys.argv[2:]
    src = open(dst_path, encoding="utf-8").read()
    src = patch_cdp_shutdown(src, version)
    open(dst_path, "w", encoding="utf-8").write(src)
    print(f"{dst_path}: {version} CDP shutdown refreshed with exact anchors")
    sys.exit(0)

if len(sys.argv) == 3 and sys.argv[1] == "--refresh-exports":
    dst_path = sys.argv[2]
    src = open(dst_path, encoding="utf-8").read()
    body, count = re.subn(r"^export const __belmont=.*?;$", "", src, flags=re.M)
    assert count == 1, f"expected one generated __belmont export, found {count}"
    line, present = export_line(body)
    src = re.sub(r"^export const __belmont=.*?;$", lambda _: line, src, flags=re.M)
    open(dst_path, "w", encoding="utf-8").write(src)
    print(f"{dst_path}: refreshed {len(present)} getters; bundle body unchanged")
    sys.exit(0)
src_path, dst_path, version = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(src_path, encoding="utf-8").read()
old = "globalCdpClient=new CdpClient}"
new = 'globalCdpClient=new CdpClient(process.env.BELMONT_CDP_URL?{cdpUrl:process.env.BELMONT_CDP_URL,logId:"belmont-cdp"}:{})}'
assert (src.count(old), src.count(new)) in [(1, 0), (0, 1)], "globalCdpClient anchor"
src = src.replace(old, new, 1)
src = patch_cdp_shutdown(src, version)
pat = re.compile(r"`function\(margin\) \{(\s+const rect = this\.getBoundingClientRect\(\);)")
src, n_fix = pat.subn(r"`function(_element, margin) {\1", src)
assert n_fix == 1 or (n_fix == 0 and src.count('`function(_element, margin) {') == 1), f"locator.screenshot anchor ({n_fix})"
# (4) opt-out of the shell tool: browse sessions rarely need a shell and, on Linux, Aside has no sandbox backend
#     (PassthroughBackend), so guard mode would run bash unrestricted. Gated at runtime by BELMONT_BROWSE_NO_BASH=1.
pat_bash = re.compile(r"createReadFileTool\(\{context:(\w+)\}\),createTerminalTool\(\1\),")
src, n_bash = pat_bash.subn(r'createReadFileTool({context:\1}),...(process.env.BELMONT_BROWSE_NO_BASH==="1"?[]:[createTerminalTool(\1)]),', src)
assert n_bash == 1 or (n_bash == 0 and src.count('process.env.BELMONT_BROWSE_NO_BASH==="1"?[]:') == 1), f"terminal tool anchor ({n_bash})"
# (5) account-aware memory routing. The runner chooses native or degraded FTS.
# (6) Linux shell sandbox: the daemon has no Linux backend (824 had a bubblewrap one that could not exec; 902 dropped it).
#     Use globalThis.__belmontSandboxBackend when installed, else Aside's passthrough.
pat_sb = re.compile(r"(function createSandboxBackend\(\)\{switch\(process\.platform\)\{case`darwin`:return new MacOSSandboxBackend;case`win32`:return new WindowsSandboxBackend;)(?:case`linux`:return new LinuxSandboxBackend;)?default:return new PassthroughBackend\}\}")
src, n_sb = pat_sb.subn(r"\1default:return globalThis.__belmontSandboxBackend??new PassthroughBackend}}", src)
assert n_sb == 1 or (n_sb == 0 and src.count('default:return globalThis.__belmontSandboxBackend??new PassthroughBackend}}') == 1), f"sandbox backend anchor ({n_sb})"
print(f"  patches: sandbox={n_sb}; native memory routing/transport checked below")
src = patch_memory_routing(src)
src = patch_memory_transport(src)
src = patch_numeric_fill(src)
src = patch_local_web_search(src)
# Expiry refresh must never undo an explicit user lock in the pinned 907 vault.
src = password_patch_module.patch_password_session(src, version)
# Refresh our own generated footer without duplicating exports on already patched input.
src = re.sub(r"\n// belmont-browse: patched from Aside daemon [^\n]*\nexport const __belmont=[^\n]*;\n", "", src)
assert not re.search(r"^export const __belmont=", src, flags=re.M), "unexpected existing __belmont export shape"
line, present = export_line(src)
src += f"\n// belmont-browse: patched from Aside daemon {version}; see tools/patch-daemon.py for patches\n{line}\n"
open(dst_path, "w", encoding="utf-8").write(src)
print(f"{version}: written {len(src):,} chars, getters {len(present)}, missing {[s for s in syms if s not in present]}")
