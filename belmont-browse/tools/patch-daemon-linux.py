#!/usr/bin/env python3
"""Install Linux command adapters while preserving Aside's original crypto/bootstrap.
Supports the original 7-8 marker and already patched 906 bundles. Fails before writing
if an anchor changed. The caller decides whether the target is a fixture or deployment.
"""
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
src = path.read_text(encoding="utf-8")
MARK = "// belmont-browse-linux: installation-v2 applied"
if MARK in src:
    print(f"{path}: already patched (installation-v2)")
    sys.exit(0)


def replace(old, new, expected=1):
    global src
    actual = src.count(old)
    assert actual == expected, f"Linux patch anchor count {actual}, expected {expected}: {old[:100]}"
    src = src.replace(old, new)


adapter = "globalThis.__belmontLinuxInstallation"
available = f"process.platform===`linux`&&{adapter}?.available===!0"

# Remove the old SIG==KEM shim; public keys now come from real persistent distinct keys.
legacy = 'if(process.env.BELMONT_INSTALL_SIG_PUB)return{scheme:"p256_v1",sig:process.env.BELMONT_INSTALL_SIG_PUB,kem:process.env.BELMONT_INSTALL_SIG_PUB};'
assert src.count(legacy) in (0, 1), "legacy public-key shim count"
src = src.replace(legacy, "")

for function in ("assertAvailable", "assertSupported"):
    replace(f"function {function}(){{", f"function {function}(){{if({available})return;")
replace("function runNativeKeyCommand(Cn,ei={}){", f"function runNativeKeyCommand(Cn,ei={{}}){{if({available})return {adapter}.runNativeKeyCommand(Cn,ei);")
replace("async function isNativeInstallationHelperAvailable(){", f"async function isNativeInstallationHelperAvailable(){{if({available})return!0;")

# Replace both the old plaintext Linux shim and clean native-only implementation.
a = src.index("async function runSecureStorageCommand(Cn,ei){")
b = src.index("async function saveSecureStorageItem", a)
assert "runNativeSecureStorageCommand" in src[a:b], "secure storage function boundary"
src = src[:a] + f"async function runSecureStorageCommand(Cn,ei){{if({available})return {adapter}.runSecureStorageCommand(Cn,ei);let ti=runNativeSecureStorageCommand(Cn===`save`?`secure-save`:Cn===`read`?`secure-read`:`secure-clear`,ei);if(ti)return ti;throw Error(`Secure storage is not supported on platform ${{process.platform}}`)}}" + src[b:]

# Whole installation transactions stage native and storage mutations together. Nested
# original calls reuse the transaction. A partial/corrupt Linux installation is never
# interpreted as permission to destroy the existing browser signing identity.
for function in ("getNativeInstallationStatus", "initNativeInstallation", "destroyNativeInstallation", "unwrapNativeDk"):
    replace(f"async function {function}(){{", f"async function {function}Unlocked(){{")
    cleanup = ".then(Cn=>{dk=null;return Cn})" if function == "destroyNativeInstallation" else ""
    src += f"\nasync function {function}(){{return {available}?{adapter}.withInstallationTransaction(()=>{function}Unlocked()){cleanup}:{function}Unlocked()}}\n"
replace("async function getNativeInstallationStatusUnlocked(){", "async function getNativeInstallationStatusUnlocked(){" + f"if({available}){{let Cn=getNativeKeysInstalled(),ei=await getStoredMeta(),ti=await getStoredWrappedDk();if(!Cn&&!ei&&!ti)return{{installed:!1}};if(!Cn||!ei||!ti)throw Error(`Incomplete Linux installation; preserved identity and storage require recovery`);let ni=await unwrapDkP256(ti);try{{if(ni.length!==32)throw Error(`Invalid installation DK length`)}}finally{{ni.fill(0)}}return{{installed:!0,scheme:ei.scheme}}}}")

fallback = 'if(process.platform!==`darwin`&&process.platform!==`win32`){dk=crypto.getRandomValues(new Uint8Array(32));return}'
assert src.count(fallback) in (0, 1), "random DK fallback count"
src = src.replace(fallback, "")
replace("function supportsInstallationBackedLocalKeys(){return process.platform===`darwin`||process.platform===`win32`}", f"function supportsInstallationBackedLocalKeys(){{return process.platform===`darwin`||process.platform===`win32`||({available})}}")

# Preserve original Windows session-storage semantics on Linux. This adds storage,
# never biometric authorization or an invented bootstrap-complete state.
for function, params in (("saveSessionToKeychain", "Cn,ei"), ("loadSessionFromKeychain", "Cn"), ("clearSessionKeychain", "Cn")):
    replace(f"async function {function}({params}){{if(process.platform===`win32`)", f"async function {function}({params}){{if(process.platform===`win32`||({available}))")
replace("function getDesktopPlatform(){return process.platform===`darwin`?`macos`:process.platform===`win32`?`windows`:null}", f"function getDesktopPlatform(){{return process.platform===`darwin`?`macos`:process.platform===`win32`?`windows`:({available})?`linux`:null}}")

# Preserve the existing server export, including unrelated prior bundle edits.
if "export const __belmontServer=" not in src:
    assert len(re.findall(r"serve=\((\w+),(\w+)\)=>\{let \w+=createAdaptorServer\(\1\)", src)) == 1, "serve anchor"
    assert "import_websocket_server=__toESM$1(require_websocket_server(),1)" in src, "ws anchor"
    src += "\nexport const __belmontServer={get serve(){return serve},get WebSocketServer(){return import_websocket_server.default},get createServer(){return createServer}};\n"
exports = {}
for name in ("initInstallation", "getInstallationStatus", "getPublicKeys", "unwrapDk", "signCdpChallenge", "destroyNativeInstallation", "unlock", "encrypt", "decrypt"):
    exports[name] = "init_installation"
for name in ("saveSecureStorageItem", "readSecureStorageItem", "clearSecureStorageItem"):
    exports[name] = "init_secure_storage"
for name in ("saveSessionToKeychain", "loadSessionFromKeychain", "clearSessionKeychain"):
    exports[name] = "init_biometric"
exports["loadPwmSessionFromKeychain"] = "init_session$2"
exports["getAccountDeviceRegistration"] = "init_device"
src += "\nexport const __belmontLinuxInternals={" + ",".join(f"get {name}(){{{initializer}();return {name}}}" for name, initializer in exports.items()) + "};\n"

# Folder / file reveal on Linux (the original only implements win32 via the native helper
# and darwin via `open`; every other platform throws, which the daemon surfaces as HTTP 500
# for /session/for-chrome/:id/open-folder, tRPC meta.open and the project "Open Project
# Folder" button). Under WSL the path is handed to Windows Explorer through wslpath; on a
# plain Linux desktop xdg-open takes it.
open_throw = "throw Error(`Opening system paths is not supported on ${process.platform}`)}"
open_linux = (
    "if(process.platform===`linux`){"
    "let ti=!!process.env.WSL_DISTRO_NAME||!!process.env.WSL_INTEROP;"
    "if(!ti)try{ti=/microsoft/i.test(await fs$16.readFile(`/proc/version`,`utf8`))}catch{}"
    "if(ti){let ni=spawnCommand([`wslpath`,`-w`,Cn],{stdio:[`ignore`,`pipe`,`ignore`]}),ri=(await readProcessStream(ni.stdout)).trim();"
    "if(await waitForExitCode(ni)!==0||!ri)throw Error(`Failed to translate path for Windows Explorer: ${Cn}`);"
    "let ii=`/mnt/c/Windows/explorer.exe`;try{await fs$16.access(ii)}catch{ii=`explorer.exe`}"
    "let ai=ei.mode===`reveal`&&ei.targetType===`file`?[ii,`/select,`+ri]:[ii,ri],oi=spawnCommand(ai,{stdio:`ignore`,detached:!0});oi.unref();return}"
    "if(await waitForExitCode(spawnCommand([`xdg-open`,Cn],{stdio:`ignore`}))!==0)throw Error(`Failed to ${ei.mode} path: ${Cn}`);return}"
    + open_throw
)
replace(open_throw, open_linux)

src += f"\n{MARK}\n"
path.write_text(src, encoding="utf-8")
print(f"{path}: patched (installation-v2)")
