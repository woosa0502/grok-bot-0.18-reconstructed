#!/usr/bin/env python3
# Aside 네임스페이스 API 자동 배선기 — 검증된 recipe(asideAccount) 그대로
import json, re, sys, pathlib
CR = pathlib.Path("/home/hoon/chromium/src")
OV = pathlib.Path("/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/2534ba16-801e-4ada-9486-ce4d1be6622c/scratchpad/overlay/aside-chromium-reconstruction-r2")
HASH = "4A76B267556C299D3719FF535FC6011CF9674AC0"
COUNTER_FILE = pathlib.Path("/tmp/aside_hist_counter.txt")

def snake(camel):  # asideNotification -> aside_notification
    return re.sub(r'(?<!^)(?=[A-Z])', '_', camel).lower()
def pascal(camel):  # asideNotification -> AsideNotification ; requestPermission -> RequestPermission
    return camel[0].upper() + camel[1:]
def upper_snake(camel):  # asideNotification -> ASIDENOTIFICATION (no underscores, matches DICTATIONPRIVATE style)
    return camel.upper()

def ret_expr(fn):
    ra = fn.get("returns_async")
    if not ra or not ra.get("parameters"): return "return RespondNow(NoArguments());"
    p = ra["parameters"][0]
    if "$ref" in p: return "return RespondNow(WithArguments(base::DictValue()));"
    t = p.get("type")
    return {
        "boolean": "return RespondNow(WithArguments(false));",
        "integer": "return RespondNow(WithArguments(0));",
        "number":  "return RespondNow(WithArguments(0.0));",
        "string":  "return RespondNow(WithArguments(std::string()));",
        "array":   "return RespondNow(WithArguments(base::ListValue()));",
        "object":  "return RespondNow(WithArguments(base::DictValue()));",
    }.get(t, "return RespondNow(WithArguments(base::DictValue()));")

def main(ns, permission):
    schema = json.load(open(OV/"schemas"/f"{ns}.json"))
    sn = snake(ns); Pns = pascal(ns); Uns = upper_snake(ns)
    funcs = schema.get("functions", [])

    # --- 히스토그램 카운터 ---
    counter = int(COUNTER_FILE.read_text()) if COUNTER_FILE.exists() else 1981
    hist = {}
    for f in funcs:
        hist[f["name"]] = (f"{Uns}_{f['name'].upper()}", counter); counter += 1
    COUNTER_FILE.write_text(str(counter))

    # --- 1) 스키마 배치 (배열, 접두사 제거, 설명) ---
    s = dict(schema); s.setdefault("description", f"Aside private API {ns} (trusted bundled extensions only).")
    def strip(x): return x[len(ns)+1:] if isinstance(x,str) and x.startswith(ns+".") else x
    for t in s.get("types",[]):
        if "id" in t: t["id"]=strip(t["id"])
    def walk(o):
        if isinstance(o,dict):
            if "$ref" in o: o["$ref"]=strip(o["$ref"])
            for v in o.values(): walk(v)
        elif isinstance(o,list):
            for v in o: walk(v)
    walk(s)
    (CR/"chrome/common/extensions/api"/f"{sn}.json").write_text(json.dumps([s], indent=2))

    # --- 2) api_sources.gni ---
    p=CR/"chrome/common/extensions/api/api_sources.gni"; t=p.read_text()
    line=f'  "{sn}.json",\n'
    if line not in t:
        t=t.replace('  "activity_log_private.json",\n', '  "activity_log_private.json",\n'+line, 1)
        p.write_text(t)

    # --- 3) _api_features.json (단일 객체) ---
    p=CR/"chrome/common/extensions/api/_api_features.json"; t=p.read_text()
    if f'"{ns}"' not in t:
        entry=(f'  "{ns}": {{\n'
               f'    "channel": "stable",\n'
               f'    "contexts": ["privileged_extension"],\n'
               f'    "extension_types": ["extension"],\n'
               f'    "dependencies": ["permission:at.studio.Aside.ext.private.{permission}"],\n'
               f'    "allowlist": ["{HASH}"]\n'
               f'  }},\n')
        t=t.replace('  "accessibilityFeatures": [{', entry+'  "accessibilityFeatures": [{', 1)
        p.write_text(t)

    # --- 4) 히스토그램 enum ---
    p=CR/"extensions/browser/extension_function_histogram_value.h"; t=p.read_text()
    if f"{Uns}_" not in t:
        block="".join(f"  {name} = {val},\n" for name,val in hist.values())
        t=t.replace("  // Last entry: Add new entries above, then run:", block+"  // Last entry: Add new entries above, then run:", 1)
        p.write_text(t)

    # --- 5) .h / .cc ---
    d=CR/"chrome/browser/extensions/api"/sn; d.mkdir(parents=True, exist_ok=True)
    guard=f"CHROME_BROWSER_EXTENSIONS_API_{sn.upper()}_{sn.upper()}_API_H_"
    classes=[]
    for f in funcs:
        cls=f"{Pns}{pascal(f['name'])}Function"
        hname,_=hist[f["name"]]
        classes.append((cls, f"{ns}.{f['name']}", hname))
    h=[f"// Copyright 2026 The Chromium Authors","// Use of this source code is governed by a BSD-style license that can be","// found in the LICENSE file.","",f"#ifndef {guard}",f"#define {guard}","",'#include "extensions/browser/extension_function.h"',"","namespace extensions {",""]
    for cls,jsname,hname in classes:
        h+=[f"class {cls} final : public ExtensionFunction {{"," public:",f'  DECLARE_EXTENSION_FUNCTION("{jsname}", {hname})',""," private:",f"  ~{cls}() final = default;","  ResponseAction Run() final;","};",""]
    h+=["}  // namespace extensions","",f"#endif  // {guard}",""]
    (d/f"{sn}_api.h").write_text("\n".join(h))

    cc=[f"// Copyright 2026 The Chromium Authors","// Use of this source code is governed by a BSD-style license that can be","// found in the LICENSE file.","",f'#include "chrome/browser/extensions/api/{sn}/{sn}_api.h"',"","#include <string>","",'#include "base/values.h"',f'#include "chrome/common/extensions/api/{sn}.h"',"","namespace extensions {",""]
    for f in funcs:
        cls=f"{Pns}{pascal(f['name'])}Function"
        cc+=[f"ExtensionFunction::ResponseAction {cls}::Run() {{",
             "  // TODO(aside): reproduce original behavior; structured placeholder for now.",
             f"  {ret_expr(f)}","}",""]
    cc+=["}  // namespace extensions",""]
    (d/f"{sn}_api.cc").write_text("\n".join(cc))

    (d/"BUILD.gn").write_text(
f'''# Copyright 2026 The Chromium Authors
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import("//extensions/buildflags/buildflags.gni")

assert(enable_extensions)

source_set("{sn}") {{
  sources = [
    "{sn}_api.cc",
    "{sn}_api.h",
  ]
  configs += [ "//build/config/compiler:wexit_time_destructors" ]
  public_deps = [
    "//chrome/browser/extensions",
    "//chrome/common/extensions/api",
    "//content/public/browser",
    "//extensions/browser",
  ]
  deps = [ "//base" ]
}}
''')

    # --- 6) api/BUILD.gn dep ---
    p=CR/"chrome/browser/extensions/api/BUILD.gn"; t=p.read_text()
    dep=f'    "//chrome/browser/extensions/api/{sn}",\n'
    if dep not in t:
        t=t.replace('    "//chrome/browser/extensions/api/activity_log_private",\n',
                    '    "//chrome/browser/extensions/api/activity_log_private",\n'+dep, 1)
        p.write_text(t)
    print(f"✓ {ns} 배선 완료 ({len(funcs)}함수, enum {min(v for _,v in hist.values())}~{max(v for _,v in hist.values())})")

if __name__=="__main__":
    main(sys.argv[1], sys.argv[2])
