import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function gitOutput(repoRoot, args, execute = execFileAsync) {
  const result = await execute("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  return result.stdout.trimEnd();
}

async function artifactRecord(repoRoot, filePath) {
  return {
    path: path.relative(repoRoot, filePath),
    sha256: await sha256File(filePath),
  };
}

export async function collectWslRuntimeLineage({
  repoRoot,
  appRoot,
  profileDir,
  debugPort,
  processes,
  buildLineage,
  sourceIdentity,
  now = () => new Date(),
  executeGit = execFileAsync,
  runtimeGenerationId = randomUUID(),
}) {
  if (debugPort != null && !Number.isInteger(debugPort)) throw new Error("Belmont runtime lineage received an invalid CDP debug port.");
  const electronMainPath = path.join(appRoot, "dist", "electron-main", "main.cjs");
  const hostPath = path.join(appRoot, "dist", "host", "host-main.cjs");
  const rendererIndexPath = path.join(appRoot, "dist", "renderer", "index.html");
  const rendererProvenancePath = path.join(appRoot, "dist", "renderer-artifact-provenance.json");
  const rendererProvenance = JSON.parse(await readFile(rendererProvenancePath, "utf8"));
  const treeStatus = sourceIdentity == null ? await gitOutput(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"], executeGit) : null;
  const head = sourceIdentity?.head ?? await gitOutput(repoRoot, ["rev-parse", "HEAD"], executeGit);
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error("Could not capture a full Belmont Git HEAD for runtime lineage.");
  const resolvedTreeClean = sourceIdentity?.treeClean ?? treeStatus.length === 0;
  const resolvedStatusSha256 = sourceIdentity?.statusSha256 ?? createHash("sha256").update(treeStatus).digest("hex");
  if (buildLineage?.sourceIdentity?.combinedSha256 !== sourceIdentity?.combinedSha256) throw new Error("Belmont runtime lineage cannot bind a stale WSL build.");
  return {
    schemaVersion: 1,
    runtimeGenerationId,
    capturedAt: now().toISOString(),
    repoRoot: path.resolve(repoRoot),
    appRoot: path.resolve(appRoot),
    profileDir: path.resolve(profileDir),
    debugEndpoint: debugPort == null ? null : `http://127.0.0.1:${debugPort}`,
    git: {
      head,
      treeClean: resolvedTreeClean,
      treeStatus: treeStatus == null || treeStatus.length === 0 ? [] : treeStatus.split("\n"),
      treeStatusSha256: resolvedStatusSha256,
      sourceIdentitySha256: sourceIdentity?.combinedSha256 ?? null,
    },
    processes,
    build: {
      source: {
        ...await artifactRecord(repoRoot, path.join(appRoot, "dist", "wsl-build-lineage.json")),
        builtAt: buildLineage.builtAt,
        sourceIdentity: buildLineage.sourceIdentity,
      },
      electronMain: await artifactRecord(repoRoot, electronMainPath),
      host: await artifactRecord(repoRoot, hostPath),
      rendererIndex: await artifactRecord(repoRoot, rendererIndexPath),
      rendererProvenance: {
        ...await artifactRecord(repoRoot, rendererProvenancePath),
        mode: rendererProvenance.mode ?? null,
        inventorySha256: rendererProvenance.inventorySha256 ?? null,
        sourceArtifactSha256: rendererProvenance.sourceArtifactSha256 ?? null,
      },
    },
  };
}

export async function writeWslRuntimeLineage(filePath, lineage) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(lineage, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, filePath);
}
