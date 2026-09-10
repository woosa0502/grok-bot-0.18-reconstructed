#!/usr/bin/env python3
"""Show Windows-style shortcut glyphs and File Explorer wording on Linux (Aside 1.26.909).

The Aside extension only distinguishes macOS from Windows for presentation; on Linux it
falls through to the macOS branch (⌘ glyphs, "Open folder in Finder"). The fork binds the
Windows keys on Linux (Ctrl+S / Ctrl+E / Ctrl+Shift+E / Ctrl+Shift+C / Ctrl+Shift+\\) and opens
folders in Windows Explorer through WSL, so every non-macOS platform gets the Windows
presentation.

Usage: patch-linux-platform-glyphs.py --assets <agent-manager>/1.26.909.1820/assets
Idempotent. Refuses to touch a file whose hash is neither the pinned raw nor the pinned
patched value.
"""
import argparse, hashlib, json, sys
from pathlib import Path

ASSETS = {
    "appearance-BlPq6qs7.js": {
        "raw": "5ec1cf571e9f0e20f6f72c0957ddd0fa9589b84f0d2402e1d28f3740abc9d5ae",
        "patched": "844716d502c33ed042c39efe88ee2c0eba06850984841a87a7ac9466bc94634a",
        "edits": [('o==="windows"?r.windowsShortcut:r.macShortcut', 'o!=="macos"?r.windowsShortcut:r.macShortcut')],
    },
    "platform-CH1yjH9T.js": {
        "raw": "9db39c7e24ea6274c10c4768e92a8fbcb8b332d3fc0ca5b55e1bf0c33bd46338",
        "patched": "79f6f9b0961c02c29f592a8414d8d5c656d6e27224ac6f6174dfbf7ad0ba2bc2",
        "edits": [('function t(){return/win/i.test(r())?"Ctrl+":"⌘"}function a(){return/win/i.test(r())?n:i}',
                   'function t(){return/mac/i.test(r())?"⌘":"Ctrl+"}function a(){return/mac/i.test(r())?i:n}')],
    },
}


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", required=True)
    args = ap.parse_args()
    root = Path(args.assets)
    report = []
    for name, spec in ASSETS.items():
        p = root / name
        if not p.exists():
            print(f"{name}: missing under {root}", file=sys.stderr)
            return 1
        before = sha(p)
        if before == spec["patched"]:
            report.append({"file": name, "status": "already patched", "sha256": before})
            continue
        if before != spec["raw"]:
            print(f"{name}: unexpected input hash {before} (raw {spec['raw']})", file=sys.stderr)
            return 1
        src = p.read_text(encoding="utf-8")
        for old, new in spec["edits"]:
            if src.count(old) != 1:
                print(f"{name}: anchor count {src.count(old)} for {old[:40]!r}", file=sys.stderr)
                return 1
            src = src.replace(old, new)
        p.write_text(src, encoding="utf-8")
        after = sha(p)
        if after != spec["patched"]:
            print(f"{name}: output hash {after} != pinned {spec['patched']}", file=sys.stderr)
            return 1
        report.append({"file": name, "status": "patched", "before": before, "after": after})
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
