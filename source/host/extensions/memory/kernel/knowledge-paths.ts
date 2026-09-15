import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
/** Enumerate only Markdown beneath the designated canonical root; stop symlink cycles. */
export function listKnowledgeMarkdown(dir: string, allowedRoot: string, out: string[] = [], visited = new Set<string>()): string[] {
  const within = (path: string, root: string) => path === root || path.startsWith(root + sep);
  let root: string, current: string, entries: string[];
  try {
    root = realpathSync(allowedRoot); current = realpathSync(dir);
    if (!within(current, root) || visited.has(current)) return out;
    visited.add(current); entries = readdirSync(current).sort();
  } catch { return out; }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(current, name);
    try {
      const target = realpathSync(full);
      if (!within(target, root)) continue;
      const stat = statSync(target);
      if (stat.isDirectory()) listKnowledgeMarkdown(target, root, out, visited);
      else if (stat.isFile() && target.endsWith(".md")) out.push(target);
    } catch { /* A concurrently removed file is absent from this scan. */ }
  }
  return [...new Set(out)];
}
