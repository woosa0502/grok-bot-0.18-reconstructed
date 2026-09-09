#!/usr/bin/env python3
"""Per-class layout spec from the original binary: vptr via GetClassName xref, then read
views::View virtual slots (indices from the fork's own vtable, same Chromium 151)."""
import sys, json, struct, re, os, numpy as np, capstone
BIN, SLOTS, LOC = sys.argv[1], sys.argv[2], sys.argv[3]
CLASSES = sys.argv[4:]
data=open(BIN,'rb').read(); M36=0xFFFFFFFFF
md=capstone.Cs(capstone.CS_ARCH_ARM64,capstone.CS_MODE_ARM); md.skipdata=True
arr=np.frombuffer(data[:len(data)//4*4],dtype=np.uint32)
q=np.frombuffer(data[:len(data)//8*8],dtype=np.uint64); low36=q&np.uint64(M36)
rd64=lambda o: struct.unpack_from('<Q',data,o)[0]
slots=json.load(open(SLOTS))["views::LabelButton"]
def idx(name):
    for i,e in enumerate(slots):
        if e and e.split("(")[0].endswith("::"+name): return i
IDX={n:idx(n) for n in ["GetClassName","CalculatePreferredSize","GetInsets","GetMinimumSize","Layout","OnPaint","OnPaintBackground","OnBoundsChanged","OnThemeChanged","GetTooltipText","AddedToWidget","GetHeightForWidth","PreferredSizeChanged","OnMousePressed","OnMouseReleased","OnMouseEntered","OnMouseExited","StateChanged","NotifyClick","PaintButtonContents","GetImage"]}
adrp_idx=np.nonzero((arr&0x9f000000)==0x90000000)[0]
PAIRS={}
for i in adrp_idx:
    va_=int(i)*4; w=int(arr[i]); immlo=(w>>29)&3; immhi=(w>>5)&0x7ffff; imm=(immhi<<2)|immlo
    if imm&(1<<20): imm-=(1<<21)
    page=(va_&~0xfff)+(imm<<12); rd=w&0x1f
    for j in range(i+1,min(i+6,len(arr))):
        w2=int(arr[j])
        if (w2&0x7f800000)==0x11000000 and ((w2>>5)&0x1f)==rd:
            imm12=(w2>>10)&0xfff
            if (w2>>22)&1: imm12<<=12
            PAIRS.setdefault(page+imm12,[]).append(va_); break
def cstr(a,maxlen=120):
    e=data.find(b'\x00',a)
    if e<0 or e-a>maxlen: return None
    try:
        t=data[a:e].decode('ascii'); return t if t.isprintable() else None
    except: return None
def loc(i):
    p=os.path.join(LOC,str(i))
    if not os.path.exists(p): return None
    b=open(p,'rb').read()
    for enc in ('utf-8','utf-16-le'):
        try: return b.decode(enc)
        except: pass
def func_start(addr):
    for back in range(addr,addr-0x400,-4):
        w=int(arr[back//4])
        if (w&0xffc003e0)==0xa98003e0 or (w&0xff0003ff)==0xd10003ff: return back
    return addr
def callee_id(t,maxlen=0x200):
    regpage={}
    for ins in md.disasm(data[t:t+maxlen],t):
        m,o=ins.mnemonic,ins.op_str
        if m=="adrp":
            rd=o.split(",")[0].strip()
            try: regpage[rd]=int(o.split("#")[1],0)
            except: pass
        elif m=="add" and "#" in o:
            p=[x.strip() for x in o.split(",")]
            if len(p)==3 and p[1] in regpage:
                try: s=cstr(regpage[p[1]]+int(p[2].split("#")[1],0))
                except: continue
                if s and s.startswith("../../"): return s.split("/")[-1]
        elif m=="ret": break
    return hex(t)
def dump(fn,maxlen=0x600):
    regpage={}; out={"strs":[],"ids":[],"imms":[],"floats":[],"calls":[]}
    for ins in md.disasm(data[fn:fn+maxlen],fn):
        m,o=ins.mnemonic,ins.op_str
        if m=="adrp":
            rd=o.split(",")[0].strip()
            try: regpage[rd]=int(o.split("#")[1],0)
            except: pass
        elif m=="add" and "#" in o:
            p=[x.strip() for x in o.split(",")]
            if len(p)==3 and p[1] in regpage:
                try: s=cstr(regpage[p[1]]+int(p[2].split("#")[1],0))
                except: continue
                if s and len(s)>=3 and not s.startswith("../../") and s not in out["strs"]: out["strs"].append(s)
        elif m in("mov","movz") and re.match(r"w\d+, #",o):
            v=int(o.split("#")[1],0)
            if 4096<v<70000 and loc(v): out["ids"].append((v,loc(v)[:40]))
            elif 0<v<1024 and v not in out["imms"]: out["imms"].append(v)
        elif m=="fmov" and "#" in o: out["floats"].append(o.split("#")[1])
        elif m=="bl":
            t=int(o.lstrip('#'),0); out["calls"].append(callee_id(t))
        elif m=="ret": break
    return out
result={}
for cls in CLASSES:
    a=data.find(b"\x00"+cls.encode()+b"\x00")+1
    xs=PAIRS.get(a,[])
    if not xs: result[cls]={"error":"no xref"}; continue
    gcn=func_start(xs[0])
    slot=[int(i)*8 for i in np.nonzero(low36==np.uint64(gcn))[0]]
    if not slot: result[cls]={"error":"no vtable slot","gcn":hex(gcn)}; continue
    # the class-name string is referenced from GetClassMetaData() (slot 187 in
    # both the fork and the original); the dtor lands at slot 9 in both.
    vptr=slot[0]-187*8
    spec={"vptr":hex(vptr)}
    for name,i in IDX.items():
        if i is None or name=="GetClassName": continue
        f=rd64(vptr+i*8)&M36
        if not (0x4000<f<0xc500000): continue
        d=dump(f)
        # keep only informative
        if d["imms"] or d["ids"] or d["floats"] or d["strs"]:
            spec[name]={"fn":hex(f),**{k:v for k,v in d.items() if v}}
    result[cls]=spec
json.dump(result,open(os.path.join(os.path.dirname(SLOTS),"aside-views-spec.json"),"w"),indent=1,ensure_ascii=False)
print("IDX:",IDX)
for cls,spec in result.items():
    print(f"\n#### {cls} {spec.get('vptr','')} {spec.get('error','')}")
    for k,v in spec.items():
        if k in("vptr","error","gcn") or not isinstance(v,dict): continue
        print(f"  {k} {v['fn']}: imms={v.get('imms',[])[:14]} floats={v.get('floats',[])[:6]} ids={v.get('ids',[])[:3]} strs={v.get('strs',[])[:5]} calls={[c for c in v.get('calls',[]) if not c.startswith('0x')][:6]}")
