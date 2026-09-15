#!/usr/bin/env python3
"""belmont-browse: scope an eval session's document-read tools to its overlay (our code, G2-document-read).

Three independent, idempotent edits to the patched Aside daemon so a session created with
runtimeConfig.sitesDir (the learn-measure / procedure-evaluation harness) can read its isolated candidate
overlay through bash and read_file but NEVER the operational site knowledge:

  1. spawnSandboxed forwarding: the sandbox launcher destructures a fixed option set and drops unknown ones,
     so an `isolate` option never reaches the backend. Forward Cn.isolate into ci.spawn(...) unchanged.
  2. bash tool trigger: pass an `isolate` plan for eval sessions. globalThis.__belmontEvalIsolate (installed by
     installDaemonHooks) returns null for ordinary sessions, so their sandbox is unchanged; for eval sessions it
     returns allowRoots (readable roots minus operational sites + the overlay), writableRoots and excludeRoots
     (the memory/sites symlink + its target), which the bwrap backend binds symlink-safely.
  3. read_file / write_file gate: read_file bypasses the sandbox and is gated only by permission.files, into
     which the account bootstrap adds the operational knowledge/sites root. Wrap the resolved permission with
     globalThis.__belmontEvalPermission (drops operational sites, adds the overlay, denies outside read/write)
     before hasPermission, so an eval session's native reads cannot reach the operational page.

Each edit is skipped if already present; each fails closed if its single expected anchor is missing/ambiguous.
The globals are optional-chained, so a daemon without the belmont hooks behaves exactly as before.
Usage: patch-daemon-eval-isolation.py <daemon.mjs>   (in place; writes a .bak-eval-isolation once)
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
src = path.read_text(encoding="utf-8")
original = src
changed = []


def apply(name, marker, anchor, replacement):
    """Idempotent, fail-closed single-site replacement."""
    global src
    if marker in src:
        return
    count = src.count(anchor)
    assert count == 1, f"{name} anchor count {count}, expected 1 (refusing)"
    src = src.replace(anchor, replacement, 1)
    changed.append(name)


# 1. Forward the isolate option through the sandbox launcher into the backend.
apply(
    "spawn-forwarding",
    "cwd:ti,isolate:Cn.isolate,",
    "readableRoots:ri,writableRoots:ii,networkMode:ai,env:si,cwd:ti,windowsIsolation:Cn.windowsIsolation,windowsCancelFile:Cn.windowsCancelFile,detached:oi}",
    "readableRoots:ri,writableRoots:ii,networkMode:ai,env:si,cwd:ti,isolate:Cn.isolate,windowsIsolation:Cn.windowsIsolation,windowsCancelFile:Cn.windowsCancelFile,detached:oi}",
)

# 2. Give the bash tool an eval-session isolate plan (null for ordinary sessions).
apply(
    "bash-trigger",
    "isolate:globalThis.__belmontEvalIsolate?.(",
    "command:[`bash`,`-c`,oi],cwd:ii,env:mi,sandboxEnabled:ti.sandbox.enabled,readableRoots:ti.files.readableRoots.filter(",
    "command:[`bash`,`-c`,oi],cwd:ii,env:mi,sandboxEnabled:ti.sandbox.enabled,"
    "isolate:globalThis.__belmontEvalIsolate?.({session:Cn.session,accountRoot:Cn.accountRoot,readableRoots:ti.files.readableRoots,writableRoots:ti.files.writableRoots}),"
    "readableRoots:ti.files.readableRoots.filter(",
)

# 3. Scope the native read_file/write_file permission gate per eval session.
apply(
    "read-file-gate",
    "globalThis.__belmontEvalPermission?.(",
    "let ni=hasPermission(resolvePermission({accountRoot:Cn.accountRoot,permissionMode:Cn.session.permissionMode,accountPermission:Cn.settings.get(`permission`),sessionPermission:Cn.session.permission}),ti);",
    "let __belmontPerm=resolvePermission({accountRoot:Cn.accountRoot,permissionMode:Cn.session.permissionMode,accountPermission:Cn.settings.get(`permission`),sessionPermission:Cn.session.permission});"
    "__belmontPerm=globalThis.__belmontEvalPermission?.(__belmontPerm,Cn.session,Cn.accountRoot)??__belmontPerm;"
    "let ni=hasPermission(__belmontPerm,ti);",
)

if not changed:
    print(f"{path}: already patched (eval-isolation: forwarding + bash trigger + read gate)")
    sys.exit(0)

backup = path.with_name(path.name + ".bak-eval-isolation")
if not backup.exists():
    backup.write_text(original, encoding="utf-8")
path.write_text(src, encoding="utf-8")
print(f"{path}: eval-isolation applied ({', '.join(changed)})")
