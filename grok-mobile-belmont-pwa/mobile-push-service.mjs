import { createHash } from "node:crypto";
import { readState, writeState } from "./server-state.mjs";
import { generateVapidKeys, sendWebPush, validatePushSubscription } from "./web-push.mjs";

export const pushDeviceId = (token) => createHash("sha256").update(token).digest("hex");
const eventId = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const emptyPrefs = () => ({ enabled: true, bots: {} });
const validRevision = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
function snapshotTime(agent) {
  const times = [agent.updatedAt, agent.lastActivityAt].filter((value) => Number.isFinite(value) && value > 0);
  return times.length ? Math.max(...times) : null;
}

/** Poll responses and buffered SSE frames can arrive in either order. */
function orderedSnapshot(agent, previous, authoritative) {
  const snapshotEpoch = typeof agent.snapshotEpoch === "string" && agent.snapshotEpoch ? agent.snapshotEpoch : null;
  const snapshotSeq = validRevision(agent.snapshotSeq);
  const retiredSnapshotEpochs = previous?.retiredSnapshotEpochs ?? [];
  if (previous?.snapshotEpoch != null) {
    if (snapshotEpoch == null || snapshotSeq == null) return null;
    if (snapshotEpoch === previous.snapshotEpoch && snapshotSeq <= previous.snapshotSeq) return null;
    if (snapshotEpoch !== previous.snapshotEpoch && (!authoritative || retiredSnapshotEpochs.includes(snapshotEpoch))) return null;
  }
  const revision = validRevision(agent.userIntentRevision);
  const previousRevision = validRevision(previous?.intentRevision);
  const timestamp = snapshotTime(agent);
  const previousTimestamp = previous?.timestamp ?? (previous?.activity > 0 ? previous.activity : null);
  const newerIntent = revision != null && previousRevision != null && revision > previousRevision;
  if (previousRevision != null && (revision == null || revision < previousRevision)) return null;
  if (!newerIntent && previousTimestamp != null && timestamp != null && timestamp < previousTimestamp) return null;
  // A newer explicit intent is the only authority to clear a stopped tombstone.
  // Missing/equal timestamps, missing revision or a late isUserStopped:false are not a resume.
  const stopped = agent.isUserStopped === true || (previous?.stopped === true && !(agent.isUserStopped === false && newerIntent));
  return { running: agent.isRunning === true || agent.isRunningTurn === true || agent.isComposingMessage === true,
    waiting: agent.awaitingUserResponse === true || (agent.awaitingUserResponse != null && typeof agent.awaitingUserResponse === "object"),
    activity: Number(agent.lastActivityAt) || 0,
    timestamp: newerIntent ? timestamp : Math.max(timestamp ?? 0, previousTimestamp ?? 0) || null,
    intentRevision: revision ?? previousRevision,
    snapshotEpoch,
    snapshotSeq,
    retiredSnapshotEpochs: previous?.snapshotEpoch && snapshotEpoch !== previous.snapshotEpoch
      ? [...retiredSnapshotEpochs, previous.snapshotEpoch].slice(-8) : retiredSnapshotEpochs,
    stopped,
    notify: agent.notifyOnUpdatesEnabled !== false && agent.isHiddenFromSidebar !== true && !stopped && !agent.id.startsWith("subagent-"),
    lastCompletedMessage: previous?.lastCompletedMessage ?? (!previous ? agent.lastMessageId ?? null : null),
  };
}

/** Runs independently of open phone pages. One serialized observer serves all paired devices. */
export function createMobilePushService({ file = null, gateway, now = Date.now, sender = sendWebPush, pollIntervalMs = 3000, subject = process.env.GROK_MOBILE_VAPID_SUBJECT || "https://belmont.local", onError = () => {} } = {}) {
  const state = readState(file, { version: 1, keys: null, devices: {}, agents: {}, pending: [] });
  let timer = null;
  let listening = false;
  let pendingObservation = null;
  let eventController = null;
  const persist = () => writeState(file, state);
  function retireUnusedObserver() {
    if (Object.values(state.devices).some((device) => device.subscriptions.length)) return;
    eventController?.abort();
    state.agents = {};
  }
  function keys() {
    if (!state.keys) { state.keys = generateVapidKeys(); persist(); }
    return state.keys;
  }
  function cleanup() {
    for (const [id, device] of Object.entries(state.devices)) {
      if (device.expiresAt <= now()) { delete state.devices[id]; continue; }
      device.subscriptions = device.subscriptions.filter((subscription) => !subscription.expirationTime || subscription.expirationTime > now());
    }
    state.pending = state.pending.filter((notification) => notification.createdAt > now() - 86400_000 && state.devices[notification.deviceId]?.subscriptions.some((subscription) => subscription.endpoint === notification.endpoint));
    retireUnusedObserver();
  }
  function schedule() {
    if (!listening || !pollIntervalMs || timer || !Object.keys(state.devices).length) return;
    timer = setInterval(() => { startEventStream(); void observe().catch(onError); }, pollIntervalMs);
    timer.unref?.();
    startEventStream();
  }
  function startEventStream() {
    if (!listening || eventController || typeof gateway.events !== "function" || !Object.values(state.devices).some((device) => device.subscriptions.length)) return;
    const controller = new AbortController();
    eventController = controller;
    void (async () => {
      const response = await gateway.events(controller.signal);
      if (!response.ok || !response.body) throw new Error("Push observer event stream unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const cancel = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener("abort", cancel, { once: true });
      try {
        while (!controller.signal.aborted) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          if (buffer.length > 16 * 1024 * 1024) throw new Error("Push observer event exceeds limit");
          let delimiter;
          while ((delimiter = /\r?\n\r?\n/u.exec(buffer)) != null) {
            const frame = buffer.slice(0, delimiter.index);
            buffer = buffer.slice(delimiter.index + delimiter[0].length);
            const data = frame.split(/\r?\n/u).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
            if (!data) continue;
            let event;
            try { event = JSON.parse(data); } catch { continue; }
            await handleEvent(event);
          }
        }
      } finally { controller.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    })().catch((error) => { if (!controller.signal.aborted) onError(error); }).finally(() => { if (eventController === controller) eventController = null; });
  }
  async function handleEvent(event) {
    const agents = event?.channel === "agents" && Array.isArray(event.payload?.agents) ? event.payload.agents
      : event?.channel === "agent-upserted" && event.payload?.agent ? [event.payload.agent] : null;
    if (!agents) return;
    const ordered = event.payload?.ordered;
    const replica = ordered?.replicaKey === "roster" && typeof ordered.epoch === "string" && validRevision(ordered.sequence) != null ? ordered : null;
    const previousReplica = state.rosterReplica;
    if (replica && previousReplica?.epoch === replica.epoch && replica.sequence <= previousReplica.sequence) return;
    const reconcileRoster = event.channel === "agents";
    if (!reconcileRoster && agents.some((agent) => typeof agent.snapshotEpoch === "string" && state.agents[agent.id]?.snapshotEpoch != null && agent.snapshotEpoch !== state.agents[agent.id].snapshotEpoch && !state.agents[agent.id].retiredSnapshotEpochs?.includes(agent.snapshotEpoch))) {
      // A host restart changes its random epoch. Confirm it with a fresh roster,
      // rather than treating an old connection's final frame as a new epoch.
      await observe();
    }
    // Replica sequence counts SSE emissions; snapshotSeq also counts RPC reads.
    // They are different clocks. In particular an empty SSE frame has no row
    // snapshot stamp, so it cannot prove that a more recently polled bot vanished.
    // Apply ordered rows, but confirm all omissions with a current complete poll
    // in the same observation, before any pending notification can be retried.
    await observe(agents, false, false, reconcileRoster);
    if (replica) { state.rosterReplica = replica; persist(); }
  }
  function preferences(deviceId) { return state.devices[deviceId]?.preferences ?? emptyPrefs(); }
  function ensureDevice(deviceId, expiresAt) {
    state.devices[deviceId] ??= { expiresAt, subscriptions: [], preferences: emptyPrefs() };
    state.devices[deviceId].expiresAt = expiresAt;
    return state.devices[deviceId];
  }
  async function observe(providedAgents, fullRoster = providedAgents == null, authoritative = providedAgents == null, reconcileRoster = false) {
    if (pendingObservation) {
      if (!providedAgents) return await pendingObservation;
      await pendingObservation;
      return await observe(providedAgents, fullRoster, authoritative, reconcileRoster);
    }
    pendingObservation = (async () => {
      cleanup();
      if (!Object.values(state.devices).some((device) => device.subscriptions.length)) { persist(); return; }
      const agents = providedAgents ?? await gateway.call("listAgents", {}, AbortSignal.timeout(15_000));
      if (!Array.isArray(agents)) throw new Error("Push observer could not read the bot roster");
      const observations = [{ agents, fullRoster, authoritative }];
      if (reconcileRoster) {
        const currentAgents = await gateway.call("listAgents", {}, AbortSignal.timeout(15_000));
        if (!Array.isArray(currentAgents)) throw new Error("Push observer could not read the bot roster");
        observations.push({ agents: currentAgents, fullRoster: true, authoritative: true });
      }
      for (const observation of observations) {
        for (const agent of observation.agents) {
          if (typeof agent?.id !== "string") continue;
          const previous = state.agents[agent.id];
          const next = orderedSnapshot(agent, previous, observation.authoritative);
          if (next == null) continue;
          state.agents[agent.id] = next;
          let kind = previous && next.waiting && !previous.waiting ? "needs-input"
            : previous?.running && !previous.stopped && !next.running && !next.waiting ? "completed" : null;
          if (kind === "completed" && agent.lastMessageId != null) {
            if (agent.lastMessageId === next.lastCompletedMessage) kind = null;
            next.lastCompletedMessage = agent.lastMessageId;
          }
          // Desktop OS notifications may be disabled globally; mobile has its own paired-device preference.
          if (!kind || !next.notify) continue;
          state.sequence = (state.sequence ?? 0) + 1;
          const id = eventId([agent.id, kind, next, now(), state.sequence]);
          for (const [deviceId, device] of Object.entries(state.devices)) {
            if (!device.preferences.enabled || device.preferences.bots[agent.id] === false) continue;
            for (const subscription of device.subscriptions) {
              state.pending.push({ id, deviceId, endpoint: subscription.endpoint, createdAt: now(), payload: {
                id, kind, botId: agent.id, title: String(agent.name || "Bot").slice(0, 80),
                body: kind === "needs-input" ? "승인이나 답변이 필요합니다." : "작업을 마쳤습니다.",
                url: `/?surface=ChatScreen&botId=${encodeURIComponent(agent.id)}`, tag: `belmont:${agent.id}:${kind}`,
              } });
            }
          }
        }
        if (observation.fullRoster) {
          const ids = new Set(observation.agents.map((agent) => agent?.id));
          for (const id of Object.keys(state.agents)) if (!ids.has(id)) state.agents[id].notify = false;
        }
      }
      // Persist transitions before transport; retries reuse the event id and notification tag.
      persist();
      for (const notification of [...state.pending]) {
        const device = state.devices[notification.deviceId];
        const subscription = device?.subscriptions.find((item) => item.endpoint === notification.endpoint);
        if (!subscription || !device.preferences.enabled || device.preferences.bots[notification.payload.botId] === false || state.agents[notification.payload.botId]?.notify !== true) {
          state.pending = state.pending.filter((item) => item !== notification);
          persist();
          continue;
        }
        try {
          await sender(subscription, notification.payload, { keys: keys(), subject, now });
          state.pending = state.pending.filter((item) => item !== notification);
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) {
            device.subscriptions = device.subscriptions.filter((item) => item.endpoint !== notification.endpoint);
            state.pending = state.pending.filter((item) => item.endpoint !== notification.endpoint || item.deviceId !== notification.deviceId);
          } else onError(error);
        }
        persist();
      }
    })();
    try { await pendingObservation; } finally { pendingObservation = null; }
  }
  return {
    config(deviceId) {
      cleanup();
      return { available: true, publicKey: keys().publicKey, subscribed: (state.devices[deviceId]?.subscriptions.length ?? 0) > 0, preferences: preferences(deviceId) };
    },
    preferences,
    setPreferences(deviceId, expiresAt, value) {
      const device = ensureDevice(deviceId, expiresAt);
      if (typeof value.enabled === "boolean") device.preferences.enabled = value.enabled;
      if (value.bots != null && typeof value.bots === "object" && !Array.isArray(value.bots)) {
        for (const [id, enabled] of Object.entries(value.bots)) if (typeof enabled === "boolean" && id.length < 256) device.preferences.bots[id] = enabled;
      }
      persist(); schedule();
      return device.preferences;
    },
    async subscribe(deviceId, expiresAt, value) {
      const subscription = validatePushSubscription(value, now());
      const device = ensureDevice(deviceId, expiresAt);
      // A browser endpoint has one owner. Re-pairing moves it to the new pairing session.
      for (const candidate of Object.values(state.devices)) candidate.subscriptions = candidate.subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
      // One pairing cookie identifies one browser installation; rotation replaces its old endpoint.
      device.subscriptions = [subscription];
      state.pending = state.pending.filter((item) => (item.deviceId !== deviceId || item.endpoint === subscription.endpoint) && (item.endpoint !== subscription.endpoint || item.deviceId === deviceId));
      keys(); persist();
      await observe();
      schedule();
      return { ok: true };
    },
    unsubscribe(deviceId, endpoint = null) {
      const device = state.devices[deviceId];
      if (device) device.subscriptions = endpoint ? device.subscriptions.filter((item) => item.endpoint !== endpoint) : [];
      state.pending = state.pending.filter((item) => item.deviceId !== deviceId || (endpoint && item.endpoint !== endpoint));
      retireUnusedObserver();
      persist();
    },
    logout(deviceId) {
      delete state.devices[deviceId];
      state.pending = state.pending.filter((item) => item.deviceId !== deviceId);
      retireUnusedObserver();
      persist();
    },
    observe,
    handleEvent,
    start() { listening = true; schedule(); },
    close() { listening = false; if (timer) clearInterval(timer); timer = null; eventController?.abort(); },
  };
}
