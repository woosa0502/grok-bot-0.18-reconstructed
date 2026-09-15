import { randomBytes } from "node:crypto";
import { MemoryKernel, BelmontMemoryBridge, buildEvidencePacket } from "../dist/index.js";

// In-memory demonstration ONLY. Real keys belong in the OS keychain, never a source file.
const kernel = new MemoryKernel({ path: ":memory:", tombstoneKey: randomBytes(32) });
const scope = "user:demo";
try {
  // Principals are minted by the trusted host after authentication/consent, never by the LLM.
  const user = kernel.session({ id: "host:confirmed-user", actor: "user", scopes: [scope], capabilities: ["read", "capture", "propose", "explicit", "forget", "index"] });
  const agent = kernel.session({ id: "host:agent", actor: "agent", scopes: [scope], capabilities: ["read", "capture", "propose"] });
  const bridge = new BelmontMemoryBridge(user, agent);
  const result = bridge.confirmedRemember({ scope, content: "장거리 비행에서는 통로석을 선호한다", kind: "profile", messageId: "synthetic-confirmation-1", occurredAt: Date.now() });
  const hits = user.search(scope, "비행 통로석");
  // The demo uses a character counter; production must inject the model's actual tokenizer.
  const packet = buildEvidencePacket(user, scope, hits, 4000, (text) => text.length);
  console.log(JSON.stringify({ result, packet }, null, 2));
  if (result.status === "committed") {
    console.log("forget:", user.forget(scope, result.id));
    console.log("after forget:", user.search(scope, "통로석"));
  }
} finally { kernel.close(); }
