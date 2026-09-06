import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { Agent, fetch as undiciFetch } from "undici";

/** Optional private CA applies to this connector only. Never alters global TLS
 * settings, disables verification, or copies MCP headers to OAuth endpoints. */
export function createMcpTlsFetch(caBundle: string | undefined, fetchFn: typeof fetch = fetch) {
  const dispatcher = caBundle === undefined ? undefined : new Agent({ connect: { ca: [...rootCertificates, caBundle.includes("-----BEGIN CERTIFICATE-----") ? caBundle : readFileSync(caBundle, "utf8")] } });
  // The locked Undici 5 Agent must use its matching fetch implementation;
  // Node 26's built-in dispatcher protocol is newer and incompatible.
  const implementation = dispatcher !== undefined && fetchFn === globalThis.fetch ? undiciFetch as unknown as typeof fetch : fetchFn;
  return {
    fetch: ((input, init) => implementation(input, { ...init, ...(dispatcher === undefined ? {} : { dispatcher }) } as RequestInit)) as typeof fetch,
    async dispose() { await dispatcher?.close(); },
  };
}
