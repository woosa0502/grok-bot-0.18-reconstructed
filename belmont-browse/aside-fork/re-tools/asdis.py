import sys
from capstone import *
b=open("aside-arm64.bin","rb").read()
md=Cs(CS_ARCH_ARM64,CS_MODE_ARM); md.skipdata=True
def dump(start,end,only_calls=False):
    last={}
    for i in md.disasm(b[start:end],start):
        txt=f"{i.address:#x} {i.mnemonic} {i.op_str}"
        if i.mnemonic=="adrp":
            rd,imm=i.op_str.split(", "); last[rd]=int(imm.lstrip("#"),16)
        note=""
        if i.mnemonic=="add" and i.op_str.count(", ")==2 and "#0x" in i.op_str:
            rd,rn,imm=i.op_str.split(", ")
            if rn in last:
                t=last[rn]+int(imm.lstrip("#"),16)
                if 0xc000000<t<len(b):
                    e=b.find(b"\x00",t); s=b[t:e]
                    if 3<len(s)<100 and all(32<=c<127 for c in s): note=f'   ; "{s.decode()}"'
        if i.mnemonic=="ldr" and "adrp" not in txt and i.op_str.count("[")==1:
            # ldr xN, [xM, #imm] following adrp: pointer slot
            pass
        if only_calls and not (note or i.mnemonic in ("bl","b","blr","ret")): continue
        print(txt+note)
if __name__=="__main__":
    s=int(sys.argv[1],16); e=int(sys.argv[2],16); dump(s,e,len(sys.argv)>3)
