#!/usr/bin/env python3
"""Regenerate aside-fork/snapshot/{chromium.patch,manifest.json} after a change in the Chromium fork worktree.

Same shape as the 2026-09-09 capture: `git diff --binary --full-index <baseCommit>` over the fork's index/worktree,
followed by the appended new-file section for the untracked source files listed in the manifest (which must be
unchanged; they are carried over verbatim from the current patch). Then run
`node tools/native-build-identity.mjs record --chrome <binary>` for the freshly built binary.

    python3 tools/regenerate-source-checkpoint.py [--src /home/hoon/chromium/src]
"""
import argparse, datetime, hashlib, json, os, pathlib, stat, subprocess, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/home/hoon/chromium/src")
    ap.add_argument("--snapshot", default=str(pathlib.Path(__file__).resolve().parent.parent / "aside-fork" / "snapshot"))
    args = ap.parse_args()
    src, snap = pathlib.Path(args.src), pathlib.Path(args.snapshot)
    manifest = json.loads((snap / "manifest.json").read_text())
    old = (snap / "chromium.patch").read_bytes()
    untracked = [f["path"] for f in manifest["files"] if f.get("untrackedAtCapture")]
    marker = f"diff --git a/{untracked[0]} b/{untracked[0]}\n".encode()
    idx = old.find(marker)
    if idx < 0 or old.count(marker) != 1:
        sys.exit("cannot find the appended untracked-file section in the current chromium.patch")
    appended = old[idx:]
    heads = [l.decode().split(" b/")[1] for l in appended.split(b"\n") if l.startswith(b"diff --git ")]
    if heads != untracked:
        sys.exit(f"appended section lists {heads}, manifest lists {untracked}")
    for rec in manifest["files"]:
        if rec.get("untrackedAtCapture"):
            content = (src / rec["path"]).read_bytes()
            if hashlib.sha256(content).hexdigest() != rec["sha256"]:
                sys.exit(f"{rec['path']} changed but is carried over verbatim; regenerate its new-file diff by hand")
    tracked = subprocess.run(["git", "-C", str(src), "diff", "--binary", "--full-index", manifest["baseCommit"]],
                             check=True, capture_output=True).stdout
    new = tracked + appended
    files, changed = [], []
    for rec in manifest["files"]:
        p = src / rec["path"]
        if rec.get("deleted"):
            files.append(rec); continue
        content = os.readlink(p).encode() if p.is_symlink() else p.read_bytes()
        mode = "120000" if p.is_symlink() else ("100755" if p.stat().st_mode & stat.S_IXUSR else "100644")
        sha = hashlib.sha256(content).hexdigest()
        if (sha, mode, len(content)) != (rec["sha256"], rec["mode"], rec["bytes"]):
            changed.append(rec["path"])
        files.append({**rec, "bytes": len(content), "sha256": sha, "mode": mode})
    manifest["capturedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    manifest["patch"] = {"path": "chromium.patch", "bytes": len(new), "sha256": hashlib.sha256(new).hexdigest()}
    manifest["fileCount"] = len(files)
    manifest["files"] = files
    (snap / "chromium.patch").write_bytes(new)
    (snap / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"chromium.patch {len(old)} -> {len(new)} bytes; files changed since last capture: {changed or 'none'}")

if __name__ == "__main__":
    main()
