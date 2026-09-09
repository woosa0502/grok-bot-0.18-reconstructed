// Linux implementation of the Aside native installation command boundary.
// The daemon retains its original DK wrapping/KDF and bootstrap logic.
import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createECDH, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, sign } from "node:crypto";
import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const transactionContext = new AsyncLocalStorage();
const queues = new Map();
const storageInfo = "belmont.linux.secure-storage.v1";

function bytes(value, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Invalid base64 key material");
  const result = Buffer.from(value, "base64");
  if (length !== undefined && result.length !== length) throw new Error("Invalid key material length");
  return result;
}

function publicRaw(privateJwk) {
  if (privateJwk?.kty !== "EC" || privateJwk.crv !== "P-256" || typeof privateJwk.d !== "string") throw new Error("Expected a P-256 installation key");
  const scalar = Buffer.from(privateJwk.d, "base64url");
  if (scalar.length !== 32) throw new Error("Invalid P-256 private scalar");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  const derived = ecdh.getPublicKey();
  const claimed = Buffer.concat([Buffer.from([4]), Buffer.from(privateJwk.x ?? "", "base64url"), Buffer.from(privateJwk.y ?? "", "base64url")]);
  // Node's JWK import trusts supplied x/y; it does not establish that d matches.
  if (!derived.equals(claimed)) throw new Error("Installation private/public key mismatch");
  return derived.toString("base64");
}

function readSigning(stateDir) {
  // This identity is also used by the browser. Never repair, rotate, or delete it here.
  const value = JSON.parse(readFileSync(path.join(stateDir, "installation-keys.json"), "utf8"));
  if (value.scheme !== "p256_v1" || typeof value.privateJwk?.d !== "string" || publicRaw(value.privateJwk) !== value.publicRawBase64) {
    throw new Error("Legacy installation signing identity is invalid; refusing to replace it");
  }
  return value;
}

function atomicWrite(file, value) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(value) + "\n");
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, file);
    const directory = openSync(path.dirname(file), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

/** Requires an existing, validated installation-keys.json from ensureInstallationKeys. */
export function createLinuxInstallation({ stateDir, legacyStorageDir, lockTimeoutMs = 10000, flockPath = "/usr/bin/flock" }) {
  stateDir = path.resolve(stateDir);
  const file = path.join(stateDir, "linux-installation.json");
  const lockFile = `${file}.lock`;
  const signing = readSigning(stateDir);
  const storageKey = Buffer.from(hkdfSync("sha256", Buffer.from(signing.privateJwk.d, "base64url"), Buffer.alloc(0), storageInfo, 32));
  const current = () => {
    const context = transactionContext.getStore();
    return context?.stateDir === stateDir ? context : null;
  };
  const readState = () => {
    if (!existsSync(file)) return { version: 1, signingPublicKey: signing.publicRawBase64, kemPrivateJwk: null, items: {} };
    const state = JSON.parse(readFileSync(file, "utf8"));
    if (state.version !== 1 || state.signingPublicKey !== signing.publicRawBase64 || !state.items || typeof state.items !== "object" || Array.isArray(state.items)) throw new Error("Linux installation storage is corrupt or belongs to a different signing identity");
    if (state.kemPrivateJwk !== null) {
      if (typeof state.kemPrivateJwk?.d !== "string" || publicRaw(state.kemPrivateJwk) === signing.publicRawBase64) throw new Error("Invalid or reused installation KEM");
    }
    return state;
  };
  const stateNow = () => current()?.state ?? readState();

  async function withInstallationTransaction(callback) {
    if (current()) return callback();
    const previous = queues.get(stateDir) ?? Promise.resolve();
    let release;
    const completed = new Promise((resolve) => { release = resolve; });
    queues.set(stateDir, completed);
    await previous;
    let lock;
    try {
      mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      // flock operates on the inherited open file description. Its short-lived child
      // exits after acquisition; the parent FD retains the kernel lock. An OOM kill
      // closes that FD automatically, so restart never needs to delete stale locks.
      lock = openSync(lockFile, "a+", 0o600);
      await new Promise((resolve, reject) => {
        const child = spawn(flockPath, ["--exclusive", "--wait", String(lockTimeoutMs / 1000), "3"], { stdio: ["ignore", "ignore", "pipe", lock] });
        let errorText = "";
        child.stderr.on("data", (chunk) => { errorText += chunk; });
        child.once("error", (error) => reject(new Error("Linux installation requires the system flock utility", { cause: error })));
        child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Installation transaction lock failed (${signal ?? code}): ${errorText.trim()}`)));
      });
      const lockedStat = fstatSync(lock);
      ftruncateSync(lock, 0);
      writeFileSync(lock, JSON.stringify({ pid: process.pid, token: randomUUID() }));
      const context = { stateDir, state: readState(), dirty: false };
      const result = await transactionContext.run(context, callback);
      const visibleStat = statSync(lockFile);
      if (lockedStat.dev !== visibleStat.dev || lockedStat.ino !== visibleStat.ino) throw new Error("Installation transaction lock file was replaced");
      if (context.dirty) atomicWrite(file, context.state);
      return result;
    } finally {
      try {
        if (lock !== undefined) closeSync(lock);
      } finally {
        release();
        if (queues.get(stateDir) === completed) queues.delete(stateDir);
      }
    }
  }

  function runNativeKeyCommand(command, payload = {}) {
    const state = stateNow();
    const keys = () => {
      if (!state.kemPrivateJwk) throw new Error("Installation KEM is not initialized");
      return { scheme: "p256_v1", sig: signing.publicRawBase64, kem: publicRaw(state.kemPrivateJwk) };
    };
    switch (command) {
      case "keys-status": return { keysInstalled: state.kemPrivateJwk !== null };
      case "public-keys": return keys();
      case "init-keys": {
        if (!current()) throw new Error("init-keys requires an installation transaction");
        if (!state.kemPrivateJwk) {
          state.kemPrivateJwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
          current().dirty = true;
        }
        return keys();
      }
      case "destroy-keys": {
        if (!current()) throw new Error("destroy-keys requires an installation transaction");
        state.kemPrivateJwk = null;
        current().dirty = true;
        return { success: true };
      }
      case "ecdh-secret": {
        keys();
        const peer = bytes(payload.peerPublicKey, 65);
        if (peer[0] !== 4) throw new Error("Expected uncompressed P-256 peer point");
        const ecdh = createECDH("prime256v1");
        ecdh.setPrivateKey(Buffer.from(state.kemPrivateJwk.d, "base64url"));
        return { sharedSecret: ecdh.computeSecret(peer).toString("base64") };
      }
      case "cdp-sign": return { signature: sign("sha256", bytes(payload.challenge), { key: createPrivateKey({ key: signing.privateJwk, format: "jwk" }), dsaEncoding: "der" }).toString("base64") };
      default: throw new Error(`Unknown Linux native installation command: ${command}`);
    }
  }

  async function runSecureStorageCommand(command, payload) {
    if (typeof payload?.key !== "string" || !payload.key) throw new Error("Secure storage requires a key");
    return withInstallationTransaction(() => {
      const context = current();
      const id = createHash("sha256").update(payload.key).digest("hex");
      const aad = Buffer.from(payload.key);
      const envelope = context.state.items[id];
      if (command === "read") {
        if (envelope === null) return { data: null }; // Tombstone prevents legacy resurrection.
        if (envelope === undefined) {
          if (!legacyStorageDir) return { data: null };
          try { return { data: readFileSync(path.join(legacyStorageDir, encodeURIComponent(payload.key)), "utf8") }; }
          catch (error) { if (error.code === "ENOENT") return { data: null }; throw error; }
        }
        if (envelope.version !== 1) throw new Error("Invalid secure storage envelope");
        const decipher = createDecipheriv("aes-256-gcm", storageKey, bytes(envelope.nonce, 12));
        decipher.setAAD(aad); decipher.setAuthTag(bytes(envelope.tag, 16));
        return { data: Buffer.concat([decipher.update(bytes(envelope.ciphertext)), decipher.final()]).toString("utf8") };
      }
      if (command === "clear") context.state.items[id] = null;
      else if (command === "save") {
        if (typeof payload.data !== "string") throw new Error("Secure storage data must be a string");
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", storageKey, nonce); cipher.setAAD(aad);
        const ciphertext = Buffer.concat([cipher.update(payload.data, "utf8"), cipher.final()]);
        context.state.items[id] = { version: 1, nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
      } else throw new Error(`Unknown secure storage command: ${command}`);
      context.dirty = true;
      return { success: true };
    });
  }

  return Object.freeze({ available: true, stateDir, runNativeKeyCommand, runSecureStorageCommand, withInstallationTransaction,
    getDeviceRegistration(appVersion, deviceName) {
      return { appVersion, deviceName, platform: "linux", installationScheme: "p256_v1", ikSigPublicKeyJwk: { ...createPublicKey(createPrivateKey({ key: signing.privateJwk, format: "jwk" })).export({ format: "jwk" }), ext: true, key_ops: ["verify"] }, ikSigKeyFingerprint: `sha256:${createHash("sha256").update(bytes(signing.publicRawBase64, 65)).digest("hex")}` };
    },
  });
}

export function installLinuxInstallation(options) {
  if (process.platform !== "linux") return null;
  const adapter = createLinuxInstallation(options);
  globalThis.__belmontLinuxInstallation = adapter;
  return adapter;
}
