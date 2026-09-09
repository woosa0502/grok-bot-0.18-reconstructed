#!/usr/bin/env python3
"""Bind original Aside omnibox consumers to the native result they rendered.

Pins the 1.26.824, 1.26.906 and 1.26.907 omnibox assets. Only these exact original
inputs (or this tool's exact output) are accepted; changing bundle shape must fail, never partly
patch. The 906 omnibox code is byte-shape-identical to 824 at every anchor EXCEPT the hover handler
callback, which the 906 minifier named `P` (824 used `_`); everything else, including the entire
`-page` transform, ports unchanged. 907 retains the search-view anchors but requires its own
page anchors for renamed bindings. The 824 and 906 transforms remain unchanged.
"""
import argparse
import hashlib
import json
from pathlib import Path

# name -> (version, kind, hover_var)   kind in {"search-view","page"}; hover_var only for search-view
ASSETS = {
    "-page-DIRMOM6u.js":        ("824", "page", None),
    "search-view-DIBnKvBo.js":  ("824", "search-view", "_"),
    "-page-CdoPoOp1.js":        ("906", "page", None),
    "search-view--fIYrfC3.js":  ("906", "search-view", "P"),
    "-page-C9UKSHnb.js":        ("907", "page", None),
    "search-view-Bczinz9d.js":  ("907", "search-view", "P"),
}
RAW_HASHES = {
    "-page-DIRMOM6u.js":       "01a42addc9c35a4eddbfae0e1b339f96747de9ebb0b584339060d6efb37a8dab",
    "search-view-DIBnKvBo.js": "53acc4fa2a7a9b0c4b80d3a484b27ef51b8e9f2774d4ac800054f670a31b9eda",
    "-page-CdoPoOp1.js":       "b0f156ba4bb962d201e16055b19d01b3039e139fd3cc818ec10f40b9025e0c6c",
    "search-view--fIYrfC3.js": "005dec14cbbe9e09b9e2f9b7a5eeb3202e000dae2b5c81bb6ac6a98c6043a343",
    "-page-C9UKSHnb.js":       "a7579dff92894404d31dadfde10ce81927cad30d46c6129e65f21f9dd0bea862",
    "search-view-Bczinz9d.js": "51e8bb45e21586c571043010e45a6c6e645fb2135d574c34911b24fb670db121",
}
PATCHED_HASHES = {
    "-page-DIRMOM6u.js":       "8b423ba056f869beec6dc9cb6409ee71aa34330d2a66bc827438e52d1497d6dc",
    "search-view-DIBnKvBo.js": "3d2dc6734cb639148459d794811e5102b72ee5f078674b982eccf21ef426df01",
    "-page-CdoPoOp1.js":       "7748b1c1cff3c3bea06d60337b8968de3f33a5f1505f2ddcf155ca538bf6a2f1",
    "search-view--fIYrfC3.js": "13fa3b38ae3cf171615e83ebc1b48fac742bd1a9fee194af06f6357715cfffd9",
    "-page-C9UKSHnb.js":       "3728e7e3ee176c54857016a938c485fdf5260bc059549f98d0a366f218d0f0a4",
    "search-view-Bczinz9d.js": "6d19fc6c80208264869bdb01ab2f037b6f8a0acb469eefc52463ce64c1d45388",
}
HELPERS = '''/* belmont-omnibox-generation-v1:start */
const __belmontOmniboxWithGeneration=(selection,match)=>{
  if(!selection)return selection;
  const selected=selection.resultSequenceId,rendered=match?.resultSequenceId;
  return {...selection,resultSequenceId:selected!=null&&rendered!=null&&selected!==rendered?0:selected??rendered};
};
const __belmontOmniboxSameGeneration=(before,after)=>before.length===after.length&&before.every((match,index)=>match.resultSequenceId===after[index]?.resultSequenceId);
/* belmont-omnibox-generation-v1:end */
'''


def replace(source, before, after, count=1):
    observed = source.count(before)
    if observed != count:
        raise ValueError(f'Anchor count {observed}, expected {count}: {before}')
    return source.replace(before, after)


def transform_search_view(source, hv):
    source = replace(source,
        'line:u,mouseButton:0,url:n.destinationUrl',
        'line:u,mouseButton:0,resultSequenceId:n.resultSequenceId,url:n.destinationUrl', 2)
    source = replace(source,
        '{line:u,url:n.destinationUrl}',
        '{line:u,resultSequenceId:n.resultSequenceId,url:n.destinationUrl}')
    source = replace(source,
        hv + '=(0,f.useCallback)(n=>()=>{v({actionIndex:0,line:n,state:"normal"}',
        hv + '=(0,f.useCallback)((n,u)=>()=>{v({actionIndex:0,line:n,resultSequenceId:u,state:"normal"}')
    return replace(source, 'onPointerEnter:' + hv + '(n.line)',
                   'onPointerEnter:' + hv + '(n.line,n.item.resultSequenceId)')


def transform_page(source):
    source = replace(source,
        'Pe=e=>e?{actionIndex:Number(e.actionIndex??0),line:Number(e.line??0),state:e.state??"normal"}:null',
        'Pe=e=>e?{actionIndex:Number(e.actionIndex??0),line:Number(e.line??0),resultSequenceId:e.resultSequenceId,state:e.state??"normal"}:null')
    source = replace(source,
        '&&String(e.state??"normal")===String(t.state??"normal"),et=',
        '&&String(e.state??"normal")===String(t.state??"normal")&&e.resultSequenceId===t.resultSequenceId,et=')
    source = replace(source, 'return c?n.contents===c.contents',
        'return c?n.resultSequenceId===c.resultSequenceId&&n.contents===c.contents')
    source = replace(source, 'const l=Pe(r);',
        'const l=Pe(__belmontOmniboxWithGeneration(r,w.current[Number(r.line??-1)]));')
    source = replace(source, '{line:x,url:r.destinationUrl}',
        '{line:x,resultSequenceId:r.resultSequenceId,url:r.destinationUrl}')
    source = replace(source, 'activationTarget:{line:o,url:c.destinationUrl}',
        'activationTarget:{line:o,resultSequenceId:c.resultSequenceId,url:c.destinationUrl}')
    source = replace(source, 'const qe={actionIndex:0,line:J,state:"normal"}',
        'const qe={actionIndex:0,line:J,resultSequenceId:Te.resultSequenceId,state:"normal"}')
    source = replace(source, 'he={actionIndex:0,line:We,state:"normal"}',
        'he={actionIndex:0,line:We,resultSequenceId:v[We]?.resultSequenceId,state:"normal"}', 2)
    source = replace(source,
        'const J=S.selection===void 0?A.current:Pe(S.selection);',
        'const J=S.selection===void 0?Pe(__belmontOmniboxWithGeneration(A.current?{...A.current,resultSequenceId:void 0}:null,S.matches[Number(A.current?.line??-1)])):Pe(S.selection);')
    source = replace(source, 'matches:S.matches,selection:S.selection}',
        'matches:S.matches,selection:J}')
    source = replace(source, '&&Zr(w.current,S.matches)',
        '&&__belmontOmniboxSameGeneration(w.current,S.matches)&&Zr(w.current,S.matches)')
    source = replace(source, '&&Xr(w.current,S.matches)',
        '&&__belmontOmniboxSameGeneration(w.current,S.matches)&&Xr(w.current,S.matches)')
    source = replace(source, 'line:x?.line,state:"normal"',
        'line:x?.line,resultSequenceId:x?.item.resultSequenceId,state:"normal"')
    source = replace(source, 'selection:qe}',
        'resultSequenceId:qe.resultSequenceId,selection:qe}')
    source = replace(source,
        'openPopupSelection(b.sessionId,{disposition:"currentTab",selection:x})',
        'openPopupSelection(b.sessionId,{disposition:"currentTab",selection:__belmontOmniboxWithGeneration(x,m)})')
    source = replace(source,
        'const I=je(m.destinationUrl);if(I)return',
        'const I=je(m.destinationUrl);if(I&&(__belmontOmniboxWithGeneration(x,m).resultSequenceId===0||m.resultSequenceId!==w.current[Number(x.line??-1)]?.resultSequenceId))return!1;if(I)return')
    source = replace(source,
        'ae({actionIndex:0,line:0,state:"normal"}),!0)},[ce,t,ae])',
        'ae({actionIndex:0,line:0,resultSequenceId:u[0]?.resultSequenceId,state:"normal"}),!0)},[ce,t,ae,u])')
    return HELPERS + source


def transform_page_907(source):
    source = replace(source,
        'Pe=e=>e?{actionIndex:Number(e.actionIndex??0),line:Number(e.line??0),state:e.state??"normal"}:null',
        'Pe=e=>e?{actionIndex:Number(e.actionIndex??0),line:Number(e.line??0),resultSequenceId:e.resultSequenceId,state:e.state??"normal"}:null')
    source = replace(source,
        '&&String(e.state??"normal")===String(t.state??"normal"),st=',
        '&&String(e.state??"normal")===String(t.state??"normal")&&e.resultSequenceId===t.resultSequenceId,st=')
    source = replace(source, 'return c?n.contents===c.contents',
        'return c?n.resultSequenceId===c.resultSequenceId&&n.contents===c.contents')
    source = replace(source, 'const l=Pe(r);',
        'const l=Pe(__belmontOmniboxWithGeneration(r,x.current[Number(r.line??-1)]));')
    source = replace(source, '{line:y,url:r.destinationUrl}',
        '{line:y,resultSequenceId:r.resultSequenceId,url:r.destinationUrl}')
    source = replace(source, 'activationTarget:{line:c,url:d.destinationUrl}',
        'activationTarget:{line:c,resultSequenceId:d.resultSequenceId,url:d.destinationUrl}')
    source = replace(source, 'const Qe={actionIndex:0,line:X,state:"normal"}',
        'const Qe={actionIndex:0,line:X,resultSequenceId:Te.resultSequenceId,state:"normal"}')
    source = replace(source, 'ge={actionIndex:0,line:qe,state:"normal"}',
        'ge={actionIndex:0,line:qe,resultSequenceId:W[qe]?.resultSequenceId,state:"normal"}', 2)
    source = replace(source,
        'const X=S.selection===void 0?I.current:Pe(S.selection);',
        'const X=S.selection===void 0?Pe(__belmontOmniboxWithGeneration(I.current?{...I.current,resultSequenceId:void 0}:null,S.matches[Number(I.current?.line??-1)])):Pe(S.selection);')
    source = replace(source, 'matches:S.matches,selection:S.selection}',
        'matches:S.matches,selection:X}')
    source = replace(source, '&&en(x.current,S.matches)',
        '&&__belmontOmniboxSameGeneration(x.current,S.matches)&&en(x.current,S.matches)')
    source = replace(source, '&&tn(x.current,S.matches)',
        '&&__belmontOmniboxSameGeneration(x.current,S.matches)&&tn(x.current,S.matches)')
    source = replace(source, 'line:y?.line,state:"normal"',
        'line:y?.line,resultSequenceId:y?.item.resultSequenceId,state:"normal"')
    source = replace(source, 'selection:Qe}',
        'resultSequenceId:Qe.resultSequenceId,selection:Qe}')
    source = replace(source,
        'openPopupSelection(b.sessionId,{disposition:"currentTab",selection:y})',
        'openPopupSelection(b.sessionId,{disposition:"currentTab",selection:__belmontOmniboxWithGeneration(y,p)})')
    source = replace(source,
        'const v=Ae(p.destinationUrl);if(v)return',
        'const v=Ae(p.destinationUrl);if(v&&(__belmontOmniboxWithGeneration(y,p).resultSequenceId===0||p.resultSequenceId!==x.current[Number(y.line??-1)]?.resultSequenceId))return!1;if(v)return')
    source = replace(source,
        'H({actionIndex:0,line:0,state:"normal"}),!0)},[le,t,H])',
        'H({actionIndex:0,line:0,resultSequenceId:u[0]?.resultSequenceId,state:"normal"}),!0)},[le,t,H,u])')
    return HELPERS + source


def transform(name, source):
    version, kind, hv = ASSETS[name]
    if kind == 'search-view':
        return transform_search_view(source, hv)
    if kind == 'page':
        return transform_page_907(source) if version == '907' else transform_page(source)
    raise ValueError(f'Unknown asset: {name}')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def patch_asset(name, data):
    observed = digest(data)
    if observed == PATCHED_HASHES.get(name):
        return data
    if observed != RAW_HASHES.get(name):
        raise ValueError(f'{name}: unrecognized input hash {observed}')
    updated = transform(name, data.decode('utf-8')).encode('utf-8')
    if digest(updated) != PATCHED_HASHES[name]:
        raise ValueError(f'{name}: patched output hash did not match')
    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--assets', type=Path, required=True)
    options = parser.parse_args()
    # Detect the extension version by which pinned pair is present; require exactly one full pair.
    present = [n for n in ASSETS if (options.assets / n).exists()]
    versions = sorted({ASSETS[n][0] for n in present})
    if len(versions) != 1 or len(present) != 2:
        raise ValueError(f'expected exactly one 824|906|907 asset pair in {options.assets}; found {present}')
    planned = []
    for name in present:
        target = options.assets / name
        before = target.read_bytes()
        after = patch_asset(name, before)
        planned.append((target, before, after))
    results = []
    for target, before, after in planned:
        if before != after:
            target.write_bytes(after)
        results.append({'file': target.name, 'version': ASSETS[target.name][0],
                        'changed': before != after, 'before': digest(before), 'after': digest(after)})
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
