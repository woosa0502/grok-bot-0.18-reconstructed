#!/usr/bin/env python3
"""Dreaming writes procedures into site pages (2026-09-11).

Aside's memory taxonomy names "workflow procedures" as sites/ content, but the dreaming system prompt only
describes Current as "what do we believe now?", so the synthesis kept facts and dropped the order of steps
that reached an outcome (measured: 11 Coupang episodes → Current gained two facts, no procedure, while the
episodic entries held the full path). This adds one Page-shape rule asking for an ordered, evidence-backed
procedure on sites/ pages — names of visible controls and page transitions, never refs or selectors.
Usage: patch-daemon-dream-procedures.py <daemon.mjs>   (in place; fails before writing if the anchor changed)
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
src = path.read_text(encoding="utf-8")
MARK = "// belmont-browse-dream-procedures-v2: applied"
if MARK in src:
    print(f"{path}: already patched (dream-procedures)")
    sys.exit(0)

old = '- \\`Current\\` answers "what do we believe now?"\n'
new = (
    '- \\`Current\\` answers "what do we believe now?"\n'
    '- A \\`sites/\\` page must also answer "how do we get it done there?": when its History (or the\n'
    '  episodic window) records a workflow that reached an outcome — a sequence of pages and controls —\n'
    '  \\`Current\\` carries that workflow as an ordered procedure: start page, each control by its visible\n'
    '  name, page transitions such as a new tab or a modal, and the end state. A sites/ page with such\n'
    '  evidence but no procedure is incomplete; adding the procedure counts as a needed change even when\n'
    '  the facts did not change. Only the steps the evidence supports; never refs, selectors, or one-off values.\n'
)
assert src.count(old) == 1, f"dream-procedures anchor count {src.count(old)}, expected 1"
src = src.replace(old, new) + f"\n{MARK}\n"
path.write_text(src, encoding="utf-8")
print(f"{path}: dream-procedures patch applied")
