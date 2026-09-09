import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createECDH, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createLinuxInstallation } from "../src/linux-installation.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "vendor/aside-906/apps/daemon/build/daemon.mjs");
const PATCH = path.join(ROOT, "tools/patch-daemon-linux.py");
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "linux-installation-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const identity = { version: 1, scheme: "p256_v1", privateJwk: privateKey.export({ format: "jwk" }), publicRawBase64: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64") };
  const identityFile = path.join(dir, "installation-keys.json");
  writeFileSync(identityFile, JSON.stringify(identity), { mode: 0o600 });
  return { dir, identity, identityFile, adapter: createLinuxInstallation({ stateDir: dir }) };
}
function patchedBundle(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "linux-installation-patch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "daemon.mjs");
  const original = readFileSync(SOURCE, "utf8");
  writeFileSync(file, original);
  const result = spawnSync("python3", [PATCH, file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return { file, source: readFileSync(file, "utf8"), original };
}

// Run the preserved original native-installation/KDF algorithm without importing the
// daemon (which would initialize profiles, native modules and services). AEAD primitives
// are implemented by Node/OpenSSL; no mock success paths or fixed cryptographic output.
function installationRuntime(source, adapter) {
  const start = source.indexOf("function assertSupported(){");
  const end = source.indexOf("var NATIVE_INSTALL_METADATA", start);
  const native = source.slice(start, end);
  const storageStart = source.indexOf("async function saveSecureStorageItem");
  const storageEnd = source.indexOf("var SECURE_STORAGE_KEYS", storageStart);
  const wrappers = ["getNativeInstallationStatus", "initNativeInstallation", "destroyNativeInstallation", "unwrapNativeDk"].map((name) => {
    const line = source.split("\n").find((line) => line.startsWith(`async function ${name}(){`));
    assert.ok(line, name);
    return line;
  }).join("\n");
  const sodium = {
    crypto_aead_chacha20poly1305_ietf_encrypt(plain, aad, ignored, nonce, key) {
      const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
      cipher.setAAD(aad, { plaintextLength: plain.length });
      return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    },
    crypto_aead_chacha20poly1305_ietf_decrypt(ignored, encrypted, aad, nonce, key) {
      const data = Buffer.from(encrypted);
      const cipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
      cipher.setAuthTag(data.subarray(-16));
      cipher.setAAD(aad, { plaintextLength: data.length - 16 });
      return new Uint8Array(Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]));
    },
  };
  const sandbox = {
    process, Buffer$1: Buffer, Buffer, createECDH, crypto: globalThis.crypto,
    getSodium: async () => sodium,
    hkdfSha256: async (key, info) => new Uint8Array(hkdfSync("sha256", key, Buffer.alloc(0), info, 32)),
    generateRandomBytes: (length) => new Uint8Array(randomBytes(length)),
    toBase64: (value) => Buffer.from(value).toString("base64"), fromBase64: (value) => new Uint8Array(Buffer.from(value, "base64")),
    TextEncoder, KEYCHAIN_IDS: { META: "test.install.meta", DK: "test.dk" }, DK_WRAP_INFO: "aside.wrap.dk.v1", NATIVE_INSTALL_METADATA: { scheme: "p256_v1" },
    installationMetadataSchema: { parse: (value) => { assert.equal(value.scheme, "p256_v1"); return value; } },
    wrappedDkP256Schema: { parse: (value) => { assert.equal(value.scheme, "p256_v1"); assert.equal(value.purpose, "dk"); return value; } },
    __belmontLinuxInstallation: adapter,
    runSecureStorageCommand: adapter.runSecureStorageCommand,
    dk: null,
  };
  vm.createContext(sandbox);
  return vm.runInContext(`${native}\n${source.slice(storageStart, storageEnd)}\n${wrappers}\n({initNativeInstallation,getNativeInstallationStatus,destroyNativeInstallation,unwrapNativeDk,wrapDkP256,unwrapDkP256})`, sandbox);
}

test("distinct persistent KEM preserves browser identity and native DER signatures", async (t) => {
  const { dir, adapter, identity, identityFile } = fixture(t);
  const before = readFileSync(identityFile);
  await adapter.withInstallationTransaction(() => adapter.runNativeKeyCommand("init-keys"));
  const keys = adapter.runNativeKeyCommand("public-keys");
  assert.equal(keys.sig, identity.publicRawBase64);
  assert.notEqual(keys.sig, keys.kem);
  const peer = createECDH("prime256v1"); peer.generateKeys();
  const secret = adapter.runNativeKeyCommand("ecdh-secret", { peerPublicKey: peer.getPublicKey().toString("base64") }).sharedSecret;
  assert.deepEqual(Buffer.from(secret, "base64"), peer.computeSecret(Buffer.from(keys.kem, "base64")));
  const challenge = randomBytes(41);
  const signature = Buffer.from(adapter.runNativeKeyCommand("cdp-sign", { challenge: challenge.toString("base64") }).signature, "base64");
  assert.equal(verify("sha256", challenge, createPublicKey(createPrivateKey({ key: identity.privateJwk, format: "jwk" })), signature), true);
  challenge[0] ^= 1;
  assert.equal(verify("sha256", challenge, createPublicKey(createPrivateKey({ key: identity.privateJwk, format: "jwk" })), signature), false);
  assert.deepEqual(createLinuxInstallation({ stateDir: dir }).runNativeKeyCommand("public-keys"), keys);
  await adapter.withInstallationTransaction(() => adapter.runNativeKeyCommand("destroy-keys"));
  assert.equal(adapter.runNativeKeyCommand("keys-status").keysInstalled, false);
  assert.deepEqual(readFileSync(identityFile), before);
  assert.equal(statSync(path.join(dir, "linux-installation.json")).mode & 0o777, 0o600);
});

test("secure items survive process restart, reject tamper/wrong identity, preserve corruption", async (t) => {
  const { dir, adapter, identityFile } = fixture(t);
  await adapter.runSecureStorageCommand("save", { key: "account/pmk", data: "secret fixture value" });
  const stateFile = path.join(dir, "linux-installation.json");
  const clean = readFileSync(stateFile, "utf8");
  assert.equal(clean.includes("secret fixture value"), false);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import {createLinuxInstallation} from ${JSON.stringify(path.join(ROOT, "src/linux-installation.mjs"))}; console.log(JSON.stringify(await createLinuxInstallation({stateDir:process.argv[1]}).runSecureStorageCommand("read",{key:"account/pmk"})))`, dir], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).data, "secret fixture value");
  const data = JSON.parse(clean); const id = createHash("sha256").update("account/pmk").digest("hex");
  const tag = Buffer.from(data.items[id].tag, "base64"); tag[0] ^= 1; data.items[id].tag = tag.toString("base64");
  writeFileSync(stateFile, JSON.stringify(data));
  await assert.rejects(adapter.runSecureStorageCommand("read", { key: "account/pmk" }));
  const corrupt = readFileSync(stateFile);
  await assert.rejects(adapter.runSecureStorageCommand("read", { key: "account/pmk" }));
  assert.deepEqual(readFileSync(stateFile), corrupt);
  writeFileSync(stateFile, clean);
  const savedIdentity = readFileSync(identityFile);
  const other = fixture(t);
  writeFileSync(identityFile, readFileSync(other.identityFile));
  await assert.rejects(createLinuxInstallation({ stateDir: dir }).runSecureStorageCommand("read", { key: "account/pmk" }), /different signing identity/);
  writeFileSync(identityFile, "{broken");
  assert.throws(() => createLinuxInstallation({ stateDir: dir }));
  assert.equal(readFileSync(identityFile, "utf8"), "{broken");
  writeFileSync(identityFile, savedIdentity);
});

test("whole transaction rolls back, serializes adapters, reenters and preserves every update", async (t) => {
  const { dir, adapter } = fixture(t);
  await assert.rejects(adapter.withInstallationTransaction(async () => {
    adapter.runNativeKeyCommand("init-keys");
    await adapter.runSecureStorageCommand("save", { key: "uncommitted", data: "value" });
    throw new Error("simulated interrupted init");
  }), /simulated interrupted init/);
  assert.equal(existsSync(path.join(dir, "linux-installation.json")), false);
  const adapters = Array.from({ length: 4 }, () => createLinuxInstallation({ stateDir: dir }));
  await Promise.all(Array.from({ length: 16 }, (_, i) => adapters[i % 4].withInstallationTransaction(async () => {
    adapters[i % 4].runNativeKeyCommand("init-keys");
    await new Promise((resolve) => setTimeout(resolve, i % 3));
    await adapters[i % 4].withInstallationTransaction(() => adapters[i % 4].runSecureStorageCommand("save", { key: `entry-${i}`, data: String(i) }));
  })));
  for (let i = 0; i < 16; i++) assert.equal((await adapter.runSecureStorageCommand("read", { key: `entry-${i}` })).data, String(i));
  assert.throws(() => adapter.runNativeKeyCommand("init-keys"), /requires an installation transaction/);
});

test("legacy storage remains readable and a clear cannot resurrect it", async (t) => {
  const { dir } = fixture(t);
  const legacy = path.join(dir, "legacy"); mkdirSync(legacy);
  writeFileSync(path.join(legacy, encodeURIComponent("account/key")), "old value");
  const adapter = createLinuxInstallation({ stateDir: dir, legacyStorageDir: legacy });
  assert.equal((await adapter.runSecureStorageCommand("read", { key: "account/key" })).data, "old value");
  await adapter.runSecureStorageCommand("clear", { key: "account/key" });
  assert.equal((await createLinuxInstallation({ stateDir: dir, legacyStorageDir: legacy }).runSecureStorageCommand("read", { key: "account/key" })).data, null);
  assert.equal(readFileSync(path.join(legacy, encodeURIComponent("account/key")), "utf8"), "old value");
});

test("patched original DK wraps and restores across restart, and concurrent init/status never resets it", async (t) => {
  const { source } = patchedBundle(t);
  const { dir, adapter, identityFile } = fixture(t);
  const runtime = installationRuntime(source, adapter);
  const signingBefore = readFileSync(identityFile);
  const initialized = await runtime.initNativeInstallation();
  const dk = await runtime.unwrapNativeDk();
  assert.equal(dk.length, 32);
  await Promise.all(Array.from({ length: 12 }, (_, i) => i % 2 ? runtime.initNativeInstallation() : runtime.getNativeInstallationStatus()));
  const restarted = installationRuntime(source, createLinuxInstallation({ stateDir: dir }));
  assert.deepEqual(Buffer.from(await restarted.unwrapNativeDk()), Buffer.from(dk));
  assert.equal((await restarted.initNativeInstallation()).kem, initialized.kem);
  assert.equal((await restarted.getNativeInstallationStatus()).installed, true);
  const other = fixture(t);
  const wrong = installationRuntime(source, other.adapter);
  await wrong.initNativeInstallation();
  const wrapped = await adapter.runSecureStorageCommand("read", { key: "test.dk" });
  await assert.rejects(wrong.unwrapDkP256(JSON.parse(wrapped.data)));
  await adapter.runSecureStorageCommand("clear", { key: "test.install.meta" });
  await assert.rejects(runtime.getNativeInstallationStatus(), /Incomplete Linux installation/);
  assert.deepEqual(readFileSync(identityFile), signingBefore);
  assert.equal(adapter.runNativeKeyCommand("public-keys").kem, initialized.kem);
  await assert.rejects(runtime.initNativeInstallation(), /Incomplete Linux installation/);
  assert.deepEqual(Buffer.from(await runtime.unwrapNativeDk()), Buffer.from(dk));
});

test("patch upgrade is idempotent, preserves unrelated edits and removes false Linux shortcuts", (t) => {
  const { file, source, original } = patchedBundle(t);
  assert.ok(!source.includes("kem:process.env.BELMONT_INSTALL_SIG_PUB"));
  assert.ok(!source.includes("dk=crypto.getRandomValues(new Uint8Array(32));return"));
  assert.ok(!source.includes("/*belmont-secure-storage-linux*/"));
  assert.ok(source.includes("loadPwmSessionFromKeychain(){init_session$2();return loadPwmSessionFromKeychain}"));
  assert.equal(source.split("export const __belmontServer=").length, 2);
  for (const marker of original.match(/\/\*belmont[^*]+\*\//g) ?? []) {
    if (marker !== "/*belmont-secure-storage-linux*/") assert.ok(source.includes(marker), `preserves ${marker}`);
  }
  const again = spawnSync("python3", [PATCH, file], { encoding: "utf8" });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(file, "utf8"), source);
  const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("mismatched private/public JWKs fail before signing or ECDH", async (t) => {
  const { dir, identity, identityFile, adapter } = fixture(t);
  const other = fixture(t);
  const corruptIdentity = { ...identity, privateJwk: { ...identity.privateJwk, d: other.identity.privateJwk.d } };
  writeFileSync(identityFile, JSON.stringify(corruptIdentity));
  assert.throws(() => createLinuxInstallation({ stateDir: dir }), /private\/public key mismatch/);
  writeFileSync(identityFile, JSON.stringify(identity));
  await adapter.withInstallationTransaction(() => adapter.runNativeKeyCommand("init-keys"));
  const file = path.join(dir, "linux-installation.json");
  const data = JSON.parse(readFileSync(file)); data.kemPrivateJwk.d = other.identity.privateJwk.d;
  writeFileSync(file, JSON.stringify(data));
  assert.throws(() => adapter.runNativeKeyCommand("public-keys"), /private\/public key mismatch/);
});

test("removed lock fails current transaction without hanging subsequent transactions", async (t) => {
  const { dir, adapter } = fixture(t);
  await assert.rejects(adapter.withInstallationTransaction(async () => {
    await adapter.runSecureStorageCommand("save", { key: "not-committed", data: "value" });
    rmSync(path.join(dir, "linux-installation.json.lock"));
  }));
  assert.equal(existsSync(path.join(dir, "linux-installation.json")), false);
  await adapter.runSecureStorageCommand("save", { key: "after", data: "value" });
  assert.equal((await adapter.runSecureStorageCommand("read", { key: "after" })).data, "value");
});

test("kernel transaction lock releases on SIGKILL and preserves last committed state", async (t) => {
  const { spawn } = await import("node:child_process");
  const { dir, adapter } = fixture(t);
  await adapter.runSecureStorageCommand("save", { key: "committed", data: "before crash" });
  const before = readFileSync(path.join(dir, "linux-installation.json"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {createLinuxInstallation} from ${JSON.stringify(path.join(ROOT, "src/linux-installation.mjs"))}; const a=createLinuxInstallation({stateDir:process.argv[1]});await a.withInstallationTransaction(async()=>{a.runNativeKeyCommand("init-keys");await a.runSecureStorageCommand("save",{key:"uncommitted",data:"aborted"});console.log("locked");await new Promise(()=>{setInterval(()=>{},1000)})});`, dir], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve); child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`child exited before lock: ${code}`)));
  });
  const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill("SIGKILL"); await exited;
  assert.deepEqual(readFileSync(path.join(dir, "linux-installation.json")), before);
  const restarted = createLinuxInstallation({ stateDir: dir, lockTimeoutMs: 500 });
  assert.equal((await restarted.runSecureStorageCommand("read", { key: "committed" })).data, "before crash");
  assert.equal((await restarted.runSecureStorageCommand("read", { key: "uncommitted" })).data, null);
  await restarted.runSecureStorageCommand("save", { key: "restarted", data: "after crash" });
});
