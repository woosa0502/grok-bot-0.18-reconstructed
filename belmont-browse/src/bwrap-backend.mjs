// belmont-browse: Linux shell sandbox for the Aside daemon using bubblewrap (our code).
// Modeled on the LinuxSandboxBackend that shipped in Aside 1.26.824 (removed in 1.26.902), corrected so the
// sandbox can actually execute: the whole filesystem is visible read-only, the home directory is hidden,
// and only Aside's readableRoots/writableRoots are bound back in (read-only / read-write).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    child.once("error", () => resolve(127));
  });
}

export class BubblewrapBackend {
  name = "bubblewrap";
  constructor({ log = () => {}, extraReadOnly = [] } = {}) { this.log = log; this.extraReadOnly = extraReadOnly; }

  buildArgs(command, { readableRoots = [], writableRoots = [], networkMode = "full", cwd, isolate = null }) {
    const home = os.homedir();
    const inside = (p) => path.resolve(p);
    const uniqueRoots = (roots) => [...new Set(roots.map(inside))];
    const filesystemRoot = path.parse(home).root;
    const covers = (root, target) => {
      const relative = path.relative(root, target);
      return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
    };
    // Evaluation isolation: an eval session must not read the operational knowledge under $HOME through
    // read_file/bash. Instead of exposing all of $HOME (the default below re-exposes it because account roots
    // live there), hide $HOME entirely with a tmpfs and re-expose ONLY the explicitly allowed roots (the eval
    // overlay + the session's own dirs). The OS tree outside $HOME stays read-only so the shell still runs.
    if (isolate) {
      const allow = uniqueRoots([...this.extraReadOnly, ...(isolate.allowRoots ?? []), ...(cwd ? [cwd] : [])]);
      const write = uniqueRoots(isolate.writableRoots ?? writableRoots ?? []);
      const args = ["bwrap", "--die-with-parent", "--new-session", "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts"];
      if (networkMode === "none") args.push("--unshare-net");
      // OS read-only for the shell/interpreter, then a tmpfs over $HOME hides every operational path under it.
      args.push("--ro-bind", filesystemRoot, filesystemRoot, "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--tmpfs", "/run", "--tmpfs", home);
      const bound = [];
      // Writable roots first (rw bind); the agent's workspace (cwd) is writable. Only paths under $HOME need
      // re-exposing — anything outside $HOME is already visible through the read-only OS bind above.
      for (const root of uniqueRoots([...write, ...(cwd ? [cwd] : [])])) {
        if (root === filesystemRoot || !covers(home, root) || bound.some((b) => covers(b, root))) continue;
        try { mkdirSync(root, { recursive: true }); } catch { /* may be a file */ }
        if (!existsSync(root)) continue;
        args.push("--bind", root, root); bound.push(root);
      }
      for (const root of allow) {
        if (!existsSync(root) || root === filesystemRoot || !covers(home, root) || bound.some((b) => covers(b, root))) continue;
        args.push("--ro-bind", root, root); bound.push(root); // re-expose an allowed path read-only on the tmpfs home
      }
      if (cwd && existsSync(cwd)) args.push("--chdir", cwd);
      args.push("--", ...command);
      return args;
    }
    const readRoots = uniqueRoots([...this.extraReadOnly, ...readableRoots]);
    const writeRoots = uniqueRoots(writableRoots);
    const rootWritable = writeRoots.includes(filesystemRoot);
    const homeVisible = rootWritable || [...readRoots, ...writeRoots].some((root) => covers(root, home));
    const args = ["bwrap", "--die-with-parent", "--new-session", "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts"];
    if (networkMode === "none") args.push("--unshare-net");
    args.push(rootWritable ? "--bind" : "--ro-bind", filesystemRoot, filesystemRoot, "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--tmpfs", "/run");
    if (!homeVisible) args.push("--tmpfs", home);
    const readBound = !rootWritable && readRoots.includes(filesystemRoot) ? [filesystemRoot] : [];
    const writeBound = rootWritable ? [filesystemRoot] : [];
    for (const root of readRoots) {
      if (!existsSync(root) || root === filesystemRoot || writeBound.some((boundRoot) => covers(boundRoot, root)) || readBound.some((boundRoot) => covers(boundRoot, root))) continue;
      args.push("--ro-bind", root, root); readBound.push(root);
    }
    for (const root of writeRoots) {
      if (root === filesystemRoot || writeBound.some((boundRoot) => covers(boundRoot, root))) continue;
      try { mkdirSync(root, { recursive: true }); } catch { /* may be a file */ }
      if (!existsSync(root)) continue;
      args.push("--bind", root, root); writeBound.push(root);
    }
    if (cwd && existsSync(cwd)) { if (![...readBound, ...writeBound].some((root) => covers(root, inside(cwd)))) args.push("--ro-bind", cwd, cwd); args.push("--chdir", cwd); }
    // The hidden home is a tmpfs: make it read-only so stray writes fail loudly (EROFS) instead of vanishing.
    // Bind mounts placed above stay writable because --remount-ro only touches this mount.
    if (!homeVisible) args.push("--remount-ro", home);
    args.push("--", ...command);
    return args;
  }

  async spawn(command, options) {
    const args = this.buildArgs(command, options);
    const child = spawn(args[0], args.slice(1), { cwd: options.cwd, env: { ...options.env, HOME: os.homedir() }, stdio: ["ignore", "pipe", "pipe"], detached: options.detached === true });
    this.log(`[bwrap] ${command.join(" ").slice(0, 120)} (rw: ${(options.writableRoots ?? []).length}, net: ${options.networkMode ?? "full"})`);
    return { process: Object.assign(child, { exited: waitForExit(child) }) };
  }
}
