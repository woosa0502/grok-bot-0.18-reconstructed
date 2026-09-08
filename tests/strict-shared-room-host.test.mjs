import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: [resolve(import.meta.dirname, "../source/host/extensions/cross-user-sharing/xuser-sharing-service.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { SandXuserSharingService } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

const room = {
  roomId: "room",
  name: "Shared room",
  hostAuthId: "host",
  members: [
    { kind: "human", authId: "host" },
    { kind: "human", authId: "self" },
    { kind: "human", authId: "other" },
    { kind: "agent", authId: "self", agentId: "local", displayName: "Local" },
  ],
};
const request = { requestId: "request", roomId: "room", requesterAuthId: "guest" };
const unchangedRequest = { requestId: "other-request", roomId: "room", requesterAuthId: "another-guest" };
const operations = [
  { name: "respondToJoinRequest", path: "/sand/share-rooms/join/respond", body: { requestId: "request", isApproved: true }, run: (service) => service.respondToJoinRequest({ requestId: "request", isApproved: true }) },
  { name: "addOwnAgent", path: "/sand/share-rooms/agents/add", body: { roomId: "room", agentId: "new-local", agentName: "New local" }, run: (service) => service.addOwnAgent({ roomId: "room", agentId: "new-local", agentName: "New local" }) },
  { name: "removeOwnAgent", path: "/sand/share-rooms/agents/remove", body: { roomId: "room", agentId: "local" }, run: (service) => service.removeOwnAgent("room", "local") },
  { name: "leaveSharedRoom", path: "/sand/share-rooms/leave", body: { roomId: "room" }, run: (service) => service.leaveSharedRoom("room") },
];

async function fixture() {
  let enabled = true;
  let mutationResponse = () => Response.json({});
  let wireState = { pendingJoinRequests: [request, unchangedRequest], rooms: [room] };
  const calls = [];
  const revoked = [];
  const installed = [];
  const emitted = [];
  const idlePolicy = { name: "test-idle", start: () => ({ dispose() {} }) };
  const service = new SandXuserSharingService({
    getAccessToken: async () => "fake-test-token",
    getBackendUrl: () => "https://sharing.test.invalid",
    getSelfAuthId: async () => "self",
    isEnabled: () => enabled,
    emitSharing: (value) => emitted.push(structuredClone(value)),
    resolveAttachment: async () => null,
    timing: {
      clock: { now: () => 1000, monotonicNow: () => 1000, schedule: () => ({ dispose() {} }) },
      relayPoll: idlePolicy,
      reconcilePoll: idlePolicy,
      selfIdentityRetry: idlePolicy,
      remoteTurnDeadline: { name: "test-deadline", run: (work) => work(new AbortController().signal) },
      typingExpiry: () => ({ name: "test-expiry", arm: () => ({ dispose() {} }) }),
    },
    manager: {
      getSharedRoomIdForAgent: async () => null,
      listRoomAgentIds: async () => [],
      markMirrorRoomRevoked: async (id) => { revoked.push(id); },
      getAgentDisplayProfile: async () => ({ name: "Local", description: "" }),
      getAgentAvatar: async () => null,
      restampRoomEntry: async () => {},
      appendSharedRoomActivityNotice: async () => {},
      runRemoteRequestedMemberTurn: async () => [],
      appendMirrorRoomEntry: async () => true,
      postSharedRoomGuestMessage: async () => {},
      ensureMirrorRoom: async (value) => { installed.push(structuredClone(value)); },
      ensureHostedSharedRoom: async () => null,
      findRoomAgentId: async () => null,
      isAgentCapReached: async () => false,
    },
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push({ path, body: JSON.parse(options.body) });
      return path === "/sand/share-state" ? Response.json(wireState) : mutationResponse();
    },
  });
  await service.start();
  calls.length = revoked.length = installed.length = emitted.length = 0;
  return {
    service, calls, revoked, installed, emitted,
    setEnabled(value) { enabled = value; },
    setResponse(value) { mutationResponse = typeof value === "function" ? value : () => Response.json(value); },
    setShareState(value) { wireState = value; },
  };
}

function assertNoMutation(f, before, operation) {
  assert.deepEqual(f.service.getState(), before);
  assert.deepEqual(f.calls, [{ path: operation.path, body: operation.body }]);
  assert.deepEqual(f.revoked, []);
  assert.deepEqual(f.installed, []);
  assert.deepEqual(f.emitted, []);
  assert.deepEqual(f.service.departures.roomTombstones.list(), []);
  assert.deepEqual(f.service.departures.pendingDepartures.list(), []);
  assert.equal(f.service.isRoomAbandoned("room"), false);
}

for (const operation of operations) {
  test(`${operation.name} propagates fetch rejection without mutating local sharing state`, async (t) => {
    const f = await fixture();
    t.after(() => f.service.stop());
    const before = structuredClone(f.service.getState());
    const injected = new Error("injected network rejection");
    f.setResponse(() => { throw injected; });
    await assert.rejects(operation.run(f.service), (error) => error === injected);
    assertNoMutation(f, before, operation);
  });

  test(`${operation.name} propagates non-2xx relay failure without mutating local sharing state`, async (t) => {
    const f = await fixture();
    t.after(() => f.service.stop());
    const before = structuredClone(f.service.getState());
    f.setResponse(() => new Response("injected failure", { status: 503 }));
    await assert.rejects(operation.run(f.service), (error) => error.name === "SandXuserRelayHttpError" && error.status === 503 && error.path === operation.path);
    assertNoMutation(f, before, operation);
  });

  test(`${operation.name} rejects an explicit server error before installing its room or removing requests`, async (t) => {
    const f = await fixture();
    t.after(() => f.service.stop());
    const before = structuredClone(f.service.getState());
    f.setResponse({ status: "error", message: "Server rejected this mutation", room: { ...room, name: "Must not install" } });
    await assert.rejects(operation.run(f.service), { message: "Server rejected this mutation" });
    assertNoMutation(f, before, operation);
  });

  test(`${operation.name} rejects disabled sharing without issuing a relay call`, async (t) => {
    const f = await fixture();
    t.after(() => f.service.stop());
    const before = structuredClone(f.service.getState());
    f.setEnabled(false);
    await assert.rejects(operation.run(f.service), /Sharing isn't enabled/);
    f.setEnabled(true);
    assert.deepEqual(f.service.getState(), before);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.revoked, []);
    assert.deepEqual(f.installed, []);
    assert.deepEqual(f.emitted, []);
    assert.deepEqual(f.service.departures.roomTombstones.list(), []);
  });
}

test("respondToJoinRequest installs an approved room and removes only the answered request", async (t) => {
  const f = await fixture();
  t.after(() => f.service.stop());
  const approved = { ...room, members: [...room.members, { kind: "human", authId: "guest" }] };
  f.setResponse({ status: "approved", room: approved });
  const result = await f.service.respondToJoinRequest({ requestId: "request", isApproved: true });
  assert.deepEqual(result, f.service.getState());
  assert.deepEqual(result.pendingJoinRequests, [unchangedRequest]);
  assert.deepEqual(result.rooms, [approved]);
  assert.deepEqual(f.installed, [approved]);
  assert.equal(f.emitted.length, 1);
});

test("respondToJoinRequest treats an intentional denial as a successful decision", async (t) => {
  const f = await fixture();
  t.after(() => f.service.stop());
  f.setResponse({ status: "denied" });
  const result = await f.service.respondToJoinRequest({ requestId: "request", isApproved: false });
  assert.deepEqual(result.pendingJoinRequests, [unchangedRequest]);
  assert.deepEqual(result.rooms, [room]);
  assert.deepEqual(f.installed, []);
  assert.equal(f.emitted.length, 1);
});

for (const operation of operations.slice(1, 3)) {
  test(`${operation.name} installs a successful room response and returns the sharing state`, async (t) => {
    const f = await fixture();
    t.after(() => f.service.stop());
    const updated = { ...room, members: operation.name === "addOwnAgent"
      ? [...room.members, { kind: "agent", authId: "self", agentId: "new-local", displayName: "New local" }]
      : room.members.filter((member) => member.agentId !== "local") };
    f.setResponse({ room: updated });
    const result = await operation.run(f.service);
    assert.deepEqual(result, f.service.getState());
    assert.deepEqual(result.rooms, [updated]);
    assert.deepEqual(result.pendingJoinRequests, [request, unchangedRequest]);
    assert.deepEqual(f.installed, [updated]);
    assert.deepEqual(f.calls, [{ path: operation.path, body: operation.body }]);
    assert.equal(f.emitted.length, 1);
  });

  test(`${operation.name} preserves the pinned optional-room response contract`, async (t) => {
    const f = await fixture();
    t.after(() => f.service.stop());
    const before = structuredClone(f.service.getState());
    f.setResponse({});
    assert.deepEqual(await operation.run(f.service), before);
    assertNoMutation(f, before, operation);
  });
}

for (const targetAuthId of [undefined, "self", "other"]) {
  test(`leaveSharedRoom success preserves departure semantics for ${targetAuthId ?? "implicit self"}`, async (t) => {
    const f = await fixture();
    t.after(() => f.service.stop());
    const isSelf = targetAuthId !== "other";
    const remaining = { ...room, members: room.members.filter((member) => member.authId !== "other") };
    f.setResponse({});
    f.setShareState({ pendingJoinRequests: [], rooms: isSelf ? [room] : [remaining] });
    const result = await f.service.leaveSharedRoom("room", targetAuthId);
    assert.deepEqual(result, f.service.getState());
    assert.deepEqual(f.calls, [
      { path: "/sand/share-rooms/leave", body: { roomId: "room", ...(targetAuthId == null ? {} : { targetAuthId }) } },
      { path: "/sand/share-state", body: {} },
    ]);
    assert.deepEqual(f.revoked, isSelf ? ["room"] : []);
    assert.deepEqual(result.rooms, isSelf ? [] : [remaining]);
    assert.equal(f.service.isRoomAbandoned("room"), isSelf);
    assert.deepEqual(f.service.departures.roomTombstones.list(), isSelf ? [{ roomId: "room", ownerAuthId: "self", tornDownAtMs: 1000 }] : []);
    assert.deepEqual(f.service.departures.pendingDepartures.list(), []);
  });
}

test("leaveSharedRoom accepts a successful JSON null response without inventing a status contract", async (t) => {
  const f = await fixture();
  t.after(() => f.service.stop());
  f.setResponse(null);
  f.setShareState({ pendingJoinRequests: [], rooms: [] });
  const result = await f.service.leaveSharedRoom("room");
  assert.deepEqual(result.rooms, []);
  assert.deepEqual(f.revoked, ["room"]);
  assert.equal(f.service.isRoomAbandoned("room"), true);
  assert.deepEqual(f.calls.map((call) => call.path), ["/sand/share-rooms/leave", "/sand/share-state"]);
});

for (const targetAuthId of ["self", "other"]) {
  test(`leaveSharedRoom failure for explicit ${targetAuthId} does not revoke, tombstone, or reconcile`, async (t) => {
    const f = await fixture();
    t.after(() => f.service.stop());
    const before = structuredClone(f.service.getState());
    const operation = { path: "/sand/share-rooms/leave", body: { roomId: "room", targetAuthId } };
    for (const response of [
      () => new Response("not your room to close", { status: 404 }),
      () => Response.json({ status: "error", message: "Removal was rejected" }),
    ]) {
      f.calls.length = 0;
      f.setResponse(response);
      await assert.rejects(f.service.leaveSharedRoom("room", targetAuthId));
      assertNoMutation(f, before, operation);
    }
  });
}

test("explicit server errors without a usable message still reject with a readable error", async (t) => {
  const f = await fixture();
  t.after(() => f.service.stop());
  for (const message of [undefined, "", "   ", 42]) {
    f.setResponse({ status: "error", message });
    await assert.rejects(f.service.leaveSharedRoom("room"), (error) => error instanceof Error && error.message.trim().length > 0);
  }
  assert.deepEqual(f.revoked, []);
  assert.deepEqual(f.service.departures.roomTombstones.list(), []);
});
