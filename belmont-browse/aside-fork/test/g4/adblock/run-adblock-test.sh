#!/bin/bash
# G4 copy: end-to-end ad-block check against the group-G4 standalone chrome (CDP 9414, fixtures on 18791).
# usage: run-adblock-test.sh [result.json]
# Needs: out/aside/chrome running with --remote-debugging-port=9414, node + ws in belmont-browse/node_modules.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/result-$(date +%Y-%m-%d).json}"; case "$OUT" in /*) ;; *) OUT="$PWD/$OUT";; esac
export SP="$HERE/../../.."   # screenshots land in <aside-fork>/ui-shots/G4-*
export PATH="/home/hoon/.nvm/versions/node/v26.8.1/bin:$PATH"
cd "$HERE/page"
python3 -m http.server 18791 --bind 127.0.0.1 >/dev/null 2>&1 & HP=$!
python3 -m http.server 18791 --bind 127.0.0.2 >/dev/null 2>&1 & HP2=$!
sleep 1
node "$HERE/adblock-test.mjs" > "$OUT"
kill $HP $HP2 2>/dev/null
node "$HERE/reset-custom-rules.mjs"
echo "wrote $OUT"
python3 - "$OUT" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
def g(*ks):
    o=d
    for k in ks:
        o=o.get(k) if isinstance(o,dict) else None
        if o is None: return None
    return o
checks=[
 ("internals page title 'Adblock Internals'", g('internalsDom') and json.loads(d['internalsDom']).get('title','') == 'Adblock Internals'),
 ("easylist parse errors == 0 (adblock-rust parity)", g('custom','easylistParseErrors') == 0),
 ("easyprivacy parse errors == 1 (~document, adblock-rust parity)", g('custom','easyprivacyParseErrors') == 1),
 ("custom rules compiled without errors", g('custom','parseErrorCount') == 0),
 ("adsbygoogle blocked", g('page','results','adsbygoogle_script') == 'error'),
 ("example.com allowed", str(g('page','results','example_fetch') or '').startswith('ok')),
 ("$redirect=noopjs: script loads empty", str(g('page','results','redirect_script') or '').startswith('loaded marker=undefined')),
 ("$important beats exception", g('page','results','important_script') == 'error'),
 ("plain exception allows", g('page','results','exception_script') == 'loaded'),
 ("/regex/ rule blocks", g('page','results','regex_script') == 'error'),
 ("$method=post: GET allowed", str(g('page','results','method_get') or '').startswith('ok')),
 ("$method=post: POST blocked", str(g('page','results','method_post') or '').startswith('error')),
 ("$redirect=1x1.gif: 1x1 image", g('page','results','gif_redirect') == 'loaded 1x1'),
 ("$generichide: generic .ADBox visible", g('page','gen1') != 'none'),
 ("$generichide: site rule still hides", g('page','site1') == 'none'),
 ("$csp: inline script blocked", g('csp','inline') == 'undefined'),
 ("procedural :has-text hides matching item", g('page','proc1') == 'none'),
 ("procedural :has-text leaves sibling", g('page','proc2') != 'none'),
 ("procedural :style applies", g('page','styledColor') == 'rgb(9, 8, 7)'),
 ("generic .ADBox hidden via class lookup (127.0.0.2)", g('generic','gen1') == 'none'),
 ("generic: control visible", g('generic','ctrl') != 'none'),
 ("generic: late-added .ADBAR hidden", g('generic','late') == 'none'),
 ("cosmetic script adopted stylesheet present", (g('generic','adoptedSheets') or 0) >= 1),
 ("$popup: matched popup closed", g('popup','blockedPopupStillOpen') == []),
 ("$popup: control popup opens", bool(g('popup','controlPopupOpen'))),
 ("$document block page", g('blockPage','h1') == 'Aside blocked this page'),
 ("block page note sentence", g('blockPage','note') == 'Continuing allows only this navigation in the current tab.'),
 ("continue once loads example.org", 'example.org' in str(g('afterContinue','url')) and g('afterContinue','h1') == 'Example Domain'),
 ("disable -> adsbygoogle loads", g('pageDisabled','results','adsbygoogle_script') == 'loaded'),
]
ok=sum(1 for _,v in checks if v)
for name,v in checks: print(("PASS " if v else "FAIL ")+name)
print(f"{ok}/{len(checks)} passed")
if d.get('error'): print("ERROR:", d['error'][:500])
PY
