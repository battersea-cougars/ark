// The tests' WebCrypto (testing/crypto.ts, on in every test file): the same bytes as the real thing, already answered.
import { describe, expect, it } from "vitest";

/** The real thing: the tests' own answers are on crypto.subtle itself, WebCrypto's on its prototype. */
const proto = SubtleCrypto.prototype;
const real = {
  digest: (...a: Parameters<SubtleCrypto["digest"]>) => proto.digest.apply(crypto.subtle, a),
  sign: (...a: Parameters<SubtleCrypto["sign"]>) => proto.sign.apply(crypto.subtle, a),
  verify: (...a: Parameters<SubtleCrypto["verify"]>) => proto.verify.apply(crypto.subtle, a),
  generateKey: (alg: RsaHashedKeyGenParams) =>
    proto.generateKey.call(crypto.subtle, alg, true, ["sign", "verify"]) as Promise<CryptoKeyPair>,
  exportKey: (key: CryptoKey) => proto.exportKey.call(crypto.subtle, "pkcs8", key) as Promise<ArrayBuffer>,
  importKey: (pkcs8: ArrayBuffer, alg: RsaHashedImportParams) =>
    proto.importKey.call(crypto.subtle, "pkcs8", pkcs8, alg, false, ["sign"]),
};
const data = new TextEncoder().encode("a session token");
/** Settled already: it has answered by the next microtask, whatever the thread pool is doing. */
async function settles(p: Promise<unknown>) {
  let done = false;
  void p.then(() => (done = true));
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe("WebCrypto in tests", () => {
  it("hashes as WebCrypto does, at once", async () => {
    const hash = crypto.subtle.digest("SHA-256", data);
    expect(await settles(hash)).toBe(true);
    expect(new Uint8Array(await hash)).toEqual(new Uint8Array(await real.digest("SHA-256", data)));
  });

  it("signs RS256 as WebCrypto does, at once, with an imported key that can't be read back", async () => {
    const pair = await real.generateKey({
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    });
    const pkcs8 = await real.exportKey(pair.privateKey);
    const alg = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const imported = crypto.subtle.importKey("pkcs8", pkcs8, alg, false, ["sign"]);
    expect(await settles(imported)).toBe(true);
    const signature = crypto.subtle.sign("RSASSA-PKCS1-v1_5", await imported, data);
    expect(await settles(signature)).toBe(true);
    expect(await real.verify("RSASSA-PKCS1-v1_5", pair.publicKey, await signature, data)).toBe(true);
    const theirs = await real.sign("RSASSA-PKCS1-v1_5", await real.importKey(pkcs8, alg), data);
    expect(new Uint8Array(await signature)).toEqual(new Uint8Array(theirs));
  });

  it("does Web Push's work as WebCrypto does, at once: ECDH, HKDF, AES-GCM and ES256 (worker/push/webpush.ts)", async () => {
    const ec = { name: "ECDH", namedCurve: "P-256" };
    // Ours, and one made by the real thing: the same secret either way round
    const ours = crypto.subtle.generateKey(ec, true, ["deriveBits"]) as Promise<CryptoKeyPair>;
    expect(await settles(ours)).toBe(true);
    const theirs = (await proto.generateKey.call(crypto.subtle, ec, true, ["deriveBits"])) as CryptoKeyPair;
    const ourPoint = crypto.subtle.exportKey("raw", (await ours).publicKey);
    expect(await settles(ourPoint)).toBe(true);
    expect(new Uint8Array((await ourPoint) as ArrayBuffer)).toHaveLength(65);
    const theirPoint = (await proto.exportKey.call(crypto.subtle, "raw", theirs.publicKey)) as ArrayBuffer;
    const theirPublic = crypto.subtle.importKey("raw", theirPoint, ec, false, []);
    expect(await settles(theirPublic)).toBe(true);
    const secret = crypto.subtle.deriveBits({ name: "ECDH", public: await theirPublic }, (await ours).privateKey, 256);
    expect(await settles(secret)).toBe(true);
    const ourPublicForThem = await proto.importKey.call(crypto.subtle, "raw", await ourPoint, ec, false, []);
    const same = await proto.deriveBits.call(
      crypto.subtle,
      { name: "ECDH", public: ourPublicForThem },
      theirs.privateKey,
      256,
    );
    expect(new Uint8Array(await secret)).toEqual(new Uint8Array(same));

    // HKDF, the same bits
    const hkdf = { name: "HKDF", hash: "SHA-256", salt: data, info: data };
    const ikm = crypto.subtle.importKey("raw", await secret, "HKDF", false, ["deriveBits"]);
    expect(await settles(ikm)).toBe(true);
    const bits = crypto.subtle.deriveBits(hkdf, await ikm, 128);
    expect(await settles(bits)).toBe(true);
    const realIkm = await proto.importKey.call(crypto.subtle, "raw", await secret, "HKDF", false, ["deriveBits"]);
    expect(new Uint8Array(await bits)).toEqual(
      new Uint8Array(await proto.deriveBits.call(crypto.subtle, hkdf, realIkm, 128)),
    );

    // AES-128-GCM, the same ciphertext and tag
    const gcm = { name: "AES-GCM", iv: new Uint8Array(12) };
    const key = crypto.subtle.importKey("raw", await bits, "AES-GCM", false, ["encrypt"]);
    expect(await settles(key)).toBe(true);
    const sealed = crypto.subtle.encrypt(gcm, await key, data);
    expect(await settles(sealed)).toBe(true);
    const realKey = await proto.importKey.call(crypto.subtle, "raw", await bits, "AES-GCM", false, ["encrypt"]);
    expect(new Uint8Array(await sealed)).toEqual(
      new Uint8Array(await proto.encrypt.call(crypto.subtle, gcm, realKey, data)),
    );

    // ES256 from a JWK: r ‖ s, which the real thing verifies
    const es = { name: "ECDSA", namedCurve: "P-256" };
    const pair = (await proto.generateKey.call(crypto.subtle, es, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await proto.exportKey.call(crypto.subtle, "jwk", pair.privateKey)) as JsonWebKey;
    const signer = crypto.subtle.importKey("jwk", jwk, es, false, ["sign"]);
    expect(await settles(signer)).toBe(true);
    const signature = crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signer, data);
    expect(await settles(signature)).toBe(true);
    expect(new Uint8Array(await signature)).toHaveLength(64);
    expect(await real.verify({ name: "ECDSA", hash: "SHA-256" } as never, pair.publicKey, await signature, data)).toBe(
      true,
    );
  });
});
