// belmont-browse: per-session evaluation isolation for the native filesystem tools (our code).
//
// The per-session sites overlay already scopes memory_search (search-side isolation). But an eval session can
// still reach the operational site knowledge two other ways that Aside routes outside memory_search:
//   - bash: runs in the bwrap sandbox, whose default mode re-exposes every readable root (operational sites
//     among them) and would let `cat` read the champion page.
//   - read_file: a native tool gated by permission.files.readableRoots, into which the account bootstrap adds
//     the operational knowledge/sites root (syncKnowledgeReadPermission) so ordinary sessions can read pages.
// Both must be scoped per eval session: the candidate overlay stays readable, the operational sites do not.
// These pure planners are installed as globals (__belmontEvalIsolate / __belmontEvalPermission) and consumed by
// the patched daemon's bash tool and permission check. Ordinary sessions (no runtimeConfig.sitesDir) are
// returned unchanged, so nothing about normal browsing changes.
import path from "node:path";
import { realpathSync } from "node:fs";

const real = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
const covers = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

/** The operational sites subtree, by both the account's memory/sites alias and the shared knowledge/sites
 * target, each as its literal resolved path and its realpath — so a symlink alias and its target are both
 * covered regardless of which one a caller names. */
export function operationalSitesRoots(accountRoot, knowledgeDir) {
  const roots = new Set();
  const candidates = [path.join(accountRoot, "memory", "sites")];
  if (knowledgeDir) candidates.push(path.join(knowledgeDir, "sites"));
  for (const p of candidates) { roots.add(path.resolve(p)); roots.add(real(p)); }
  return [...roots];
}

/** The absolute session overlay dir, or null when this is not an evaluation session. */
export function evalSitesDir(session) {
  const sitesDir = session?.runtimeConfig?.sitesDir;
  return typeof sitesDir === "string" && sitesDir.trim() ? path.resolve(sitesDir) : null;
}

/** Readable roots for an eval session: drop any root that IS (or is inside) the operational sites — this
 * removes the explicit knowledge/sites read root while keeping the account root itself — then add the
 * candidate overlay. A root that merely CONTAINS the operational sites (the account root) is kept: reads that
 * resolve into the operational subtree still fall outside every kept root, so a deny-outside policy blocks
 * them, and the account's non-site memory stays readable. */
export function evalReadableRoots(readableRoots, accountRoot, sitesDir, knowledgeDir) {
  const op = operationalSitesRoots(accountRoot, knowledgeDir);
  const kept = (readableRoots ?? []).filter((r) => { const rp = real(r); return !op.some((o) => covers(o, rp)); });
  return [...new Set([...kept.map((r) => path.resolve(r)), sitesDir])];
}

/** bwrap isolate options for the bash tool, or null for an ordinary session. allowRoots re-expose the
 * account's readable roots minus the operational sites, plus the overlay; excludeRoots make the sandbox skip
 * the operational subtree even when a covering parent (the account root / its memory dir) is bound. */
export function evalIsolate({ session, accountRoot, readableRoots, writableRoots, knowledgeDir } = {}) {
  const sitesDir = evalSitesDir(session);
  if (!sitesDir || !accountRoot) return null;
  return {
    allowRoots: evalReadableRoots(readableRoots, accountRoot, sitesDir, knowledgeDir),
    writableRoots: [...(writableRoots ?? [])],
    excludeRoots: operationalSitesRoots(accountRoot, knowledgeDir),
  };
}

/** Scoped permission for the native read_file/write_file gate: operational sites removed from the readable
 * roots, the overlay added, and outside reads/writes denied (never asked → never auto-approved in eval). */
export function evalPermission(permission, session, accountRoot, knowledgeDir) {
  const sitesDir = evalSitesDir(session);
  if (!sitesDir || !accountRoot || !permission?.files) return permission;
  return {
    ...permission,
    files: {
      ...permission.files,
      readableRoots: evalReadableRoots(permission.files.readableRoots, accountRoot, sitesDir, knowledgeDir),
      outsideRead: "deny",
      outsideWrite: "deny",
    },
  };
}
