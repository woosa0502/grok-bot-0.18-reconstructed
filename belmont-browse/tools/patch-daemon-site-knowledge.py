#!/usr/bin/env python3
"""Site knowledge reaches the agent (2026-09-11). Two original gaps, patched in place, idempotent.

1. Skill/keyword auto-inject used an ASCII word-boundary regex (\\b), so a Korean keyword such as "쿠팡"
   never matched a Korean task ("쿠팡에서 ...") — site skills for Korean sites were never injected.
   Keywords that are not plain \\w words now match as case-insensitive substrings.
2. The four memory walkers (auto-inject scan, Moss index listing, memory snapshot, relative listing) used
   Dirent.isDirectory()/isFile(), which are false for symlinks, so `memory/sites` (a link into the Belmont
   knowledge store) was invisible to memory_search and to URL auto-inject. Symlinked entries are now
   resolved with fs.stat and treated by their target type.
Usage: patch-daemon-site-knowledge.py <daemon.mjs>   (overwrites in place; fails before writing if an anchor changed)
"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
src = path.read_text(encoding="utf-8")
MARK = "// belmont-browse-site-knowledge: applied"
if MARK in src:
    print(f"{path}: already patched (site-knowledge)")
    sys.exit(0)


def replace(old, new, expected=1):
    global src
    actual = src.count(old)
    assert actual == expected, f"site-knowledge anchor count {actual}, expected {expected}: {old[:90]}"
    src = src.replace(old, new)


# 1. Korean-aware keyword match.
replace(
    "function matchesWholeWord(Cn,ei){return RegExp(`\\\\b${ei.replace(/[.*+?^${}()|[\\]\\\\]/g,`\\\\$&`)}\\\\b`,`i`).test(Cn)}",
    "function matchesWholeWord(Cn,ei){if(!/^\\w+$/.test(ei))return Cn.toLowerCase().includes(ei.toLowerCase());return RegExp(`\\\\b${ei.replace(/[.*+?^${}()|[\\]\\\\]/g,`\\\\$&`)}\\\\b`,`i`).test(Cn)}",
)

# 2. Memory walkers follow symlinks (resolve the target type with fs.stat).
replace(
    "for(let ni of ti){let ti=path.join(Cn,ni.name);if(ni.isDirectory()){if(ni.name.startsWith(`.`))continue;ei.push(...await findMarkdownFiles(ti))}else ni.name.endsWith(`.md`)&&ei.push(ti)}return ei}",
    "for(let ni of ti){let ti=path.join(Cn,ni.name),__d=ni.isDirectory();if(ni.isSymbolicLink()){try{__d=(await nodeFs.stat(ti)).isDirectory()}catch{continue}}if(__d){if(ni.name.startsWith(`.`))continue;ei.push(...await findMarkdownFiles(ti))}else ni.name.endsWith(`.md`)&&ei.push(ti)}return ei}",
)
replace(
    "let ti=path.join(Cn,ei.name);return ei.isDirectory()?listMarkdownFiles$1(ti):ei.isFile()&&ei.name.endsWith(`.md`)?[ti]:[]}))).flat().sort()}",
    "let ti=path.join(Cn,ei.name),__d=ei.isDirectory(),__f=ei.isFile();if(ei.isSymbolicLink()){try{let __s=await nodeFs.stat(ti);__d=__s.isDirectory();__f=__s.isFile()}catch{return[]}}return __d?listMarkdownFiles$1(ti):__f&&ei.name.endsWith(`.md`)?[ti]:[]}))).flat().sort()}",
)
replace(
    "if(ii.isDirectory())await ni(ri);else if(ii.isFile()&&ii.name.endsWith(`.md`)){if(isContextAwarenessMemoryPath(ai))continue;ti.set(ai,await nodeFs.readFile(ri,`utf-8`))}",
    "let __d=ii.isDirectory(),__f=ii.isFile();if(ii.isSymbolicLink()){try{let __s=await nodeFs.stat(ri);__d=__s.isDirectory();__f=__s.isFile()}catch{continue}}if(__d)await ni(ri);else if(__f&&ii.name.endsWith(`.md`)){if(isContextAwarenessMemoryPath(ai))continue;ti.set(ai,await nodeFs.readFile(ri,`utf-8`))}",
)
replace(
    "if(ai.isDirectory())await ni(ii);else if(ai.isFile()&&ai.name.endsWith(`.md`)){let ni=path.relative(Cn,ii).split(path.sep).join(`/`);(ei||!isContextAwarenessMemoryPath(ni))&&ti.push(ni)}",
    "let __d=ai.isDirectory(),__f=ai.isFile();if(ai.isSymbolicLink()){try{let __s=await nodeFs.stat(ii);__d=__s.isDirectory();__f=__s.isFile()}catch{continue}}if(__d)await ni(ii);else if(__f&&ai.name.endsWith(`.md`)){let ni=path.relative(Cn,ii).split(path.sep).join(`/`);(ei||!isContextAwarenessMemoryPath(ni))&&ti.push(ni)}",
)

src += f"\n{MARK}\n"
path.write_text(src, encoding="utf-8")
print(f"{path}: site-knowledge patch applied")
