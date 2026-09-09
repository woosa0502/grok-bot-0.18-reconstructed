#!/usr/bin/env python3
"""List call targets of a region in the Aside x86_64 slice, and for each target
print the first strings referenced in that callee (up to N bytes) so it can be
identified."""
import sys, collections
from capstone import *
from capstone.x86 import X86_OP_MEM, X86_REG_RIP
sys.path.insert(0, "/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/re-tools")
import x86dis as X

def region_calls(start, end):
    md = Cs(CS_ARCH_X86, CS_MODE_64); md.detail = True; md.skipdata = True
    b = X.blob(); c = collections.Counter()
    for i in md.disasm(b[start:end], start):
        if i.mnemonic in ("call", "jmp") and i.op_str.startswith("0x"):
            t = int(i.op_str, 16)
            if not (start <= t < end):
                c[t] += 1
    return c

def callee_strings(t, span=0x1800, limit=6):
    md = Cs(CS_ARCH_X86, CS_MODE_64); md.detail = True; md.skipdata = True
    b = X.blob(); out = []
    for i in md.disasm(b[t:t+span], t):
        if "rip" in i.op_str:
            for op in i.operands:
                if op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP:
                    s = X.cstr(i.address + i.size + op.mem.disp)
                    if s and s not in out:
                        out.append(s)
        if i.mnemonic == "ret" and len(out) >= 1:
            break
        if len(out) >= limit:
            break
    return out

if __name__ == "__main__":
    s = int(sys.argv[1], 16); e = int(sys.argv[2], 16)
    span = int(sys.argv[3], 16) if len(sys.argv) > 3 else 0x1800
    for t, n in region_calls(s, e).most_common():
        print("%#010x  x%-3d  %s" % (t, n, callee_strings(t, span)))
