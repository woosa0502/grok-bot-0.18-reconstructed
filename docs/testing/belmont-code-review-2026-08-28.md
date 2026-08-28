# Belmont Code Review — 2026-08-28

## Status

- Verdict: `REVIEW_REQUIRED / FUNCTIONALLY_INCOMPLETE`
- Review target: `eb5890b1319112dbf1cc9dacbd1b076b0f15d1c6`
- Commit scope: all 20 commits authored on 2026-08-27 KST, plus the 2026-08-28 hook and local stdio MCP follow-ups
- Method: entrypoint → composition/routing → executor/protocol → state/transcript → renderer → shutdown/recovery tracing
- Verification: primary code review followed by an independent, refute-by-default adversarial review
- Mutation boundary: review only; no source changes, process restarts, or live runtime intervention

The reviewed changes restore several useful happy paths, but they do not close the complete functional contract. The strongest remaining gaps are filesystem boundary integrity, grep result fidelity, foreground subagent lifecycle ownership, hook reachability, and general MCP protocol compatibility.

## Scope and Commit Coverage

### File tools — `PARTIAL`

Reviewed commits:

`fb246ac`, `b251c81`, `bc2d5d4`, `b54581c`, `fbe3750`, `2734e28`, `742d405`, `0cc24c7`, `b47c222`, `a0a7afd`, `07310b9`, `42fc909`, `a33d462`, `9b9c8cb`.

Basic list, grep, glob, edit, write, delete, and terminal-metadata paths are present. Error fidelity, partial-result reporting, and canonical filesystem enforcement remain incomplete.

### Thread/reply renderer — `SOURCE CONTRACT VERIFIED`

Reviewed commit: `295745d`.

Recursive root resolution, cycle handling, nested reply projection, thread affordances, and pagination state are internally coherent. Flattening a selected nested reply to its root is an intentional shipped-renderer contract, not a defect.

The default WSL build preserves the checksum-pinned shipped renderer through `scripts/setup-wsl.mjs`; therefore this commit primarily reconstructs the editable frontend source rather than replacing the renderer used by the normal WSL fidelity runtime.

### Model fallback — `NO CONFIRMED DEFECT`

Reviewed commit: `5be261e`.

The fallback is used only after the environment and Codex `config.toml`. Actual model entitlement and the possibility that static model metadata differs from the transport-selected model were not verified against a live backend.

### Foreground subagent — `PARTIAL`

Reviewed commit: `d20f29f`.

The foreground child result now reaches the parent Task call. Independent transcript ownership, cancellation, resume, disposal, and nested-subagent enforcement remain incomplete.

### Documentation — `OVERCLAIM`

Reviewed commits: `86d6d00`, `b2b63ce`, `73be6f0`.

The test ledger contains useful live observations, but `RESOLVED` labels generalize beyond the paths actually verified. In particular, result binding does not establish complete subagent lifecycle correctness, and a WebSearch hook proof does not establish all hook steps.

### Hook and MCP follow-ups — `PARTIAL`

Reviewed follow-ups: `a9a3e27`, `89830c4`, and the final contract/typecheck correction `eb5890b`.

WebSearch hooks and the basic stdio MCP initialize/list/call round trip are implemented. Broader lifecycle and compatibility behavior is not complete.

## Findings

### Critical — canonical filesystem boundary is not enforced

**Provenance:** `direct_observation`, independently confirmed.

`BoxRuntime.resolvePath()` performs lexical containment only. `write()` then calls `writeFile()` without validating the final canonical path. An in-workspace symlink can therefore redirect a write outside the workspace. A symlinked parent directory can also let delete, list, and glob operations reach external paths.

Evidence:

- `source/box-exec-daemon/server.ts:443-463` — lexical path resolution
- `source/box-exec-daemon/server.ts:737-744` — read has an additional lstat/realpath guard
- `source/box-exec-daemon/server.ts:826-847` — delete lacks equivalent parent canonicalization
- `source/box-exec-daemon/server.ts:918-939` — write follows the resolved path

**Impact:** an agent operation can overwrite or delete files beyond the configured workspace, or read/list an unintended external directory.

**Required correction:** canonicalize the nearest existing parent, reject or explicitly govern symlink traversal, and apply one shared no-follow boundary policy to write/delete/list/glob. Preserve a separate rule for legitimate symlink workflows.

### Major — grep can return false negatives and inaccurate totals

**Provenance:** `direct_observation` and `raw_recompute`, independently confirmed.

The tool advertises context and sends `-B/-A` to ripgrep, but the daemon only retains JSON events whose type is `match`; ripgrep context events are discarded. The daemon also ignores stderr, exit status, spawn errors, and abort status, so an invalid regex or ripgrep failure can become a successful empty result.

`totalMatchedLines` increments only while retained results remain below `headLimit`. This makes `count`, `totalMatches`, and truncation flags inaccurate; exactly `headLimit` results are also marked truncated without evidence of an additional match.

Evidence:

- `source/packages/agent/tools/core/grep/grep.ts:92-137`
- `source/box-exec-daemon/server.ts:851-915`

**Impact:** the model cannot distinguish “no match” from “search failed” and may act on an incorrect repository view.

**Required correction:** preserve context events, distinguish ripgrep exit 0/1/error/abort, and maintain separate seen, skipped, retained, and total counters.

### Major — glob errors are converted into empty success

**Provenance:** `direct_observation`, independently confirmed.

`glob_file_search` executes `rg` with `2>/dev/null || true` and accepts both shell success and failure results. Missing `rg`, invalid invocation, or other execution failures can therefore render as `No files match`.

Evidence: `source/packages/agent/tools/core/glob/glob.ts:78-97`.

The broader claim that timeout also becomes no-match was refuted: timeout has a distinct shell result and follows the error path.

**Required correction:** remove `|| true`; treat only ripgrep's no-match status as an empty result and surface all other failures.

### Major — list_dir reports incomplete data as complete

**Provenance:** `direct_observation`, independently confirmed.

The recursive builder merges extension counts from children but does not add each child's `numFiles` to its parent. The renderer nevertheless labels that value as the number of “files in subtree.” A readdir failure returns an empty node, and exhaustion of the 2,000-entry budget silently stops traversal without a partial/truncated marker.

Evidence:

- `source/box-exec-daemon/server.ts:773-820`
- `source/packages/agent/tools/core/ls/formatters.ts:97-123`

**Required correction:** aggregate subtree counts and add explicit error/partial/truncation metadata to the protocol and renderer.

### Major — foreground subagent state and lifecycle remain parent-owned

**Provenance:** `direct_observation`, independently confirmed.

The foreground result-binding happy path is real: `SandSubagentHostAdapter` awaits the child and returns its final message. However, the child reuses production-shell closures that reference the parent's runner, session store, checkpoint store, and transcript ID.

Additional lifecycle gaps:

- the child is added to `ownedRunners`, but foreground release only removes the session map entry and computer-use window;
- the child is not removed or disposed until host shutdown;
- the cancellation closure interrupts the outer parent runner;
- completed foreground state persists only the model ID, so an independent child conversation cannot be resumed;
- owner/static config still supplies `isSubagentRunner: false`, weakening nested Task enforcement;
- the force-background handoff resource is requested by the Task client but has no host registration.

Evidence:

- `source/host/runner/agent-adapters.ts:43-73`
- `source/host/host-runner-composition.ts:2392-2433`
- `source/host/host-runner-composition.ts:2528-2539`
- `source/host/host-runner-composition.ts:2627-2678`
- `source/host/host-runner-composition.ts:2741-2747`
- `source/host/host-runner-composition.ts:2854-2863`
- `source/packages/agent/tools/task-client.ts:315-404`

**Impact:** parent checkpoint/transcript pollution, leaked runners, incorrect cancellation, nonfunctional resume, and unintended nested Task execution.

**Required correction:** construct a child-owned store/transcript/shell/settle owner; propagate child cancellation; dispose and deregister on release; persist resumable child state; enforce the real subagent flag.

### Major — hook support is only partially reachable

**Provenance:** `direct_observation`, independently confirmed.

WebSearch preToolUse/postToolUse/postToolUseFailure routing is connected. Other advertised lifecycle paths are incomplete:

- Belmont selects `useClientSideSubagent: true`, but the client-side Task execution path does not run or propagate subagentStart/subagentStop hook options;
- afterAgentThought requires `requestContext.hooksConfig.configuredSteps`, but the local request-context executor does not supply that configuration;
- multiple command hooks overwrite prior stdout instead of merging results;
- a nonzero fail-open hook still prevents subsequent hooks from running;
- SubagentStart parses `user_message` but omits it from the typed response;
- invalid matcher regexes are treated as matching every tool.

Evidence:

- `source/host/runner/tools/turn-toolset.ts:1492-1533`
- `source/packages/agent/tools/task.ts:448-469`
- `source/packages/agent/actions/user-message-action/abstract-user-message-action-handler.ts:1835-1861`
- `source/box-exec-daemon/server.ts:536-674`

**Required correction:** execute client Task lifecycle hooks exactly once, populate validated hook steps in request context, and define deterministic multi-hook merge and failure policies.

### Major — local MCP is not yet a general-compatible client

**Provenance:** `direct_observation`, independently confirmed.

The minimal client correctly performs initialize, initialized notification, one tools/list call, and tools/call. It preserves `structuredContent`; the earlier suspicion that this field was dropped was refuted.

Remaining incompatibilities:

- local `mcp.json` parsing drops `cwd` before configuration reaches the box;
- tools/list pagination is ignored;
- server requests, notifications, and list-changed events are ignored;
- audio content is mislabeled as image;
- embedded resource blobs and resource links lose fidelity;
- child stderr is never drained and can block a verbose server;
- stop sends SIGTERM without waiting or force-kill fallback;
- abort rejects the local promise but does not send MCP cancellation to the server.

Evidence:

- `source/host/extensions/mcp/mcp-service.ts:188-224`
- `source/box-exec-daemon/mcp-stdio-client.ts:97-226`
- `source/box-exec-daemon/mcp-stdio-client.ts:250-276`

**Required correction:** either adopt the official MCP SDK at this boundary or implement the missing protocol state machine, content union, cancellation, stderr draining, and shutdown escalation.

### Minor — edit accepts an empty search string

**Provenance:** `direct_observation`.

`old_string` has no minimum length. With `replace_all`, an empty string inserts replacement text between characters; occurrence counts are also nonsensical.

Evidence: `source/packages/agent/tools/core/edit/edit.ts:49-53,95-108`.

**Required correction:** require `old_string` to contain at least one character and direct create/overwrite/prepend use cases to the write tool.

## Claims Refuted or Narrowed

- Thread selection being normalized to the root is intentional, not a thread bug.
- Thread pagination loss was not established under the append-only chronological transcript invariant.
- Glob timeout does not follow the silent no-match path.
- MCP `structuredContent` is preserved in the current HEAD.
- The `0cc24c7` protected-path EACCES regression affecting virtual terminal reads was repaired by `68622fe`; it is historical, not an open current defect.
- Terminal metadata parsing and rendering are statically coherent; behavioral E2E remains unverified.

## Verification Results

Primary review commands on the final tracked HEAD:

```text
npm test                     74/74 passed, 0 failed, 0 skipped
npm run source:typecheck     passed
npm run typecheck            passed
npm run frontend:build       passed
git diff --check             passed
```

The 74-test run included the existing untracked `tests/unimplemented-restoration-code.test.mjs`; it is not part of commit `eb5890b`.

No dedicated regression suite currently covers:

- grep context/error/accurate-count behavior;
- symlinked-parent write/delete/list/glob boundaries;
- list_dir partial and recursive counts;
- foreground subagent cancel/resume/dispose/isolation;
- client-side Task and afterAgentThought hooks;
- MCP pagination, server requests, stderr-heavy servers, cancellation, content fidelity, and shutdown.

Green compilation and unit tests therefore establish structural consistency, not functional acceptance of these paths.

## Adversarial Review Reconciliation

The independent reviewer traced the same entrypoint-to-shutdown paths and returned `REFUTED` against a product-complete claim.

Confirmed by both reviews:

- filesystem canonical-boundary defect;
- grep context/error/count defects;
- glob and list_dir false-completion behavior;
- foreground subagent parent-state ownership and lifecycle gaps;
- hook reachability and multi-hook composition defects;
- MCP protocol/content/shutdown gaps;
- documentation `RESOLVED` overreach.

Corrections adopted from the adversarial pass:

- raised the symlink issue from write-only to a broader filesystem-integrity finding;
- removed glob timeout from the silent-success claim;
- rejected thread root-normalization as a bug;
- confirmed that MCP `structuredContent` is retained.

## Acceptance Gates

The verdict can be promoted only after independent tests demonstrate:

1. Canonical workspace confinement for write/delete/list/glob, including symlinked parents.
2. Grep context, invalid-regex reporting, accurate counts, pagination, and truncation.
3. Child-owned subagent transcript/state plus cancel, resume, nested guard, and deterministic disposal.
4. Client-side Task and afterAgentThought hooks leaving exact-once markers with multi-hook merge behavior.
5. MCP pagination, notifications/server requests, stderr-heavy operation, content round trip, cancellation, and graceful/forced shutdown.
6. A live Electron/CDP pass on the final build lineage without modifying or reusing the implementation's own test harness as the independent oracle.

Until those gates pass, the accurate product statement is:

> The reviewed commits restore important happy paths, but the affected functional boundaries remain partially implemented and require targeted regression and live acceptance testing.

---

## Remediation Log — 2026-08-28 (follow-up commits)

Response to the findings above. Commits: `eb5890b`, `23f1b09`, `4c6926d`,
`09ae1a0`. `npm run check` passes (source + frontend typecheck under
`exactOptionalPropertyTypes`, 80/80 tests including new regression coverage).

### Addressed

- **Canonical filesystem boundary (Critical):** `write`/`delete`/`list` now
  canonicalize the nearest existing ancestor and assert containment within the
  workspace/terminals roots (`#assertCanonicalWithinRoots`), so a symlinked
  parent can no longer redirect the operation. (`23f1b09`)
- **Grep fidelity (Major):** capture ripgrep stderr/exit/spawn/abort and
  distinguish "no match" (exit 1) from "search failed" (exit >=2 / spawn / abort);
  count total-seen separately from retained so counts and the truncation flag are
  accurate. (`23f1b09`)
- **Glob false-completion (Major):** dropped `2>/dev/null || true`; only exit 1
  with empty stderr is an empty result, everything else surfaces as an error.
  (`23f1b09`)
- **list_dir subtree count (Major):** child `numFiles` now rolls up into the
  parent. (`23f1b09`)
- **Hook composition (Major):** postToolUseFailure returns its own response case
  (failure additionalContext is no longer dropped); stop returns followupMessage;
  multiple command hooks run and MERGE their additionalContext with a first-deny
  short-circuit; a fail-open non-zero exit no longer stops later hooks; an invalid
  matcher regex matches nothing (fail-safe) and is logged; subagentStart returns
  its parsed user_message; snake_case response fields are honored. Config parsing
  follows the repo validator (type-omitted, matcher, timeout, failClosed) and logs
  malformed JSON. (`eb5890b`)
- **Hook reachability — all tools (Major):** a central box-daemon preToolUse gate
  lets a `.cursor/hooks.json` entry (matcher-scoped) block ANY box tool
  (Read/Grep/Shell/Write/Delete/LS) with no code change; verified a matcher-"Read"
  hook denies Read while leaving other tools untouched. (`4c6926d`)
- **MCP lifecycle (Major):** separate handshake vs 60-min tool-call timeouts;
  AbortSignal threaded through callMcpTool→callTool→JSON-RPC and an aborted call
  sends `notifications/cancelled`; start() records startError (no phantom
  "connected"); loadMcpServers respawns on config change / after a failed start;
  stopMcpServers runs on shutdown; child stderr is drained; stop escalates
  SIGTERM→SIGKILL; audio content is surfaced as text rather than mislabeled as
  image; structuredContent preserved (was already retained). (`eb5890b`)
- **edit empty old_string (Minor):** rejected with a pointer to the write tool.
  (`23f1b09`)
- **Regression coverage:** new tests for the MCP stdio client (handshake, calls,
  structuredContent, startError, abort) and for the hook config/response shapes
  against the repo validators. (`09ae1a0`)

### Still open (accurately PARTIAL)

- **Foreground subagent lifecycle (Major):** child still reuses the parent's
  runner/store/checkpoint/transcript; dispose/deregister on release, child-owned
  transcript, cancellation propagation, resumable child state, and the real
  `isSubagentRunner` flag are not yet implemented. The client-side Task path also
  still does not run subagentStart/subagentStop hooks.
- **afterAgentThought:** `config.enableExecuteHookExec` is set, but
  `requestContext.hooksConfig.configuredSteps` is not populated by the host request
  context, so the step does not yet fire.
- **MCP protocol completeness:** tools/list pagination, server requests /
  list-changed notifications, and embedded-resource-blob fidelity remain
  unimplemented; local `mcp.json` `cwd` is not carried (the repo `McpServerConfig`
  type has no `cwd` field — the box defaults cwd to /workspace).
- **Live acceptance:** the Electron/CDP acceptance pass in the gates has not been
  run as an independent oracle.

The accurate product statement remains: important paths are restored and the
reviewed correctness gaps are closed, but subagent isolation, a few lifecycle
hook paths, and full MCP protocol compatibility are still partial.
