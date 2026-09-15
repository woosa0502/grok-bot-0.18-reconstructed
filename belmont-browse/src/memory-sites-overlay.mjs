// Pure scope planning; normal FTS/CJK ranking is unchanged.
import fs from "node:fs";
import path from "node:path";
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const inside = (root, p) => { const r = path.relative(root, p); return r === "" || (!path.isAbsolute(r) && r !== ".." && !r.startsWith(`..${path.sep}`)); };
export function memoryOverlayRoots(accountRoot, sitesRoot, allowedRoots = []) {
  const memoryDir = real(path.join(accountRoot, "memory"));
  if (!sitesRoot) return { walkRoots: [memoryDir], allowed: [memoryDir, ...allowedRoots.map(real)], excluded: [], sites: null };
  const sites = real(sitesRoot);
  if (inside(memoryDir, sites) || allowedRoots.some(root => inside(real(root), sites))) throw new Error("OVERLAY_INSIDE_OPERATIONAL_MEMORY");
  // Exclusion by canonical subtree covers a physical memory/sites directory and symlink aliases,
  // not just the usual external knowledge/sites symlink used by one installation.
  const operationalSites = real(path.join(memoryDir, "sites"));
  if (inside(operationalSites, sites) || inside(sites, operationalSites)) throw new Error("OVERLAY_OVERLAPS_OPERATIONAL_SITES");
  return { walkRoots: [memoryDir, sites], allowed: [memoryDir, sites], excluded: [operationalSites], sites };
}
