import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function selectRendererRuntime({ repoRoot, args = [], env = {} }) {
  let mode = env.BELMONT_RENDERER?.trim() || "pinned";
  let supplied = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== "--renderer" && !arg.startsWith("--renderer=")) throw new Error(`Unknown renderer option: ${arg}`);
    if (supplied) throw new Error("Specify --renderer only once.");
    supplied = true;
    mode = arg === "--renderer" ? args[++index] : arg.slice("--renderer=".length);
  }
  if (mode !== "pinned" && mode !== "editable") throw new Error("Renderer must be pinned or editable.");
  const name = mode === "editable" ? "belmont-editable" : "belmont-wsl";
  return {
    mode,
    buildRoot: path.join(repoRoot, ".build", `${name}-build`),
    runtimeRoot: path.join(repoRoot, ".build", `${name}-runtime`),
    profileDir: env.BELMONT_WSL_PROFILE?.trim() || path.join(repoRoot, ".cache", `${name}-profile`),
  };
}

export async function assertEditableRendererStage(built, runtimeRoot) {
  const renderer = built.buildManifest.runtimeComposition.find(item => item.runtime === "renderer");
  const provenance = built.renderer?.provenance;
  if (built.buildManifest.buildKind !== "source-aware-reconstruction"
    || !built.hostActivation.clean || !built.electronMainActivation.clean
    || built.compositionAudit.summary.blockedFallbacks.length > 0
    || renderer?.mode !== "clean-source" || renderer?.source !== "frontend/src/main.tsx"
    || provenance?.mode !== "clean-source" || provenance.entrypoint !== "frontend/src/main.tsx"
    || !Array.isArray(built.renderer.outputs) || built.renderer.outputs.length === 0
    || !built.renderer.outputs.some(file => file.path === "dist/renderer/index.html")) {
    throw new Error("Editable runtime lacks audited clean-source renderer provenance.");
  }
  for (const file of built.renderer.outputs) {
    if (!file.path.startsWith("dist/renderer/") || file.path.split("/").includes("..")) {
      throw new Error(`Invalid editable renderer output: ${file.path}`);
    }
    const bytes = await readFile(path.join(runtimeRoot, file.path));
    if (bytes.byteLength !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      throw new Error(`Editable renderer staging drift: ${file.path}`);
    }
  }
}
