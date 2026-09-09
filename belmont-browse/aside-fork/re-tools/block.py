#!/usr/bin/env python3
"""Print the unwind-info block (function) that contains each given address."""
import sys, gzip, json, bisect, os
FP="/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside_fork_map_825_20260906/analysis/function-match/aside_1_0_825_1.unwind-block-fingerprints.jsonl.gz"
CACHE="/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/90cd48b9-4fa7-44e3-94f9-c7bc5cf8bf4e/scratchpad/g6/blocks.json"
if os.path.exists(CACHE):
    bl=json.load(open(CACHE))
else:
    bl=[]
    with gzip.open(FP,"rt") as f:
        for l in f:
            r=json.loads(l); bl.append([r["address"],r["size"]])
    bl.sort(); json.dump(bl,open(CACHE,"w"))
bx=[x[0] for x in bl]
for a in sys.argv[1:]:
    v=int(a,16); i=bisect.bisect_right(bx,v)-1
    s,sz=bl[i]
    print("%s -> block %#x .. %#x (%d B)%s"%(a,s,s+sz,sz," INSIDE" if v<s+sz else " (past end)"))
