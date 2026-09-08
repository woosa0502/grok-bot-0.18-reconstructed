import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let temporary;
let subject;

before(async () => {
  await mkdir(path.join(repoRoot, ".build"), { recursive: true });
  temporary = await mkdtemp(path.join(repoRoot, ".build", "test-shared-room-"));
  const output = path.join(temporary, "module.mjs");
  await build({
    stdin: {
      contents: 'export { createSharedRoomProvider } from "./controller"; export { SharedRoomDialog } from "./view";',
      resolveDir: path.join(repoRoot, "frontend/src/recovered/features/agent-info/shared-room"),
    },
    outfile: output,
    bundle: true,
    external: ["react", "react-dom", "react/jsx-runtime"],
    format: "esm",
    platform: "node",
    jsx: "automatic",
  });
  subject = await import(pathToFileURL(output).href);
});

after(async () => {
  if (temporary != null) await rm(temporary, { recursive: true, force: true });
});

async function fixture(selfAuthId = "guest", operation) {
  const agents = [
    { id: "local", name: "Local", isGroup: false },
    { id: "group", name: "Group", isGroup: true },
    { id: "remote", name: "Remote", isGroup: false, remoteRoom: { roomId: "other" } },
    { id: "shared", name: "Shared", isGroup: false, isSharedRoom: true },
  ];
  let state = {
    isEnabled: true,
    selfAuthId,
    pendingJoinRequests: [],
    rooms: [{
      roomId: "room",
      name: "Shared workspace",
      hostAuthId: "host",
      members: [
        { kind: "human", authId: "host", displayName: "Host" },
        { kind: "human", authId: "guest", displayName: "Guest" },
      ],
    }],
    typingUsers: [],
  };
  const calls = [];
  const provider = subject.createSharedRoomProvider({
    subscribe: () => () => {},
    subscribeTransport: () => () => {},
    async call(method, args) {
      calls.push({ method, args });
      if (method === "getSharingState") return state;
      if (operation != null) return operation(method, args, state);
      if (method === "createRoomInvite") return { status: "ok", roomId: "room", shareUrl: "https://example.invalid/invite", expiresAtMs: 1000 };
      if (method === "addOwnAgentToSharedRoom") {
        state = { ...state, rooms: [{ ...state.rooms[0], members: [...state.rooms[0].members, { kind: "agent", authId: selfAuthId, agentId: args.agentId, displayName: args.agentName }] }] };
      }
      return state;
    },
  });
  provider.setContext({ roomId: "room", agentId: "shared", accountGeneration: 1, agents });
  await new Promise((resolve) => setImmediate(resolve));
  return {
    provider, calls, agents,
    render: () => renderToStaticMarkup(createElement(subject.SharedRoomDialog, {
      provider, roomId: "room", agentId: "shared", accountGeneration: 1, agents, isOpen: true, onClose: () => {},
    })),
  };
}

test("joined members can add their eligible local agent and receive the returned room state", async (t) => {
  const f = await fixture();
  t.after(() => f.provider.dispose());
  assert.equal(f.provider.getSnapshot().isHost, false);
  assert.match(f.render(), /aria-label="Add Local" type="button"/);
  assert.equal(await f.provider.addOwnAgent(f.agents[0]), true);
  assert.deepEqual(f.calls.filter((call) => call.method === "addOwnAgentToSharedRoom"), [
    { method: "addOwnAgentToSharedRoom", args: { roomId: "room", agentId: "local", agentName: "Local" } },
  ]);
  assert.deepEqual(f.provider.getSnapshot().selfAgentIds, ["local"]);
  assert.match(f.render(), /aria-label="Remove Local"/);
});

test("host add remains available while duplicate, group, remote, shared, and unknown agents stay excluded", async (t) => {
  const f = await fixture("host");
  t.after(() => f.provider.dispose());
  assert.equal(await f.provider.addOwnAgent(f.agents[0]), true);
  for (const agent of [...f.agents, { id: "unknown", name: "Unknown" }]) {
    assert.equal(await f.provider.addOwnAgent(agent), false);
  }
  assert.equal(f.calls.filter((call) => call.method === "addOwnAgentToSharedRoom").length, 1);
  assert.doesNotMatch(f.render(), /aria-label="Add (Group|Remote|Shared)"/);
});

test("an unresolved account identity disables Add and cannot send an add request", async (t) => {
  const f = await fixture(null);
  t.after(() => f.provider.dispose());
  assert.match(f.render(), /aria-label="Add Local" disabled=""/);
  assert.equal(await f.provider.addOwnAgent(f.agents[0]), false);
  assert.equal(f.calls.filter((call) => call.method === "addOwnAgentToSharedRoom").length, 0);
});

test("agents that become remote or shared are removed from the current candidate list", async (t) => {
  for (const changed of [{ remoteRoom: { roomId: "other" } }, { isSharedRoom: true }]) {
    const f = await fixture();
    t.after(() => f.provider.dispose());
    const updated = { ...f.agents[0], ...changed };
    f.provider.setContext({ roomId: "room", agentId: "shared", accountGeneration: 1, agents: [updated, ...f.agents.slice(1)] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.provider.getSnapshot().candidates.some((agent) => agent.id === "local"), false);
    assert.equal(await f.provider.addOwnAgent(updated), false);
    assert.doesNotMatch(f.render(), /aria-label="Add Local"/);
    assert.equal(f.calls.filter((call) => call.method === "addOwnAgentToSharedRoom").length, 0);
  }
});

test("pending Add cannot be submitted twice and backend errors are visible in the dialog", async (t) => {
  let reject;
  const f = await fixture("guest", () => new Promise((resolve, rejectOperation) => { reject = rejectOperation; }));
  t.after(() => f.provider.dispose());
  const pending = f.provider.addOwnAgent(f.agents[0]);
  assert.match(f.render(), /aria-label="Add Local" disabled=""/);
  assert.equal(await f.provider.addOwnAgent(f.agents[0]), false);
  reject(new Error("Sharing service unavailable"));
  assert.equal(await pending, false);
  assert.match(f.render(), /role="alert">Sharing service unavailable/);
  assert.equal(f.calls.filter((call) => call.method === "addOwnAgentToSharedRoom").length, 1);
});

test("invite generation is host-only and distinguishes generating a link from copying one", async (t) => {
  const host = await fixture("host");
  const guest = await fixture("guest");
  t.after(() => { host.provider.dispose(); guest.provider.dispose(); });
  assert.match(host.render(), />Generate invite link<\/button>/);
  assert.doesNotMatch(host.render(), /Cmd-K|Join shared room/);
  assert.match(host.render(), /Joining from an invite link is not available in this app yet/);
  assert.equal(await guest.provider.createRoomInvite(), null);
  assert.doesNotMatch(guest.render(), /Generate invite link|Copy link/);
  assert.equal((await host.provider.createRoomInvite()).status, "ok");
  assert.match(host.render(), /aria-label="Room link"/);
  assert.match(host.render(), />Copy link<\/button>/);
  assert.equal(guest.calls.filter((call) => call.method === "createRoomInvite").length, 0);
});

test("a failed invite can be retried and does not hide a later agent action error", async (t) => {
  let inviteAttempts = 0;
  const f = await fixture("host", (method) => {
    if (method === "createRoomInvite") {
      inviteAttempts += 1;
      return inviteAttempts === 1
        ? { status: "error", message: "Invite service unavailable" }
        : { status: "ok", roomId: "room", shareUrl: "https://example.invalid/retry", expiresAtMs: 1000 };
    }
    throw new Error("Agent addition unavailable");
  });
  t.after(() => f.provider.dispose());
  assert.equal((await f.provider.createRoomInvite()).status, "error");
  assert.match(f.render(), /role="alert">Invite service unavailable/);
  assert.match(f.render(), />Generate invite link<\/button>/);
  assert.equal(await f.provider.addOwnAgent(f.agents[0]), false);
  assert.match(f.render(), /role="alert">Agent addition unavailable/);
  assert.equal((await f.provider.createRoomInvite()).status, "ok");
  assert.match(f.render(), /aria-label="Room link"/);
});
