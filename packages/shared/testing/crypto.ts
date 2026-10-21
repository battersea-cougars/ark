// WebCrypto that answers at once, for tests (testing/setup.ts). Node's crypto.subtle does its work on a thread pool
// and resolves when the pool is done, so how many turns of the event loop a hash or a signature takes depends on how
// busy the machine is. Beside the fake D1's interleaving (`interleave(seed)`, which counts turns), that made one seed
// a different order of events from run to run: a race found once couldn't be replayed, and a busy machine explored
// orders a quiet one never did (ADR 0121). Here the hashes (session tokens, codes) and the RS256 signatures (Google's
// and GitHub's tokens) are worked out on the spot, the same bytes as WebCrypto's, and the promise is already
// settled, so a seed is one order of events. Anything else goes to the real thing.
import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto";

const HASHES: Record<string, string> = {
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
};
const hashOf = (alg: AlgorithmIdentifier | { hash?: AlgorithmIdentifier }) => {
  const name = typeof alg === "string" ? alg : "name" in alg ? alg.name : undefined;
  return name ? HASHES[name.toUpperCase()] : undefined;
};
const nameOf = (alg: AlgorithmIdentifier) => (typeof alg === "string" ? alg : alg.name).toUpperCase();
const bytes = (data: BufferSource) =>
  ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(data);
const arrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
/** Done now: its answer, or its error, as an already-settled promise. */
const now = <T>(work: () => T): Promise<T> => {
  try {
    return Promise.resolve(work());
  } catch (e) {
    return Promise.reject(e);
  }
};

export function settledCrypto(subtle: SubtleCrypto = crypto.subtle) {
  const real = { digest: subtle.digest, importKey: subtle.importKey, sign: subtle.sign };
  // The key each imported CryptoKey was made from, to sign with (KeyObject.from won't take a non-extractable one)
  const keys = new WeakMap<CryptoKey, KeyObject>();
  const own = (name: string, value: unknown) => Object.defineProperty(subtle, name, { value, configurable: true });

  own("digest", function (alg: AlgorithmIdentifier, data: BufferSource) {
    const hash = hashOf(alg);
    if (!hash) return real.digest.call(subtle, alg, data);
    return now(() => arrayBuffer(createHash(hash).update(bytes(data)).digest()));
  });
  own("importKey", function (...args: Parameters<SubtleCrypto["importKey"]>) {
    const [format, key, alg, extractable, usages] = args;
    if (format !== "pkcs8" || nameOf(alg as AlgorithmIdentifier) !== "RSASSA-PKCS1-V1_5")
      return (real.importKey as (...a: unknown[]) => Promise<CryptoKey>).apply(subtle, args);
    return now(() => {
      const keyObject = createPrivateKey({ key: bytes(key as BufferSource), format: "der", type: "pkcs8" });
      const cryptoKey = keyObject.toCryptoKey(alg as RsaHashedImportParams, extractable, usages);
      keys.set(cryptoKey, keyObject);
      return cryptoKey;
    });
  });
  own("sign", function (alg: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) {
    const hash = hashOf((key.algorithm as RsaHashedKeyAlgorithm).hash ?? "");
    const keyObject = keys.get(key);
    if (nameOf(alg) !== "RSASSA-PKCS1-V1_5" || !hash || !keyObject) return real.sign.call(subtle, alg, key, data);
    return now(() => arrayBuffer(sign(hash, bytes(data), keyObject)));
  });
}
