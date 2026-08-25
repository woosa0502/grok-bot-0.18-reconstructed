import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readlink, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function gitOutput(repoRoot, args, execute = execFileAsync) {
  const result = await execute("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.stdout;
}

async function untrackedFingerprint(repoRoot, nulSeparatedPaths) {
  const relativePaths = nulSeparatedPaths.split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (path.relative(repoRoot, absolutePath).startsWith("..")) throw new Error(`Untracked path escaped the Belmont repository: ${relativePath}`);
    const metadata = await lstat(absolutePath);
    hash.update(JSON.stringify(relativePath));
    hash.update("\0");
    if (metadata.isSymbolicLink()) {
      hash.update("symlink\0");
      hash.update(await readlink(absolutePath));
    } else if (metadata.isFile()) {
      hash.update("file\0");
      hash.update(await readFile(absolutePath));
    } else {
      hash.update(`other:${metadata.mode}\0`);
    }
    hash.update("\0");
  }
  return { paths: relativePaths, sha256: hash.digest("hex") };
}

export async function captureWslBuildSourceIdentity({ repoRoot, executeGit = execFileAsync }) {
  const [rawHead, status, trackedDiff, untrackedPaths] = await Promise.all([
    gitOutput(repoRoot, ["rev-parse", "HEAD"], executeGit),
    gitOutput(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"], executeGit),
    gitOutput(repoRoot, ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], executeGit),
    gitOutput(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"], executeGit),
  ]);
  const head = rawHead.trim();
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error("Could not capture a full Belmont Git HEAD for the WSL build.");
  const untracked = await untrackedFingerprint(repoRoot, untrackedPaths);
  const core = {
    schemaVersion: 1,
    head,
    treeClean: status.length === 0,
    statusSha256: sha256(status),
    trackedDiffSha256: sha256(trackedDiff),
    untrackedSha256: untracked.sha256,
    untrackedPaths: untracked.paths,
  };
  return { ...core, combinedSha256: sha256(JSON.stringify(core)) };
}

export function assertWslBuildSourceIdentity(buildLineage, currentIdentity) {
  const built = buildLineage?.sourceIdentity;
  if (buildLineage?.schemaVersion !== 1 || typeof buildLineage.builtAt !== "string" || built?.schemaVersion !== 1 || typeof built.combinedSha256 !== "string") {
    throw new Error("Belmont WSL runtime has no valid build lineage. Run npm run wsl:setup.");
  }
  if (built.combinedSha256 !== currentIdentity.combinedSha256) {
    throw new Error(`Belmont WSL runtime is stale (built ${built.head.slice(0, 12)}, current ${currentIdentity.head.slice(0, 12)}). Run npm run wsl:setup before npm run wsl:start.`);
  }
  return buildLineage;
}

export async function writeWslBuildLineage(filePath, sourceIdentity, now = () => new Date()) {
  const lineage = { schemaVersion: 1, builtAt: now().toISOString(), sourceIdentity };
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(lineage, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, filePath);
  return lineage;
}
