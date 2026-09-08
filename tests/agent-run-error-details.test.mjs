import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { ConnectError, Code } from "@connectrpc/connect";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, ".build"), { recursive: true });
const temporary = await mkdtemp(path.join(root, ".build/agent-error-test-"));
await build({
  entryPoints: {
    errors: path.join(root, "source/host/extensions/transcript/agent-run-error.ts"),
    proto: path.join(root, "source/packages/proto/generated/aiserver/v1/utils_pb.ts"),
  },
  outdir: temporary,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node26",
});
const errors = await import(pathToFileURL(path.join(temporary, "errors.mjs")).href);
const { ErrorDetails } = await import(pathToFileURL(path.join(temporary, "proto.mjs")).href);
test.after(() => rm(temporary, { recursive: true, force: true }));

function detailedError(title = "Service unavailable", detail = "Try again later") {
  const message = new ErrorDetails({ details: { title, detail } });
  return new ConnectError("raw failure", Code.Unavailable, undefined, [{
    type: ErrorDetails.typeName,
    value: message.toBinary(),
  }]);
}

test("real ConnectError without details preserves the original error and code", () => {
  const error = new ConnectError("fixture unavailable", Code.Unavailable);
  assert.equal(errors.findBackendConnectError(error), null);
  assert.equal(errors.findBackendConnectError(error, false), error);
  assert.equal(errors.formatAgentRunError(error), error.message);
  assert.deepEqual(errors.describeAgentRunError(error), { detail: error.message });
});

test("wire-encoded backend details decode their title and message", () => {
  const error = detailedError();
  assert.equal(errors.findBackendConnectError(error), error);
  assert.equal(errors.getBackendErrorDetailMessage(error), "Service unavailable\n\nTry again later");
  assert.deepEqual(errors.describeAgentRunError(error), {
    title: "Service unavailable",
    detail: "Try again later",
  });
});

test("decoded protobuf details use the same backend descriptor", () => {
  const error = new ConnectError("raw", Code.Unknown, undefined, [
    new ErrorDetails({ details: { detail: "Decoded detail" } }),
  ]);
  assert.equal(errors.getBackendErrorDetailMessage(error), "Decoded detail");
});

test("nested aggregate traversal prefers typed details and terminates on cycles", () => {
  const plain = new ConnectError("outer", Code.Unknown);
  const inner = detailedError();
  const aggregate = new AggregateError([plain, inner], "wrapped");
  plain.cause = aggregate;
  assert.equal(errors.findBackendConnectError(aggregate), inner);
  assert.equal(errors.getBackendErrorDetailMessage(aggregate), "Service unavailable\n\nTry again later");
});

test("unrelated and malformed wire details keep the ConnectError fallback", () => {
  for (const detail of [
    { type: "fixture.Other", value: new Uint8Array([0xff]) },
    { type: ErrorDetails.typeName, value: new Uint8Array([0xff]) },
  ]) {
    const error = new ConnectError("fallback", Code.Internal, undefined, [detail]);
    assert.equal(errors.findBackendConnectError(error), null);
    assert.equal(errors.findBackendConnectError(error, false), error);
    assert.equal(errors.formatAgentRunError(error), error.message);
  }
});

test("ordinary errors and non-error inputs retain existing formatting", () => {
  assert.deepEqual(errors.describeAgentRunError(new Error("ordinary")), { detail: "ordinary" });
  assert.deepEqual(errors.describeAgentRunError("plain"), { detail: "plain" });
  assert.equal(errors.findBackendConnectError(null, false), null);
});
