# Chromium source checkpoint — 2026-09-09

This directory is the current cumulative source checkpoint. Historical `../patches/`
and `../overlay/` are retained as development history; they are not an equivalent
current source tree and must not be applied on top of this cumulative patch.

- Public Chromium base: `cc5584af0df9786f00efdb71f666c6664f836c2d` (`151.0.7922.171`).
- Local provenance HEAD: `1d00f53b564d073e80d6c90be81fb1ac0f90327f`.
- `chromium.patch`: full-index Git binary patch containing the local commit,
  subsequent worktree changes and nine additional custom source files.
- `manifest.json`: exact capture time, patch hash, file modes, file sizes and SHA-256.
- `args.gn`: captured native build configuration, outside generated output.

## Restore in a separate Chromium checkout

Use a complete Chromium checkout with its normal depot_tools dependencies. Keep
any active user's source checkout, build cache, profile and installation separate.

```bash
git checkout cc5584af0df9786f00efdb71f666c6664f836c2d
# Set this to the absolute directory containing this README.
ASIDE_SNAPSHOT=/absolute/path/to/Belmont/belmont-browse/aside-fork/snapshot
git apply --check "$ASIDE_SNAPSHOT/chromium.patch"
git apply "$ASIDE_SNAPSHOT/chromium.patch"
python3 - "$ASIDE_SNAPSHOT/manifest.json" <<'PY'
import hashlib, json, os, pathlib, stat, sys
manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
for record in manifest["files"]:
    path = pathlib.Path(record["path"])
    if record.get("deleted"):
        assert not path.exists() and not path.is_symlink(), str(path)
        continue
    content = os.readlink(path).encode() if path.is_symlink() else path.read_bytes()
    mode = "120000" if path.is_symlink() else (
        "100755" if path.stat().st_mode & stat.S_IXUSR else "100644")
    assert hashlib.sha256(content).hexdigest() == record["sha256"], str(path)
    assert mode == record["mode"], str(path)
print("Source contents and modes match the captured manifest.")
PY
mkdir -p out/aside
cp "$ASIDE_SNAPSHOT/args.gn" out/aside/args.gn
export PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python
gn gen out/aside
third_party/ninja/ninja -C out/aside -j4 chrome
```

The Python protobuf implementation was required by this checkout's generator.
Observed toolchain stamps were Clang `llvmorg-23-init-19482-g53d18800-1` and
Rust `1.98.0` (`b998449636a48e2c4a362809085b600a0174e1f2`). Downloaded third-party
dependencies, build output and browser binaries are external inputs. The adjacent
dependency inventory records source checkout and package input URLs.

## Verification boundary

Publication checks apply this patch to a separate tree populated with the touched
files from the public base, then compare every resulting file and executable mode
with the manifest. This verifies the patch's source contents; it is not a fresh
full Chromium build, vendor bundle reproduction, or browser parity approval.

The live Chromium HEAD, index, worktree and ongoing native test build were preserved
during export. Native tests, mobile failures and user-flow limitations are recorded
in the [publication handoff](../../../../docs/aside-source-publication-2026-09-09.md).
