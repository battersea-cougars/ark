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
});
