#!/usr/bin/env python3
"""Same as x86dis.py but for the Chrome for Testing 151.0.7922.171 mac-x64 baseline."""
import sys
from capstone import *
from capstone.x86 import X86_OP_MEM, X86_REG_RIP
BIN = "/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside_fork_map_825_20260906/extracted/cft-171/chrome-mac-x64/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/151.0.7922.171/Google Chrome for Testing Framework"
CSTR = (0x0dea5380, 0x0dea5380 + 0x672cf4)
METH = (0x0e518074, 0x0e518074 + 0x19cde)
_b=None
def blob():
    global _b
    if _b is None: _b=open(BIN,"rb").read()
    return _b
def cstr(t):
    b=blob()
    if not (CSTR[0]<=t<CSTR[1] or METH[0]<=t<METH[1]): return None
    e=b.find(b"\x00",t); s=b[t:e]
    if 1<=len(s)<400 and all(9<=c<127 for c in s): return s.decode()
    return None
def main():
    start=int(sys.argv[1],16); end=int(sys.argv[2],16)
    mode=sys.argv[3] if len(sys.argv)>3 else "full"
    md=Cs(CS_ARCH_X86,CS_MODE_64); md.detail=True; md.skipdata=True
    seen=[]
    for i in md.disasm(blob()[start:end],start):
        note=""
        if "rip" in i.op_str:
            t=None
            for op in i.operands:
                if op.type==X86_OP_MEM and op.mem.base==X86_REG_RIP:
                    t=i.address+i.size+op.mem.disp
            if t is not None:
                s=cstr(t)
                if s: note='   ; "%s"'%s.replace("\n","\\n")
                else: note="   ; %#x"%t
        line="%#010x  %-8s %s%s"%(i.address,i.mnemonic,i.op_str,note)
        if mode=="str":
            if '; "' in line:
                v=line.split('; "',1)[1]
                if v in seen: continue
                seen.append(v); print(line)
        else: print(line)
main()
