// Wiring guards for .cursor/hooks.json on the streaming Shell route (box daemon):
// preToolUse + beforeShellExecution gate before spawn, postToolUse /
// postToolUseFailure additional_context emitted as a `hookContext` stream event,
// and the agent-side Shell tool collecting that event.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

test("daemon shellStream runs the preToolUse and beforeShellExecution gates before spawning", () => {
  const source = read("source/box-exec-daemon/server.ts");
  const start = source.indexOf("async *shellStream(");
  assert.ok(start > 0, "shellStream method present");
  const body = source.slice(start, source.indexOf("this.spawnShell(args.command, cwd)", start));
  assert.match(body, /#preToolUseGate\("Shell", \{ command: args\.command, workingDirectory: args\.workingDirectory \}, signal\)/);
  assert.match(body, /#beforeShellExecutionGate\(args\.command, args\.workingDirectory, signal\)/);
  assert.match(body, /case: "permissionDenied", value: new ShellPermissionDenied\(\{ command: args\.command, workingDirectory: args\.workingDirectory, error: hookDeny \}\)/);
  // The deny path must return before the "start" event / spawn.
  assert.ok(body.indexOf("hookDeny !== undefined") < body.indexOf('case: "start"'), "gate precedes the start event");
});

test("daemon beforeShellExecution gate handles deny / failClosed / ask", () => {
  const source = read("source/box-exec-daemon/server.ts");
  const start = source.indexOf("async #beforeShellExecutionGate(");
  assert.ok(start > 0);
  const body = source.slice(start, source.indexOf("async #shellPostHooks(", start));
  assert.match(body, /\(await this\.#readHooksConfig\(\)\)\.beforeShellExecution \?\? \[\]/);
  assert.match(body, /hook_event_name: "beforeShellExecution", command, cwd: workingDirectory/);
  assert.match(body, /r\.exitCode === 2 \|\| \(entry\.failClosed === true && r\.exitCode !== 0\) \|\| rawPermission === "block" \|\| rawPermission === "deny"/);
  assert.match(body, /if \(denies\) return userMessage \?\? "Blocked by beforeShellExecution hook"/);
  assert.match(body, /rawPermission === "ask"/);
});

test("daemon emits postToolUse / postToolUseFailure additional_context as a hookContext stream event", () => {
  const source = read("source/box-exec-daemon/server.ts");
  const post = source.slice(source.indexOf("async #shellPostHooks("), source.indexOf("async *execute(request: ExecServerMessage"));
  assert.match(post, /exitCode === 0\s*\? \{ case: "postToolUse" as const, value: new PostToolUseRequestQuery\(\{ toolName: "Shell"/);
  assert.match(post, /\{ case: "postToolUseFailure" as const, value: new PostToolUseFailureRequestQuery\(\{ toolName: "Shell"/);
  assert.match(post, /new HookAdditionalContext\(\{ hookEventName: request\.case, content: additionalContext \}\)/);
  const stream = source.slice(source.indexOf("async *shellStream("), source.indexOf("async *shellStream(") + 12_000);
  assert.match(stream, /const hookContexts = await this\.#shellPostHooks\(args, outputTail, exitCode, Date\.now\(\) - startedAt, signal\)/);
  assert.match(stream, /case: "hookContext", value: new ShellStreamHookContext\(\{ hookAdditionalContexts: hookContexts \}\)/);
  // hookContext is emitted before the exit event so the agent sees it within the same tool call.
  assert.ok(stream.indexOf('case: "hookContext"') < stream.lastIndexOf('case: "exit", value: new ShellStreamExit'));
});

test("agent-side Shell tool pushes hookContext carriers into the hook context collector", () => {
  const source = read("source/packages/agent/tools/core/shell/create-shell-tool.ts");
  assert.match(source, /case "hookContext": meta\.hookContextCollector\?\.push\(\.\.\.event\.event\.value\.hookAdditionalContexts\); break;/);
  assert.doesNotMatch(source, /case "hookContext": break;/);
});

test("daemon preToolUse gate blocks 'ask' explicitly instead of silently allowing it", () => {
  // beforeShellExecution already blocked "ask" (no interactive hook prompt in
  // this build); #preToolUseGate let it fall through to ALLOW — the dangerous
  // direction for a hook that asked for a prompt. Both gates now block with an
  // explanation.
  const source = read("source/box-exec-daemon/server.ts");
  const start = source.indexOf("async #preToolUseGate(");
  assert.ok(start > 0);
  const body = source.slice(start, source.indexOf("async #beforeShellExecutionGate(", start));
  assert.match(body, /if \(rawPermission === "ask"\) \{/);
  assert.match(body, /no interactive hook prompt — the action was blocked/);
  // and the block comes AFTER deny handling so deny keeps priority
  assert.ok(body.indexOf("if (denies)") < body.indexOf('rawPermission === "ask"'));
});
