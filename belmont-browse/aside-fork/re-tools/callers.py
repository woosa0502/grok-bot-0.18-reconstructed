#!/usr/bin/env python3
"""Find call sites (E8 rel32) anywhere in the Aside x86_64 __text whose target
lands inside a given address range.  Byte-level scan: some hits are false
positives (0xE8 inside another instruction), so results are cross-checked
against the unwind block list when available."""
import sys, numpy as np, gzip, json, bisect
BIN = "/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside_fork_map_825_20260906/extracted/aside/Aside-Framework-1.0.825.1-x86_64"
TEXT = (0x28c0, 0x28c0 + 0xd6ec3d0)
FP = "/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside_fork_map_825_20260906/analysis/function-match/aside_1_0_825_1.unwind-block-fingerprints.jsonl.gz"

def blocks():
    out = []
    with gzip.open(FP, "rt") as f:
        for l in f:
            r = json.loads(l); out.append((r["address"], r["size"]))
    out.sort(); return out

def main():
    lo = int(sys.argv[1], 16); hi = int(sys.argv[2], 16)
    b = np.fromfile(BIN, dtype=np.uint8)
    n = TEXT[1]
    e8 = np.nonzero(b[TEXT[0]:n] == 0xE8)[0] + TEXT[0]
    e8 = e8[e8 + 5 < n]
    disp = b[e8[:, None] + np.arange(1, 5)].astype(np.uint32)
    disp = (disp[:, 0] | (disp[:, 1] << 8) | (disp[:, 2] << 16) | (disp[:, 3] << 24)).astype(np.int32)
    tgt = e8.astype(np.int64) + 5 + disp.astype(np.int64)
    m = (tgt >= lo) & (tgt < hi)
    sites = e8[m]; tg = tgt[m]
    bl = blocks(); bx = [x[0] for x in bl]
    for s, t in zip(sites, tg):
        i = bisect.bisect_right(bx, int(s)) - 1
        owner = bl[i] if i >= 0 else (0, 0)
        inside = owner[0] <= s < owner[0] + owner[1]
        print("call site %#010x -> %#010x   owner_block %#010x(+%d)%s" %
              (s, t, owner[0], owner[1], "" if inside else "  [outside blocks]"))
main()
