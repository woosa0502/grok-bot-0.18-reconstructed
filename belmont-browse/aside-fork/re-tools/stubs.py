#!/usr/bin/env python3
"""Resolve __stubs addresses in the Aside x86_64 slice to imported symbol names."""
import struct, sys
BIN="/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside_fork_map_825_20260906/extracted/aside/Aside-Framework-1.0.825.1-x86_64"
b=open(BIN,"rb").read()
magic,cputype,cpusub,filetype,ncmds,sizeofcmds,flags,res=struct.unpack_from("<7I4x",b,0)
off=32
stubs=None; symoff=nsyms=stroff=strsize=None; indirectoff=nindirect=None
for _ in range(ncmds):
    cmd,cmdsize=struct.unpack_from("<2I",b,off)
    if cmd==0x19:  # LC_SEGMENT_64
        segname=b[off+8:off+24].rstrip(b"\0").decode()
        nsects=struct.unpack_from("<I",b,off+64)[0]
        so=off+72
        for i in range(nsects):
            sect=b[so:so+80]
            sname=sect[0:16].rstrip(b"\0").decode()
            addr,size,offset=struct.unpack_from("<QQI",sect,32)
            reserved1=struct.unpack_from("<I",sect,68)[0]
            if sname=="__stubs":
                stubs=(addr,size,reserved1)
            so+=80
    elif cmd==0x2:  # LC_SYMTAB
        symoff,nsyms,stroff,strsize=struct.unpack_from("<4I",b,off+8)
    elif cmd==0xB:  # LC_DYSYMTAB
        indirectoff,nindirect=struct.unpack_from("<2I",b,off+56)
    off+=cmdsize
addr,size,reserved1=stubs
STRIDE=6
def name_for(stub_addr):
    idx=(stub_addr-addr)//STRIDE
    if idx<0 or idx*STRIDE>=size: return None
    sym=struct.unpack_from("<I",b,indirectoff+4*(reserved1+idx))[0]
    if sym & 0xC0000000: return "(local/abs)"
    n_strx=struct.unpack_from("<I",b,symoff+16*sym)[0]
    e=b.find(b"\0",stroff+n_strx)
    return b[stroff+n_strx:e].decode()
for a in sys.argv[1:]:
    v=int(a,16); print("%s -> %s"%(a,name_for(v)))
