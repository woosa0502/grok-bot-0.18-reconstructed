import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sse(events) {
  return new Response(`${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("Codex provider delegates native Belmont tool calls to the turn executor", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "belmont-codex-tool-routing-"));
  const codexHome = path.join(temporary, "codex");
  const output = path.join(temporary, "provider-session.mjs");
  const previous = {
    CODEX_HOME: process.env.CODEX_HOME,
    SAND_DATA_ROOT: process.env.SAND_DATA_ROOT,
    fetch: globalThis.fetch,
  };
  try {
    await mkdir(codexHome);
    await writeFile(path.join(codexHome, "auth.json"), JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        id_token: "id",
        account_id: "account",
      },
    }), { mode: 0o600 });
    await build({
      entryPoints: [path.join(repoRoot, "source/host/extensions/inference/provider-session.ts")],
      outfile: output,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
    });
    process.env.CODEX_HOME = codexHome;
    process.env.SAND_DATA_ROOT = path.join(temporary, "data");
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(init.body);
      assert.equal(request.tools[0].name, "update_state");
      assert.deepEqual(request.tools[0].parameters, {
        type: "object",
        properties: {
          target: { type: "string" },
          action: { type: "string" },
        },
      });
      return sse([
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            call_id: "native-1",
            name: "update_state",
            arguments: "{\"target\":\"routine\",\"action\":\"create\"}",
          },
        },
        {
          type: "response.completed",
          response: {
            id: "resp-1",
            output: [],
            usage: { input_tokens: 4, output_tokens: 2, input_tokens_details: { cached_tokens: 1 } },
          },
        },
      ]);
    };

    const provider = await import(`${pathToFileURL(output).href}?${Date.now()}`);
    const executor = provider.createProviderPromptSession("codex").getExecutor();
    executor.appendMessages({ role: "user", content: "create routine" });
    const result = executor.stream({}, "inv-1", [{
      name: "update_state",
      description: "Update Belmont state",
      // Real Belmont tools carry the JSON schema inside the AI SDK Schema
      // wrapper produced by jsonSchema(...), rather than as a bare object.
      parameters: {
        jsonSchema: {
          type: "object",
          properties: {
            target: { type: "string" },
            action: { type: "string" },
          },
        },
      },
    }]);
    const events = [];
    for await (const event of result.fullStream) events.push(event);
    const response = await result.response;

    const expected = {
      type: "tool-call",
      toolCallId: "native-1",
      toolName: "update_state",
      args: { target: "routine", action: "create" },
    };
    assert.deepEqual(events, [expected]);
    assert.deepEqual(response.messages[0].content, [expected]);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous.CODEX_HOME;
    if (previous.SAND_DATA_ROOT === undefined) delete process.env.SAND_DATA_ROOT;
    else process.env.SAND_DATA_ROOT = previous.SAND_DATA_ROOT;
    await rm(temporary, { recursive: true, force: true });
  }
});
