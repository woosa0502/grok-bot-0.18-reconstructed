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
import argparse, hashlib, json, re, sys
from pathlib import Path

ASSETS = {
    "appearance-BlPq6qs7.js": {
        "version": "909",
        "raw": "5ec1cf571e9f0e20f6f72c0957ddd0fa9589b84f0d2402e1d28f3740abc9d5ae",
        "patched": "844716d502c33ed042c39efe88ee2c0eba06850984841a87a7ac9466bc94634a",
        "edits": [('o==="windows"?r.windowsShortcut:r.macShortcut', 'o!=="macos"?r.windowsShortcut:r.macShortcut')],
    },
    "platform-CH1yjH9T.js": {
        "version": "909",
        "raw": "9db39c7e24ea6274c10c4768e92a8fbcb8b332d3fc0ca5b55e1bf0c33bd46338",
        "patched": "79f6f9b0961c02c29f592a8414d8d5c656d6e27224ac6f6174dfbf7ad0ba2bc2",
        "edits": [('function t(){return/win/i.test(r())?"Ctrl+":"⌘"}function a(){return/win/i.test(r())?n:i}',
                   'function t(){return/mac/i.test(r())?"⌘":"Ctrl+"}function a(){return/mac/i.test(r())?i:n}')],
    },
    # 1.26.914.1644: the module was refactored. Shortcut glyphs (c()/f()) now gate on isMac (a())
    # directly, so Linux already falls to the Windows/Ctrl text form — no glyph edit needed. The one
    # remaining Linux bug is the reveal LABEL set p(): /win/ only, so Linux gets Finder labels (s)
    # instead of File Explorer (m). The fork opens folders in Windows Explorer under WSL, so non-macOS
    # must show File Explorer. Single edit.
    "platform-CX_yPATJ.js": {
        "version": "914",
        "raw": "9e0e29e097d7701de5bb671e48d06c380fac4082bf1627eb352ace5ee22e4ef4",
        "patched": "99484d0b218757d015bb0c29539c45f48702918ba92659749c9098366d0338a9",
        "edits": [('function p(){return/win/i.test(t())?m:s}', 'function p(){return/mac/i.test(t())?s:m}')],
    },
}


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", required=True)
    ap.add_argument("--version", help="engine version (e.g. 1.26.914.1644); inferred from --assets path if omitted")
    args = ap.parse_args()
    root = Path(args.assets)
    # Determine which engine version this assets dir belongs to, so we can REQUIRE that version's
    # files exist (a wrong path, an empty dir, or a missing patch target must fail — not be skipped
    # as if it were merely a foreign version's file). Foreign-version files are still skipped.
    version_full = args.version or ""
    m = re.search(r"1\.26\.(\d+)\.", version_full or str(root))
    target_version = m.group(1) if m else None
    if target_version is None:
        print(f"could not determine engine version from --version/--assets ({root}); pass --version", file=sys.stderr)
        return 1
    known = {spec.get("version") for spec in ASSETS.values()}
    if target_version not in known:
        print(f"no glyph patch entries registered for version {target_version} (known: {sorted(known)})", file=sys.stderr)
        return 1
    report = []
    for name, spec in ASSETS.items():
        p = root / name
        is_target = spec.get("version") == target_version
        if not p.exists():
            if is_target:
                # A file this version is supposed to carry is missing: wrong assets path, empty dir,
                # or a drifted build. Fail loudly rather than silently skipping the patch.
                print(f"{name}: REQUIRED for version {target_version} but missing under {root}", file=sys.stderr)
                return 1
            # Foreign-version file (its content hash names a different build): skip.
            report.append({"file": name, "status": f"skipped (belongs to version {spec.get('version')})"})
            continue
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
