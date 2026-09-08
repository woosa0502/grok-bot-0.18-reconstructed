import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { encryptPushPayload, generateVapidKeys, sendWebPush, validatePushSubscription, vapidAuthorization } from "../web-push.mjs";

const decode = (value) => Buffer.from(value, "base64url");
// Published interoperable vector: https://www.rfc-editor.org/rfc/rfc8291.html#section-5
const receiver = { endpoint: "https://push.example.net/push/test", keys: { auth: "BTBZMqHH6r4Tts7J_aSIgg", p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4" } };
const receiverPrivate = decode("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94");

// Independent receiver uses OpenSSL HKDF directly, not the sender's HMAC helpers.
function receive(body, auth = decode(receiver.keys.auth)) {
  const salt = body.subarray(0, 16);
  assert.equal(body.readUInt32BE(16), 4096);
  const serverPublic = body.subarray(21, 21 + body[20]);
  const client = crypto.createECDH("prime256v1");
  client.setPrivateKey(receiverPrivate);
  const shared = client.computeSecret(serverPublic);
  const ikm = crypto.hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), client.getPublicKey(), serverPublic]), 32);
  const key = crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = crypto.createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(body.subarray(-16));
  const plain = Buffer.concat([decipher.update(body.subarray(21 + body[20], -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2);
  return plain.subarray(0, -1);
}

test("encryption matches the entire RFC 8291 section 5 known-answer body", () => {
  const body = encryptPushPayload(receiver, "When I grow up, I want to be a watermelon", { salt: decode("DGv6ra1nlYgDCS1FRnbzlw"), privateKey: decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw") });
  assert.equal(body.toString("base64url"), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  assert.equal(receive(body).toString(), "When I grow up, I want to be a watermelon");
});

test("independent receiver decodes random messages and rejects tampering or a different auth secret", () => {
  for (const size of [0, 1, 64, 1024, 3993]) {
    const message = crypto.randomBytes(size);
    const body = encryptPushPayload(receiver, message);
    assert.deepEqual(receive(body), message);
    assert.ok(body.length <= 4096);
    const tampered = Buffer.from(body);
    tampered[tampered.length - 1] ^= 1;
    assert.throws(() => receive(tampered));
    assert.throws(() => receive(body, crypto.randomBytes(16)));
  }
  assert.throws(() => encryptPushPayload(receiver, Buffer.alloc(3994)), { status: 400 });
});

test("VAPID signature verifies independently and scopes audience, expiry, and contact", () => {
  const keys = generateVapidKeys();
  const authorization = vapidAuthorization(receiver.endpoint, keys, "mailto:operator@example.net", 1_700_000_000_000);
  const [token, encodedPublic] = authorization.replace("vapid t=", "").split(", k=");
  const [header, claims, signature] = token.split(".");
  assert.deepEqual(JSON.parse(decode(header)), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(decode(claims)), { aud: "https://push.example.net", exp: 1_700_043_200, sub: "mailto:operator@example.net" });
  const point = decode(encodedPublic);
  const publicKey = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
  assert.equal(crypto.verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, decode(signature)), true);
  assert.equal(crypto.verify("sha256", Buffer.from(`${header}.${claims}x`), { key: publicKey, dsaEncoding: "ieee-p1363" }, decode(signature)), false);
});

test("standard sender emits decryptable aes128gcm plus VAPID and surfaces expired endpoints without any network", async () => {
  const keys = generateVapidKeys();
  const payload = { title: "테스트 Bot", body: "승인이 필요합니다.", kind: "needs-input" };
  let captured;
  await sendWebPush(receiver, payload, { keys, fetcher: async (url, request) => { captured = { url, request }; return { ok: true, status: 201 }; } });
  assert.equal(captured.url, receiver.endpoint);
  assert.equal(captured.request.headers["content-encoding"], "aes128gcm");
  assert.equal(captured.request.headers.urgency, "high");
  assert.match(captured.request.headers.authorization, /^vapid t=/u);
  assert.deepEqual(JSON.parse(receive(captured.request.body)), payload);
  await assert.rejects(sendWebPush(receiver, payload, { keys, fetcher: async () => ({ ok: false, status: 410 }) }), { statusCode: 410 });
});

test("invalid and expired subscription material is rejected before transport", () => {
  assert.equal(validatePushSubscription(receiver).endpoint, receiver.endpoint);
  for (const subscription of [{ ...receiver, endpoint: "http://push.example.net" }, { ...receiver, expirationTime: 1 }, { ...receiver, keys: { ...receiver.keys, auth: "AA" } }, { ...receiver, keys: { ...receiver.keys, p256dh: Buffer.alloc(65, 4).toString("base64url") } }]) assert.throws(() => validatePushSubscription(subscription), { status: 400 });
});
