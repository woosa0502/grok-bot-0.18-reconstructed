import sys,numpy as np
b=open("aside-arm64.bin","rb").read()
TEXT_END=0xc000000  # code lives below the rodata/data strings
w=np.frombuffer(b[:TEXT_END - TEXT_END%4],dtype='<u4')
adrp=(w & 0x9F000000)==0x90000000
idx=np.nonzero(adrp)[0]
def adrp_target(i):
    ins=int(w[i]); immlo=(ins>>29)&3; immhi=(ins>>5)&0x7FFFF
    imm=((immhi<<2)|immlo); imm = imm-(1<<21) if imm&(1<<20) else imm
    return ((i*4)&~0xFFF)+(imm<<12), ins&31
def find(target):
    page=target&~0xFFF; hits=[]
    for i in idx:
        t,rd=adrp_target(i)
        if t!=page: continue
        for k in range(1,6):
            ins=int(w[i+k])
            if (ins&0xFF800000)==0x91000000 and ((ins>>5)&31)==rd:  # ADD xd, xn, imm12
                imm=(ins>>10)&0xFFF
                if ((ins>>22)&1): imm<<=12
                if page+imm==target: hits.append((i*4,(i+k)*4)); break
    return hits
for a in sys.argv[1:]:
    t=int(a,16); print(hex(t), [hex(x) for x,_ in find(t)])
