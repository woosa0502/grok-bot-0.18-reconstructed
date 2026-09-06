import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

async function walk(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

export async function verifyMobileSourceInputs(mobileRoot) {
  const root = await realpath(mobileRoot);
  const manifest = JSON.parse(await readFile(path.join(root, "docs/asset-provenance.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error("Mobile runtime asset manifest is missing or invalid.");
  }
  const seen = new Set();
  for (const asset of manifest.assets) {
    if (typeof asset.path !== "string" || path.isAbsolute(asset.path) || seen.has(asset.path)) {
      throw new Error("Mobile asset paths must be unique and relative.");
    }
    seen.add(asset.path);
    const target = await realpath(path.resolve(root, asset.path));
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Mobile asset escapes source root: ${asset.path}`);
    const bytes = await readFile(target);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== asset.sha256 || bytes.byteLength !== asset.bytes) throw new Error(`Mobile asset drift: ${asset.path}`);
    if (typeof asset.license !== "string" || asset.license.length === 0) throw new Error(`Mobile asset has no license status: ${asset.path}`);
  }
  const sources = await walk(path.join(root, "src"));
  for (const target of sources.filter(file => /\.(?:tsx?|css)$/u.test(file))) {
    const source = await readFile(target, "utf8");
    if (/(?:data\/artifacts\/|\/home\/[^/]+\/|\.local\/share\/fonts\/)/u.test(source)) {
      throw new Error(`Mobile source depends on external recovery or user files: ${path.relative(root, target)}`);
    }
  }
  return { schemaVersion: 1, assets: manifest.assets.length, sourceFiles: sources.length, androidReference: manifest.androidReference };
}
