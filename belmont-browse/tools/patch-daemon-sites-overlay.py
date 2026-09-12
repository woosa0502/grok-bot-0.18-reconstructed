#!/usr/bin/env python3
"""belmont-browse: forward a session's per-session sites overlay to the AGENT memory_search (our code).

patch-daemon.py already routes the agent memory_search tool through globalThis.__belmontMemorySearch. This
adds `sitesRoot:<ctx>.session?.runtimeConfig?.sitesDir` to that call so an evaluation session created with
runtimeConfig.sitesDir (the learn-measure / procedure-evaluation harness) reads its isolated candidate overlay
instead of the operational site knowledge. Only the AGENT hook is touched (distinguished by the `...{queries:`
spread); the UI memory hook (the `...<ctx>,` spread form) is left alone. Optional chaining means an ordinary
session (no sitesDir) is unchanged. Idempotent; fails closed if the single expected anchor is missing/ambiguous.

Usage: patch-daemon-sites-overlay.py <daemon.mjs>   (in place; writes a .bak-sites-overlay once)
"""
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
src = path.read_text(encoding="utf-8")

already = re.compile(
    r"globalThis\.__belmontMemorySearch\(\{accountId:(\w+)\.accountId,"
    r"accountRoot:getAccountRoot\(\1\.accountId\),sitesRoot:\1\.session\?\.runtimeConfig\?\.sitesDir,\.\.\.\{queries:"
)
if already.search(src):
    print(f"{path}: already patched (sites-overlay forwarding)")
    sys.exit(0)

# The AGENT memory_search hook. The UI hook spreads a variable (`...ei,`), not an object literal, so this
# `...{queries:` form matches the agent tool alone.
anchor = re.compile(
    r"globalThis\.__belmontMemorySearch\(\{accountId:(\w+)\.accountId,"
    r"accountRoot:getAccountRoot\(\1\.accountId\),(\.\.\.\{queries:)"
)
found = anchor.findall(src)
assert len(found) == 1, f"sites-overlay anchor count {len(found)}, expected 1 (daemon bundle shape changed; refusing to patch)"

backup = path.with_name(path.name + ".bak-sites-overlay")
if not backup.exists():
    backup.write_text(src, encoding="utf-8")
src = anchor.sub(
    lambda m: f"globalThis.__belmontMemorySearch({{accountId:{m.group(1)}.accountId,"
              f"accountRoot:getAccountRoot({m.group(1)}.accountId),"
              f"sitesRoot:{m.group(1)}.session?.runtimeConfig?.sitesDir,{m.group(2)}",
    src, count=1,
)
path.write_text(src, encoding="utf-8")
print(f"{path}: sites-overlay forwarding applied")
