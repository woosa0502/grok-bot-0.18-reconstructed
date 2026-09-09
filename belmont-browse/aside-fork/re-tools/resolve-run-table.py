#!/usr/bin/env python3
"""Resolve every aside* extension-function Run() from the original arm64 binary.
Usage: resolve-run-table.py aside-arm64.bin > aside-run-analysis.json
Registration table: {factory, name, histogram} triples in __DATA_CONST; factories store the
derived vptr; Run() is vptr slot 1. See patches/027 for the helper-address legend."""
import sys, json, struct, capstone
data=open(sys.argv[1],'rb').read(); M36=0xFFFFFFFFF
md=capstone.Cs(capstone.CS_ARCH_ARM64,capstone.CS_MODE_ARM)
rd64=lambda o: struct.unpack_from('<Q',data,o)[0]
def cstr(a,maxlen=110):
    e=data.find(b'\x00',a)
    if e<0 or e-a>maxlen: return None
    try: t=data[a:e].decode('ascii'); return t if t.isprintable() else None
    except: return None
entries=[]
for off in range(0xe28d000,0xe290000,8):
    lo=rd64(off)&M36
    if 0x1000<lo<len(data):
        s=cstr(lo)
        if s and s.startswith('aside') and '.' in s:
            fac=rd64(off-8)&M36; hist=rd64(off+8)
            if hist<0x10000 and 0x1000<fac<0xc000000: entries.append((s,hist,fac))
def vptr_of(fac):
    regpage={}; last=None
    for ins in md.disasm(data[fac:fac+0x60],fac):
        m,o=ins.mnemonic,ins.op_str
        if m=="adrp":
            rd=o.split(",")[0].strip(); regpage[rd]=int(o.split("#")[1],0)
        elif m=="add" and "#" in o:
            p=[x.strip() for x in o.split(",")]
            if len(p)==3 and p[1] in regpage: last=(p[0],regpage[p[1]]+int(p[2].split("#")[1],0))
        elif m=="str" and last and o.startswith(last[0]+",") and "[x0]" in o: return last[1]
        elif m=="ret": break
out=[]
for name,hist,fac in entries:
    v=vptr_of(fac); run=(rd64(v+8)&M36) if v else None
    out.append({"name":name,"hist":hist,"factory":hex(fac),"vptr":hex(v) if v else None,"run":hex(run) if run else None})
json.dump(out,sys.stdout,indent=1)
