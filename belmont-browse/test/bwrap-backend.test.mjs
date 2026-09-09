import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BubblewrapBackend } from "../src/bwrap-backend.mjs";

// bwrap must be installed AND able to create a user namespace here (GitHub's Ubuntu runners restrict unprivileged
// user namespaces via AppArmor unless kernel.apparmor_restrict_unprivileged_userns=0; CI sets that). A host that
// cannot is reported as an explicit skip reason, never as a pass.
const bwrapProbe = existsSync("/usr/bin/bwrap") ? spawnSync("/usr/bin/bwrap", ["--ro-bind", "/", "/", "--unshare-user", "--dev", "/dev", "/bin/true"], { encoding: "utf8", timeout: 10_000 }) : null;
const hasBwrap = bwrapProbe !== null && bwrapProbe.status === 0;
const bwrapSkip = bwrapProbe === null ? "bwrap is not installed" : bwrapProbe.status === 0 ? false : `bwrap cannot create a user namespace here: ${(bwrapProbe.stderr || "").trim().split("\n")[0]}`;

function runBackend(backend, command, options) {
  const args = backend.buildArgs(command, options);
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 10000 });
  return { args, ...result };
}

function fixture(t) {
  const root = mkdtempSync(path.join(process.cwd(), ".bwrap-test-"));
  const readable = path.join(root, "readable");
  const writable = path.join(root, "writable");
  const hidden = path.join(root, "hidden");
  mkdirSync(readable);
  mkdirSync(writable);
  mkdirSync(hidden);
  writeFileSync(path.join(readable, "input.txt"), "READ_OK");
  writeFileSync(path.join(hidden, "secret.txt"), "HIDDEN");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, readable, writable, hidden };
}

test("full readable root stays read-only while an explicit child remains writable", { skip: bwrapSkip }, (t) => {
  const f = fixture(t);
  const deniedPath = path.join(f.readable, "denied.txt");
  const allowedPath = path.join(f.writable, "allowed.txt");
  const command = ["/bin/sh", "-c", `printf denied > '${deniedPath}' 2>/dev/null; denied=$?; printf WRITE_OK > '${allowedPath}'; test "$denied" -ne 0 && cat '${allowedPath}'`];
  const result = runBackend(new BubblewrapBackend(), command, {
    readableRoots: ["/"],
    writableRoots: [f.writable],
    networkMode: "full",
    cwd: f.root,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "WRITE_OK");
  assert.equal(existsSync(deniedPath), false);
  assert.equal(readFileSync(allowedPath, "utf8"), "WRITE_OK");
  assert.equal(result.args.filter((value, index) => value === "/" && result.args[index - 1]?.endsWith("bind")).length, 1);
  assert.equal(result.args.includes("--remount-ro"), false);
});

test("full writable root executes with one writable base mount", { skip: bwrapSkip }, (t) => {
  const f = fixture(t);
  const outputPath = path.join(f.root, "root-write.txt");
  const result = runBackend(new BubblewrapBackend(), ["/bin/sh", "-c", `printf ROOT_WRITE_OK > '${outputPath}'`], {
    readableRoots: ["/", f.root],
    writableRoots: ["/", f.root],
    networkMode: "full",
    cwd: f.root,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(outputPath, "utf8"), "ROOT_WRITE_OK");
  assert.deepEqual(result.args.slice(result.args.indexOf("--unshare-uts") + 1, result.args.indexOf("--dev")), ["--bind", "/", "/"]);
  assert.equal(result.args.includes("--remount-ro"), false);
});

test("scoped home hides siblings, preserves read-only input, and permits designated output", { skip: bwrapSkip }, (t) => {
  const f = fixture(t);
  const deniedPath = path.join(f.readable, "denied.txt");
  const allowedPath = path.join(f.writable, "allowed.txt");
  const command = ["/bin/sh", "-c", `test "$(cat '${path.join(f.readable, "input.txt")}')" = READ_OK; test ! -e '${path.join(f.hidden, "secret.txt")}'; printf denied > '${deniedPath}' 2>/dev/null; denied=$?; printf SCOPED_WRITE_OK > '${allowedPath}'; test "$denied" -ne 0`];
  const result = runBackend(new BubblewrapBackend(), command, {
    readableRoots: [f.readable],
    writableRoots: [f.writable],
    networkMode: "full",
    cwd: f.readable,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(deniedPath), false);
  assert.equal(readFileSync(allowedPath, "utf8"), "SCOPED_WRITE_OK");
  assert.ok(result.args.includes("--remount-ro"));
});
