#!/usr/bin/env python3
"""Disassemble a range of the Aside x86_64 slice and annotate rip-relative
string references.  Addresses are VM addresses == file offsets (base 0)."""
import sys, bisect
from capstone import *
from capstone.x86 import X86_OP_MEM, X86_REG_RIP

BIN = "/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside_fork_map_825_20260906/extracted/aside/Aside-Framework-1.0.825.1-x86_64"
CSTR = (0x0e2997c0, 0x0e2997c0 + 0x673500)
USTR = (0x0e995e50, 0x0e995e50 + 0x1373a)
OBJC_METH = (0x0e90ccc7, 0x0e90ccc7 + 0x1ae5a)
TEXT = (0x28c0, 0x28c0 + 0xd6ec3d0)
GOT = (0x0ebcd000, 0x0ebcd000 + 0x5160)

_b = None
def blob():
    global _b
    if _b is None:
        _b = open(BIN, "rb").read()
    return _b

def cstr(t):
    b = blob()
    if not (CSTR[0] <= t < CSTR[1] or OBJC_METH[0] <= t < OBJC_METH[1]):
        return None
    e = b.find(b"\x00", t)
    s = b[t:e]
    if 1 <= len(s) < 400 and all(9 <= c < 127 for c in s):
        return s.decode()
    return None

def annotate(md, start, end):
    b = blob()
    out = []
    for i in md.disasm(b[start:end], start):
        note = ""
        if "rip" in i.op_str:
            t = None
            for op in i.operands:
                if op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP:
                    t = i.address + i.size + op.mem.disp
            if t is not None:
                s = cstr(t)
                if s:
                    note = '   ; "%s"' % s.replace("\n", "\\n")
                elif GOT[0] <= t < GOT[1]:
                    note = "   ; GOT+%#x" % (t - GOT[0])
                else:
                    note = "   ; %#x" % t
        out.append("%#010x  %-8s %s%s" % (i.address, i.mnemonic, i.op_str, note))
    return out

def main():
    start = int(sys.argv[1], 16); end = int(sys.argv[2], 16)
    mode = sys.argv[3] if len(sys.argv) > 3 else "full"
    md = Cs(CS_ARCH_X86, CS_MODE_64); md.detail = True; md.skipdata = True
    lines = annotate(md, start, end)
    if mode == "str":
        seen = []
        for l in lines:
            if '; "' in l:
                s = l.split('; "', 1)[1]
                if s not in seen:
                    seen.append(s); print(l)
    elif mode == "calls":
        for l in lines:
            if '; "' in l or " call " in l or l.split()[1] in ("call", "jmp", "ret"):
                print(l)
    else:
        print("\n".join(lines))

if __name__ == "__main__":
    main()
