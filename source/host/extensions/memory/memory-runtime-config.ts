import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { VECTOR_INDEX_VERSION, type EmbeddingIdentity, type RetrievalOptions } from "./kernel/index.js";

export interface MemoryRuntimeConfig {
  embeddingEndpoint?: string;
  embeddingToken?: string;
  embeddingIdentity: EmbeddingIdentity;
  indexVersion: string;
  retrieval: RetrievalOptions;
  indexTimeoutMs: number;
  inactivityMs: number;
  siteRevisions: Record<string, string>;
}

/** Rollout authority is persisted by migration; environment variables cannot undo a cutover. */
export function readMemoryRuntimeConfig(env: NodeJS.ProcessEnv = process.env): MemoryRuntimeConfig {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const flag = (key: string, fallback = false) => {
    const value = env[key];
    if (value === undefined) return fallback;
    if (value !== "0" && value !== "1") throw new Error(`${key} must be 0 or 1`);
    return value === "1";
  };
  const endpoint = env.SAND_MEMORY_EMBEDDING_ENDPOINT?.trim();
  const token = env.SAND_MEMORY_EMBEDDING_TOKEN?.trim();
  const indexVersion = env.SAND_MEMORY_INDEX_VERSION?.trim() || VECTOR_INDEX_VERSION;
  if (indexVersion !== VECTOR_INDEX_VERSION) throw new Error("Unsupported memory vector index version");
  const revisions: unknown = JSON.parse(env.SAND_MEMORY_SITE_REVISIONS_JSON || "{}");
  if (revisions === null || typeof revisions !== "object" || Array.isArray(revisions)
    || Object.entries(revisions).some(([domain, revision]) => !/^[a-z0-9.-]+$/.test(domain) || typeof revision !== "string" || !revision || revision.length > 256)) throw new Error("Invalid SAND_MEMORY_SITE_REVISIONS_JSON");
  return {
    ...(endpoint ? { embeddingEndpoint: endpoint } : {}),
    ...(token ? { embeddingToken: token } : {}),
    embeddingIdentity: {
      model: env.SAND_MEMORY_EMBEDDING_MODEL?.trim() || "intfloat/multilingual-e5-small",
      revision: env.SAND_MEMORY_EMBEDDING_REVISION?.trim() || "fd1525a9fd15316a2d503bf26ab031a61d056e98",
      dimension: integer("SAND_MEMORY_EMBEDDING_DIMENSION", 384, 1, 8192),
      recipe: env.SAND_MEMORY_EMBEDDING_RECIPE?.trim() || "e5-prefix-mean-l2-512-v1",
    },
    indexVersion,
    retrieval: {
      planning: true,
      dense: flag("SAND_MEMORY_DENSE", Boolean(endpoint)),
      hierarchy: flag("SAND_MEMORY_HIERARCHY"),
      graph: flag("SAND_MEMORY_GRAPH"),
      timeoutMs: integer("SAND_MEMORY_DENSE_TIMEOUT_MS", 1000, 1, 60000),
      budget: integer("SAND_MEMORY_CONTEXT_BUDGET", 2048, 128, 32768),
      limit: integer("SAND_MEMORY_RETRIEVAL_LIMIT", 10, 1, 100),
    },
    indexTimeoutMs: integer("SAND_MEMORY_INDEX_TIMEOUT_MS", 30000, 1, 120000),
    inactivityMs: integer("SAND_MEMORY_INACTIVITY_MS", 30 * 60000, 1000, 24 * 60 * 60000),
    siteRevisions: revisions as Record<string, string>,
  };
}

export function memoryOwnerNamespace(principalId: string): string {
  if (!principalId.trim()) throw new Error("Memory requires an authenticated principal");
  return `owner:${createHash("sha256").update(principalId).digest("hex")}`;
}

/** Preserve agent, user-author shard and project-author shard boundaries during import and writes. */
export function memoryScopeForDirectory(sandRoot: string, principalId: string, memoryDir: string): string {
  const path = relative(resolve(sandRoot), resolve(memoryDir));
  if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) throw new Error("Memory directory outside installation");
  const parts = path.split(sep);
  const agent = parts.length === 3 && parts[0] === "agents" && parts[2] === "memory";
  const user = parts[0] === "user-memory" && (parts.length === 1 || parts.length === 3 && ["agents", ".shards"].includes(parts[1]!));
  const project = parts[0] === "projects" && parts[2] === "memory" && (parts.length === 3 || parts.length === 5 && ["agents", ".shards"].includes(parts[3]!));
  if (!agent && !user && !project) throw new Error(`Unrecognized memory shard: ${path}`);
  // Hash the path without merging scopes or exposing filesystem/account names in the ledger namespace.
  return `${memoryOwnerNamespace(principalId)}:shard:${createHash("sha256").update(parts.join("/")).digest("hex")}`;
}
