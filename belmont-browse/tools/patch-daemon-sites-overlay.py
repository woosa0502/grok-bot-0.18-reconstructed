#!/usr/bin/env python3
"""belmont-browse: carry a session's per-session sites overlay to the AGENT memory_search (our code).

Two independent, idempotent edits to the patched Aside daemon so an evaluation session created with
runtimeConfig.sitesDir (the learn-measure / procedure-evaluation harness) reads its isolated candidate overlay
instead of the operational site knowledge:

  1. Schema: add `sitesDir` to sessionRuntimeConfigSchema. The session-insert runtime-config schema is strict
     (it keeps only known fields + defaults), so an unknown sitesDir is silently dropped and never reaches the
     agent. This is the same mechanism patch-daemon-canonical-memory.py uses for belmontMemoryContext.
  2. Forwarding: add `sitesRoot:<ctx>.session?.runtimeConfig?.sitesDir` to the agent memory_search hook that
     patch-daemon.py already installs (matched by the `...{queries:` spread). The UI memory hook (the
     `...<ctx>,` spread form) is left alone. Optional chaining keeps ordinary sessions unchanged.

Each edit is skipped if already present; each fails closed if its single expected anchor is missing/ambiguous.
Usage: patch-daemon-sites-overlay.py <daemon.mjs>   (in place; writes a .bak-sites-overlay once)
"""
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
src = path.read_text(encoding="utf-8")
original = src
changed = []

# 1. Schema: let sitesDir survive the strict session runtime-config parse.
if "sessionRuntimeConfigSchema=object({sitesDir:" not in src:
    schema_anchor = "sessionRuntimeConfigSchema=object({"
    assert src.count(schema_anchor) == 1, f"sessionRuntimeConfigSchema anchor count {src.count(schema_anchor)}, expected 1 (refusing)"
    factory = re.search(r"sessionRuntimeConfigSchema=object\(\{[^}]*?workingDirs:array\((string\$\d+)\(\)", src)
    assert factory, "could not determine the zod string factory for sessionRuntimeConfigSchema (refusing)"
    src = src.replace(schema_anchor, f"{schema_anchor}sitesDir:{factory.group(1)}().optional(),", 1)
    changed.append("schema")

# 2. Forwarding: hand the session's sitesDir to the agent memory_search as sitesRoot.
already_fwd = re.compile(
    r"globalThis\.__belmontMemorySearch\(\{accountId:(\w+)\.accountId,"
    r"accountRoot:getAccountRoot\(\1\.accountId\),sitesRoot:\1\.session\?\.runtimeConfig\?\.sitesDir,\.\.\.\{queries:"
)
if not already_fwd.search(src):
    anchor = re.compile(
        r"globalThis\.__belmontMemorySearch\(\{accountId:(\w+)\.accountId,"
        r"accountRoot:getAccountRoot\(\1\.accountId\),(\.\.\.\{queries:)"
    )
    found = anchor.findall(src)
    assert len(found) == 1, f"sites-overlay forwarding anchor count {len(found)}, expected 1 (refusing)"
    src = anchor.sub(
        lambda m: f"globalThis.__belmontMemorySearch({{accountId:{m.group(1)}.accountId,"
                  f"accountRoot:getAccountRoot({m.group(1)}.accountId),"
                  f"sitesRoot:{m.group(1)}.session?.runtimeConfig?.sitesDir,{m.group(2)}",
        src, count=1,
    )
    changed.append("forwarding")

if not changed:
    print(f"{path}: already patched (sites-overlay schema + forwarding)")
    sys.exit(0)

backup = path.with_name(path.name + ".bak-sites-overlay")
if not backup.exists():
    backup.write_text(original, encoding="utf-8")
path.write_text(src, encoding="utf-8")
print(f"{path}: sites-overlay applied ({', '.join(changed)})")
