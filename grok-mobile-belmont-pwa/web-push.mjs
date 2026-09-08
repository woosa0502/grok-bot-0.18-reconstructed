import crypto from "node:crypto";

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const expand = (key, info, length) => hmac(key, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);

export function validatePushSubscription(value, now = Date.now()) {
  let endpoint;
  try { endpoint = new URL(value?.endpoint); } catch { throw invalid("알림 구독 주소가 올바르지 않습니다."); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash || endpoint.href.length > 4096) throw invalid("알림 구독은 HTTPS 주소가 필요합니다.");
  if (!/^[A-Za-z0-9_-]+$/u.test(value?.keys?.p256dh ?? "") || !/^[A-Za-z0-9_-]+$/u.test(value?.keys?.auth ?? "")) throw invalid("알림 구독 키가 올바르지 않습니다.");
  const publicKey = Buffer.from(value.keys.p256dh, "base64url");
  const auth = Buffer.from(value.keys.auth, "base64url");
  if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16) throw invalid("알림 구독 키가 올바르지 않습니다.");
  try { crypto.ECDH.convertKey(publicKey, "prime256v1"); } catch { throw invalid("알림 구독 공개키가 올바르지 않습니다."); }
  if (value.expirationTime != null && (!Number.isFinite(value.expirationTime) || value.expirationTime <= now)) throw invalid("알림 구독이 만료되었습니다.");
  return { endpoint: endpoint.href, expirationTime: value.expirationTime ?? null, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

export function generateVapidKeys() {
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.privateKey.export({ format: "jwk" });
  return { publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url"), privateKey: jwk };
}

/** RFC 8291 + RFC 8188: a single aes128gcm record, random ephemeral ECDH key and salt. */
export function encryptPushPayload(subscription, payload, { salt = crypto.randomBytes(16), privateKey } = {}) {
  const plain = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (plain.length > 3993 || salt.length !== 16) throw invalid("알림 메시지가 너무 큽니다.");
  const ephemeral = crypto.createECDH("prime256v1");
  if (privateKey) ephemeral.setPrivateKey(privateKey); else ephemeral.generateKeys();
  const senderPublic = ephemeral.getPublicKey();
  const receiverPublic = Buffer.from(subscription.keys.p256dh, "base64url");
  const shared = ephemeral.computeSecret(receiverPublic);
  const auth = Buffer.from(subscription.keys.auth, "base64url");
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), receiverPublic, senderPublic]);
  const ikm = expand(hmac(auth, shared), keyInfo, 32);
  const prk = hmac(salt, ikm);
  const key = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(4096, 16);
  header[20] = senderPublic.length;
  return Buffer.concat([header, senderPublic, ciphertext]);
}

/** RFC 8292 VAPID token; JWT ES256 signatures use the 64-byte IEEE P1363 form. */
export function vapidAuthorization(endpoint, keys, subject, now = Date.now()) {
  const contact = new URL(subject);
  if (!["mailto:", "https:"].includes(contact.protocol)) throw invalid("VAPID 연락처는 HTTPS 또는 mailto 주소여야 합니다.");
  const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })).toString("base64url");
  const token = `${header}.${claims}`;
  const signature = crypto.sign("sha256", Buffer.from(token), { key: crypto.createPrivateKey({ key: keys.privateKey, format: "jwk" }), dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `vapid t=${token}.${signature}, k=${keys.publicKey}`;
}

export async function sendWebPush(subscription, payload, { keys, subject = "https://belmont.local", fetcher = fetch, now = Date.now } = {}) {
  const body = encryptPushPayload(subscription, JSON.stringify(payload));
  const result = await fetcher(subscription.endpoint, {
    method: "POST", body, redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { authorization: vapidAuthorization(subscription.endpoint, keys, subject, now()), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: payload.kind === "needs-input" ? "high" : "normal" },
  });
  if (!result.ok) throw Object.assign(new Error(`Push service returned ${result.status}`), { statusCode: result.status });
  return { statusCode: result.status };
}
