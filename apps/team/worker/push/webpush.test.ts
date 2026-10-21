// Web Push's encryption and signature (webpush.ts): pure, and easy to get subtly wrong, so unit tests (ADR 0031). The
// encryption is checked against RFC 8291's own worked example (Section 5), byte for byte.
import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { b64url, encrypt, fromB64url, pushService, vapidAuthorization, validKeys, VAPID_SUBJECT } from "./webpush";

// RFC 8291 Section 5, "Push Message Encryption Example"
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl" +
    "7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** A P-256 key pair from its public point and private `d`, as JWK. */
async function keyPair(publicKey: string, d: string, alg: "ECDH" | "ECDSA") {
  const point = fromB64url(publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: b64url(point.slice(1, 33)), y: b64url(point.slice(33)) };
  const params = { name: alg, namedCurve: "P-256" };
  const use = alg === "ECDH" ? ["deriveBits"] : ["sign"];
  return {
    privateKey: await crypto.subtle.importKey("jwk", { ...jwk, d }, params, true, use),
    publicKey: await crypto.subtle.importKey("jwk", jwk, params, true, alg === "ECDH" ? [] : ["verify"]),
  } as CryptoKeyPair;
}

describe("encrypting a push message (RFC 8291)", () => {
  it("makes RFC 8291's example message from its keys and salt, byte for byte", async () => {
    const body = await encrypt(
      fromB64url(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: fromB64url(RFC.salt), serverKeys: await keyPair(RFC.asPublic, RFC.asPrivate, "ECDH") },
    );
    expect(b64url(body)).toBe(RFC.message);
  });

  it("uses a new key and salt each time, so the same words never look the same twice", async () => {
    const to = { p256dh: RFC.uaPublic, auth: RFC.auth };
    const [a, b] = [await encrypt(new Uint8Array([1, 2, 3]), to), await encrypt(new Uint8Array([1, 2, 3]), to)];
    expect(b64url(a.slice(0, 16))).not.toBe(b64url(b.slice(0, 16)));
    expect(b64url(a.slice(21, 86))).not.toBe(b64url(b.slice(21, 86)));
    // salt, record size 4096, a 65-byte key id, then the words (3), the record's end (1) and the tag (16)
    expect(a.length).toBe(16 + 4 + 1 + 65 + 3 + 1 + 16);
    expect(a[20]).toBe(65);
  });
});

describe("signing for the push service (RFC 8292 VAPID)", () => {
  it("is an ES256 JWT for that push service's origin, good for 12 hours, with our public key beside it", async () => {
    // RFC 8291's application server key will do as a VAPID key: any P-256 pair
    const now = Date.UTC(2026, 9, 6, 11);
    const header = await vapidAuthorization(
      { publicKey: RFC.asPublic, privateKey: RFC.asPrivate },
      "https://fcm.googleapis.com",
      now,
    );
    const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(RFC.asPublic);
    const [head, claims, signature] = jwt.split(".");
    const json = (s: string) => JSON.parse(new TextDecoder().decode(fromB64url(s)));
    expect(json(head)).toEqual({ typ: "JWT", alg: "ES256" });
    expect(json(claims)).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: now / 1000 + 12 * 3600,
      sub: VAPID_SUBJECT,
    });
    // The signature is r ‖ s (64 bytes) and checks out with the public key
    expect(fromB64url(signature)).toHaveLength(64);
    const point = fromB64url(RFC.asPublic);
    const publicKey = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: b64url(point.slice(1, 33)), y: b64url(point.slice(33)) },
      format: "jwk",
    });
    const ok = verify(
      "sha256",
      new TextEncoder().encode(`${head}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      fromB64url(signature),
    );
    expect(ok).toBe(true);
  });
});

describe("where a subscription may point", () => {
  it("takes the browsers' push services, https only", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGuQyavXu",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
    ])
      expect(pushService(endpoint)?.href).toBe(endpoint);
  });

  it("refuses anywhere else: our own Worker, a lookalike, plain http, a port, a user", () => {
    for (const endpoint of [
      "https://team.batterseacougars.com/api/members",
      "https://fcm.googleapis.com.evil.example/send",
      "https://evilfcm.googleapis.com/send",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://me@web.push.apple.com/x",
      "https://169.254.169.254/latest/meta-data",
      "not a url",
    ])
      expect(pushService(endpoint)).toBeNull();
  });

  it("wants a P-256 point and a 16-byte secret", () => {
    expect(validKeys({ p256dh: RFC.uaPublic, auth: RFC.auth })).toBe(true);
    expect(validKeys({ p256dh: RFC.auth, auth: RFC.auth })).toBe(false);
    expect(validKeys({ p256dh: RFC.uaPublic, auth: RFC.salt + "AA" })).toBe(false);
    expect(validKeys({ p256dh: RFC.uaPublic })).toBe(false);
    expect(validKeys("keys")).toBe(false);
  });
});

describe("in the tests' WebCrypto (testing/crypto.ts)", () => {
  it("is all worked out at once, never on the thread pool, so a concurrency seed is one order of events", async () => {
    // Microtasks only: the thread pool's answers need a turn of the event loop, which never comes here
    const atOnce = async (p: Promise<unknown>) => {
      let done = false;
      void p.then(() => (done = true));
      for (let i = 0; i < 500 && !done; i++) await Promise.resolve();
      return done;
    };
    expect(await atOnce(encrypt(new Uint8Array([1, 2, 3]), { p256dh: RFC.uaPublic, auth: RFC.auth }))).toBe(true);
    const vapid = { publicKey: RFC.asPublic, privateKey: RFC.asPrivate };
    expect(await atOnce(vapidAuthorization(vapid, "https://web.push.apple.com", 0))).toBe(true);
    // And the real thing isn't: the check can tell
    const real = SubtleCrypto.prototype.digest.call(crypto.subtle, "SHA-256", new Uint8Array(1));
    expect(await atOnce(real)).toBe(false);
  });
});
