// WebCrypto that answers at once, for tests (testing/setup.ts). Node's crypto.subtle does its work on a thread pool
// and resolves when the pool is done, so how many turns of the event loop a hash or a signature takes depends on how
// busy the machine is. Beside the fake D1's interleaving (`interleave(seed)`, which counts turns), that made one seed
// a different order of events from run to run: a race found once couldn't be replayed, and a busy machine explored
// orders a quiet one never did (ADR 0121). Here the hashes (session tokens, codes), the RS256 signatures (Google's
// and GitHub's tokens) and Web Push's work (ECDH P-256, HKDF, AES-GCM, ES256: worker/push/webpush.ts) are worked out
// on the spot, the same bytes as WebCrypto's, and the promise is already settled, so a seed is one order of events.
// Anything else goes to the real thing.
import {
  createCipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  createSecretKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  sign,
  type KeyObject,
} from "node:crypto";

const HASHES: Record<string, string> = {
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
};
type Alg = AlgorithmIdentifier | { name: string; hash?: AlgorithmIdentifier; [k: string]: unknown };
const hashOf = (alg: Alg | undefined) => {
  if (!alg) return undefined;
  const name = typeof alg === "string" ? alg : "name" in alg ? alg.name : undefined;
  return name ? HASHES[name.toUpperCase()] : undefined;
};
const nameOf = (alg: Alg) => (typeof alg === "string" ? alg : alg.name).toUpperCase();
const curveOf = (alg: Alg) => (typeof alg === "string" ? undefined : (alg as { namedCurve?: string }).namedCurve);
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
const b64url = (b: Buffer) => b.toString("base64url");
/** An uncompressed P-256 point (0x04 ‖ x ‖ y) as a public key. */
const pointKey = (point: Buffer) =>
  createPublicKey({
    key: { kty: "EC", crv: "P-256", x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)) },
    format: "jwk",
  });
const SECRETS = ["HKDF", "AES-GCM", "HMAC"];
const CURVES = ["ECDH", "ECDSA"];

export function settledCrypto(subtle: SubtleCrypto = crypto.subtle) {
  const real = {
    digest: subtle.digest,
    importKey: subtle.importKey,
    sign: subtle.sign,
    generateKey: subtle.generateKey,
    exportKey: subtle.exportKey,
    deriveBits: subtle.deriveBits,
    encrypt: subtle.encrypt,
  };
  // The key each CryptoKey made here was made from, to work with (KeyObject.from won't take a non-extractable one)
  const keys = new WeakMap<CryptoKey, KeyObject>();
  const own = (name: string, value: unknown) => Object.defineProperty(subtle, name, { value, configurable: true });
  const asCryptoKey = (keyObject: KeyObject, alg: Alg, extractable: boolean, usages: Iterable<KeyUsage>) => {
    // Node's own CryptoKey and KeyUsage types differ from the DOM's the apps check against: the same objects
    const cryptoKey = keyObject.toCryptoKey(alg as RsaHashedImportParams, extractable, [
      ...usages,
    ] as KeyUsage[]) as unknown as CryptoKey;
    keys.set(cryptoKey, keyObject);
    return cryptoKey;
  };
  const passOn = <K extends keyof typeof real>(name: K, args: unknown[]) =>
    (real[name] as (...a: unknown[]) => Promise<unknown>).apply(subtle, args);

  own("digest", function (alg: AlgorithmIdentifier, data: BufferSource) {
    const hash = hashOf(alg);
    if (!hash) return real.digest.call(subtle, alg, data);
    return now(() => arrayBuffer(createHash(hash).update(bytes(data)).digest()));
  });

  own("importKey", function (...args: Parameters<SubtleCrypto["importKey"]>) {
    const [format, key, alg, extractable, usages] = args;
    const name = nameOf(alg as Alg);
    const curve = CURVES.includes(name) && curveOf(alg as Alg) === "P-256";
    let make: (() => KeyObject) | null = null;
    if (format === "pkcs8" && name === "RSASSA-PKCS1-V1_5")
      make = () => createPrivateKey({ key: bytes(key as BufferSource), format: "der", type: "pkcs8" });
    else if (format === "raw" && SECRETS.includes(name)) make = () => createSecretKey(bytes(key as BufferSource));
    else if (format === "raw" && curve) make = () => pointKey(bytes(key as BufferSource));
    // (format as string): the DOM's typings split jwk into its own overload, which Parameters<> doesn't see
    else if ((format as string) === "jwk" && curve) {
      // The DOM's JsonWebKey and Node's are the same object, typed apart
      const jwk = key as unknown as import("node:crypto").JsonWebKey;
      make = () =>
        jwk.d ? createPrivateKey({ key: jwk, format: "jwk" }) : createPublicKey({ key: jwk, format: "jwk" });
    }
    if (!make) return passOn("importKey", args);
    return now(() => asCryptoKey(make(), alg as Alg, extractable, usages));
  });

  own("generateKey", function (...args: Parameters<SubtleCrypto["generateKey"]>) {
    const [alg, extractable, usages] = args;
    const name = nameOf(alg as Alg);
    if (!CURVES.includes(name) || curveOf(alg as Alg) !== "P-256") return passOn("generateKey", args);
    return now(() => {
      const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const all = [...usages];
      const publicUses = all.filter((u) => u === "verify");
      return {
        privateKey: asCryptoKey(
          pair.privateKey,
          alg as Alg,
          extractable,
          all.filter((u) => u !== "verify"),
        ),
        // A public key can always be read back, as WebCrypto has it
        publicKey: asCryptoKey(pair.publicKey, alg as Alg, true, publicUses),
      };
    });
  });

  own("exportKey", function (format: KeyFormat, key: CryptoKey) {
    const keyObject = keys.get(key);
    if (format !== "raw" || keyObject?.type !== "public" || !CURVES.includes(key.algorithm.name.toUpperCase()))
      return passOn("exportKey", [format, key]);
    return now(() => {
      const { x, y } = keyObject.export({ format: "jwk" });
      return arrayBuffer(Buffer.concat([Buffer.from([4]), Buffer.from(x!, "base64url"), Buffer.from(y!, "base64url")]));
    });
  });

  own("deriveBits", function (alg: Alg & { public?: CryptoKey }, key: CryptoKey, length: number) {
    const name = nameOf(alg);
    const keyObject = keys.get(key);
    const theirs = alg.public && keys.get(alg.public);
    if (name === "ECDH" && keyObject && theirs)
      return now(() =>
        arrayBuffer(diffieHellman({ privateKey: keyObject, publicKey: theirs }).subarray(0, length / 8)),
      );
    const hash = hashOf((alg as { hash?: Alg }).hash);
    if (name === "HKDF" && keyObject && hash) {
      const { salt, info } = alg as unknown as { salt: BufferSource; info: BufferSource };
      return now(() =>
        Buffer.from(hkdfSync(hash, keyObject.export(), bytes(salt), bytes(info), length / 8)).buffer.slice(0),
      );
    }
    return passOn("deriveBits", [alg, key, length]);
  });

  own(
    "encrypt",
    function (alg: Alg & { iv?: BufferSource; additionalData?: BufferSource }, key: CryptoKey, data: BufferSource) {
      const keyObject = keys.get(key);
      const tagLength = (alg as { tagLength?: number }).tagLength ?? 128;
      if (nameOf(alg) !== "AES-GCM" || !keyObject || !alg.iv || tagLength !== 128)
        return passOn("encrypt", [alg, key, data]);
      return now(() => {
        const secret = keyObject.export();
        const cipher = createCipheriv(`aes-${secret.length * 8}-gcm` as "aes-128-gcm", secret, bytes(alg.iv!));
        if (alg.additionalData) cipher.setAAD(bytes(alg.additionalData));
        return arrayBuffer(Buffer.concat([cipher.update(bytes(data)), cipher.final(), cipher.getAuthTag()]));
      });
    },
  );

  own("sign", function (alg: Alg, key: CryptoKey, data: BufferSource) {
    const keyObject = keys.get(key);
    const name = nameOf(alg);
    if (name === "ECDSA" && keyObject) {
      const hash = hashOf((alg as { hash?: AlgorithmIdentifier }).hash);
      if (hash) return now(() => arrayBuffer(sign(hash, bytes(data), { key: keyObject, dsaEncoding: "ieee-p1363" })));
    }
    const hash = hashOf((key.algorithm as RsaHashedKeyAlgorithm).hash ?? "");
    if (name !== "RSASSA-PKCS1-V1_5" || !hash || !keyObject) return real.sign.call(subtle, alg, key, data);
    return now(() => arrayBuffer(sign(hash, bytes(data), keyObject)));
  });
}
