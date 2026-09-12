#!/usr/bin/env python3
"""Add Belmont's canonical-memory authority boundary to an already recovered daemon.

Apply LAST, after the lifecycle/workload/site-knowledge transforms. This source
generator does not modify archives until explicitly invoked by the build owner.
All exact anchors must match before the destination is written. Legacy mode
retains the recovered implementation; canonical mode rejects native memory writes.
"""
import argparse
from pathlib import Path

MARKER = "// belmont-canonical-memory-guard: v1"
SHIM = r'''
function __belmontCanonicalMemoryEnabled() {
  return process.env.BELMONT_MEMORY_AUTHORITY === "belmont";
}
function __belmontCanonicalMemoryDeny() {
  throw Object.assign(Error("Belmont owns canonical memory; submit an experience or procedure candidate to Belmont"), { code: "BELMONT_CANONICAL_MEMORY_AUTHORITY" });
}
function __belmontCanonicalMemoryPathDenied(value) {
  if (!__belmontCanonicalMemoryEnabled() || typeof value !== "string") return false;
  const target = resolveRealPath(value);
  const roots = [...AccountRegistry.getAll().accounts.map((account) => path.join(getAccountRoot(account.id), "memory")), ...(globalThis.__belmontCanonicalMemoryRoots ?? [])];
  return roots.some((entry) => {
    const root = resolveRealPath(entry);
    const relative = path.relative(root, target);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}
export const __belmontCanonicalMemoryGuard = 1;
'''


def patch(source):
    if MARKER in source:
        if source.count(MARKER) != 1 or source.count("export const __belmontCanonicalMemoryGuard = 1;") != 1:
            raise ValueError("Canonical memory guard marker mismatch")
        return source
    kind = "Turn" if "SessionTurnMemoryBackfill" in source else "Run"
    changes = [
        ("MemoryHook=Cn=>{", "MemoryHook=Cn=>{if(__belmontCanonicalMemoryEnabled())return{};"),
        ("function extractMemories(...args) {", "function extractMemories(...args) {\n  if (__belmontCanonicalMemoryEnabled()) return Promise.reject(Object.assign(Error(\"Belmont owns memory extraction\"), { code: \"BELMONT_CANONICAL_MEMORY_AUTHORITY\" }));"),
        ("function runDreaming(...args) {", "function runDreaming(...args) {\n  if (__belmontCanonicalMemoryEnabled()) return Promise.reject(Object.assign(Error(\"Belmont owns dreaming\"), { code: \"BELMONT_CANONICAL_MEMORY_AUTHORITY\" }));"),
        ("function digestContextAwareness(...args) {", "function digestContextAwareness(...args) {\n  if (__belmontCanonicalMemoryEnabled()) return Promise.resolve();"),
        (f"function startSession{kind}MemoryBackfill(...args) {{", f"function startSession{kind}MemoryBackfill(...args) {{\n  if (__belmontCanonicalMemoryEnabled()) return Promise.resolve();"),
        ("function startContextAwareness() {", "function startContextAwareness() {\n  if (__belmontCanonicalMemoryEnabled()) return;"),
        ("function startContextAwarenessComprehension() {", "function startContextAwarenessComprehension() {\n  if (__belmontCanonicalMemoryEnabled()) return;"),
        ("async function updateMemoryPage(Cn,ei){", "async function updateMemoryPage(Cn,ei){if(__belmontCanonicalMemoryEnabled())__belmontCanonicalMemoryDeny();"),
        ("async function ensureRoutineMemory(Cn,ei){", "async function ensureRoutineMemory(Cn,ei){if(__belmontCanonicalMemoryEnabled())return;"),
        ("static init(Cn){let ei=getAccountRoot(Cn)", "static init(Cn){if(__belmontCanonicalMemoryEnabled())return;let ei=getAccountRoot(Cn)"),
        ("function hasPermission(Cn,ei){", "function hasPermission(Cn,ei){if(ei.type===`file`&&__belmontCanonicalMemoryPathDenied(ei.path))return`deny`;"),
        ("async function buildSystemPrompt({scanContexts:Cn,skills:ei,customPrompt:ti}){", "async function buildSystemPrompt({scanContexts:Cn,skills:ei,customPrompt:ti}){if(__belmontCanonicalMemoryEnabled()&&Cn)Cn={...Cn,includeMemory:false};"),
        ('process.env.BELMONT_BROWSE_NO_BASH==="1"?[]:', '(process.env.BELMONT_BROWSE_NO_BASH==="1"||__belmontCanonicalMemoryEnabled())?[]:'),
        ('workingDirs:array(string$3().trim().min(1)).default([])}).prefault({}),sessionRuntimeConfigPatchSchema=', 'workingDirs:array(string$3().trim().min(1)).default([]),belmontMemoryContext:unknown$1().optional(),belmontMemoryObservation:unknown$1().optional()}).prefault({}),sessionRuntimeConfigPatchSchema='),
        ('workingDirs:array(string$3().trim().min(1)).optional()}),sessionIdSchema=', 'workingDirs:array(string$3().trim().min(1)).optional(),belmontMemoryContext:unknown$1().optional(),belmontMemoryObservation:unknown$1().optional()}),sessionIdSchema='),
    ]
    for old, new in changes:
        if source.count(old) != 1 or source.count(new) != 0:
            raise ValueError(f"Canonical memory anchor mismatch: {old[:100]}")
    for old, new in changes:
        source = source.replace(old, new, 1)
    return source + "\n" + MARKER + "\n" + SHIM


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path, nargs="?")
    args = parser.parse_args()
    result = patch(args.input.read_text(encoding="utf-8"))
    (args.output or args.input).write_text(result, encoding="utf-8")


if __name__ == "__main__":
    main()
