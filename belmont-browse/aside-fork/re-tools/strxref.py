#!/usr/bin/env python3
"""Find the address of a C string in the Aside x86_64 slice and every
`lea reg, [rip + disp]` in __text that points at it."""
import sys, numpy as np
BIN = "/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside_fork_map_825_20260906/extracted/aside/Aside-Framework-1.0.825.1-x86_64"
TEXT = (0x28c0, 0x28c0 + 0xd6ec3d0)
_b = None
def blob():
    global _b
    if _b is None: _b = open(BIN, "rb").read()
    return _b

_lea = None
def lea_table():
    """returns (site_addrs, targets) for all REX.W lea reg,[rip+disp32]"""
    global _lea
    if _lea is None:
        a = np.frombuffer(blob(), dtype=np.uint8)
        n = TEXT[1]
        c = np.nonzero((a[TEXT[0]:n-8] == 0x48) | (a[TEXT[0]:n-8] == 0x4c))[0] + TEXT[0]
        c = c[a[c+1] == 0x8d]
        c = c[(a[c+2] & 0xC7) == 0x05]
        d = a[c[:, None] + np.arange(3, 7)].astype(np.uint32)
        d = (d[:,0] | (d[:,1]<<8) | (d[:,2]<<16) | (d[:,3]<<24)).astype(np.int32)
        t = c.astype(np.int64) + 7 + d.astype(np.int64)
        _lea = (c, t)
    return _lea

def find_string(s):
    b = blob(); pat = s.encode()
    out = []; i = 0
    while True:
        i = b.find(pat, i)
        if i < 0: break
        if (i == 0 or b[i-1] == 0) and b[i+len(pat)] == 0:
            out.append(i)
        i += 1
    return out

if __name__ == "__main__":
    for s in sys.argv[1:]:
        addrs = find_string(s)
        print("== %r -> %s" % (s, [hex(a) for a in addrs]))
        c, t = lea_table()
        for a in addrs:
            sites = c[t == a]
            print("   refs:", [hex(int(x)) for x in sites])
