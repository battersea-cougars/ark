// A phone's passkeys, faked for the fake world (ADR 0023, ADR 0031): an authenticator that answers the browser's
// navigator.credentials.create() and .get() the way a real one does, with real keys and real signatures (P-256 for
// ES256, RSA for RS256), worked out here with node:crypto apart from the Worker's library, so a test signs in with
// the same bytes an iPhone or Windows Hello would send. It's given the options the Worker sent (their JSON) and the
// page's origin, and gives back the response JSON the app posts. A test can make it misbehave: say another origin,
// skip the face check, sign another challenge, or be a copy whose counter has fallen behind.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

// ─── CBOR, as much of it as an authenticator writes (RFC 8949): integers, bytes, text, maps ───

type Cbor = number | string | Uint8Array | Map<number | string, Cbor> | { [k: string]: Cbor };
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}
export function cbor(v: Cbor): Buffer {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  const entries = v instanceof Map ? [...v] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

/** The flags byte (WebAuthn §6.1): user present, user verified, backup eligible and backed up, attested data. */
const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;

export interface Passkey {
  id: Buffer;
  rpId: string;
  userHandle: string;
  key: KeyObject;
  alg: "ES256" | "RS256";
  counter: number;
}

export interface Misbehave {
  /** The page's origin as the browser reports it: another site's, say. */
  origin?: string;
  /** No face, no fingerprint, no PIN: only a tap. */
  noVerification?: boolean;
  /** Signs this challenge instead of the one it was given (base64url). */
  challenge?: string;
  /** Uses this passkey, not the first it holds for the site. */
  passkey?: Passkey;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/**
 * A device's authenticator. ES256 (an iPhone, Android, a Mac) or RS256 (Windows Hello). `synced`: a passkey kept in
 * iCloud Keychain or Google Password Manager, backed up, whose counter always says 0; otherwise the counter goes up
 * with each use, as a security key's does.
 */
export function authenticator({ alg = "ES256", synced = true }: { alg?: "ES256" | "RS256"; synced?: boolean } = {}) {
  const passkeys: Passkey[] = [];
  const aaguid = synced ? Buffer.from("fbfc3007154e4ecc8c0b6e020557d7bd", "hex") : Buffer.alloc(16);

  function coseKey(key: KeyObject): Buffer {
    const jwk = key.export({ format: "jwk" });
    if (alg === "ES256")
      return cbor(
        new Map<number, Cbor>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x!, "base64url")],
          [-3, Buffer.from(jwk.y!, "base64url")],
        ]),
      );
    return cbor(
      new Map<number, Cbor>([
        [1, 3],
        [3, -257],
        [-1, Buffer.from(jwk.n!, "base64url")],
        [-2, Buffer.from(jwk.e!, "base64url")],
      ]),
    );
  }

  const flags = (m: Misbehave) => UP | (m.noVerification ? 0 : UV) | (synced ? BE | BS : 0);
  const clientData = (type: string, challenge: string, m: Misbehave, origin: string) =>
    Buffer.from(
      JSON.stringify({ type, challenge: m.challenge ?? challenge, origin: m.origin ?? origin, crossOrigin: false }),
    );

  return {
    passkeys,
    /** navigator.credentials.create(): a new passkey for this site and member, unless it holds one of theirs already. */
    create(options: Json, origin: string, m: Misbehave = {}): Json {
      const rpId: string = options.rp?.id ?? new URL(origin).hostname;
      const algs = (options.pubKeyCredParams as { alg: number }[]).map((p) => p.alg);
      if (!algs.includes(alg === "ES256" ? -7 : -257)) throw new Error(`the site won't take ${alg}`);
      const excluded = new Set((options.excludeCredentials ?? []).map((c: { id: string }) => c.id));
      if (passkeys.some((p) => excluded.has(b64url(p.id)))) throw new Error("InvalidStateError: already registered");
      if (options.authenticatorSelection?.residentKey !== "required") throw new Error("a passkey must be discoverable");
      const { privateKey } =
        alg === "ES256"
          ? generateKeyPairSync("ec", { namedCurve: "P-256" })
          : generateKeyPairSync("rsa", { modulusLength: 2048 });
      const passkey: Passkey = {
        id: randomBytes(32),
        rpId,
        userHandle: options.user.id,
        key: privateKey,
        alg,
        counter: 0,
      };
      const publicKey = coseKey(privateKey);
      const authData = Buffer.concat([
        sha256(rpId),
        Buffer.from([flags(m) | AT]),
        u32(passkey.counter),
        aaguid,
        Buffer.from([passkey.id.length >> 8, passkey.id.length & 0xff]),
        passkey.id,
        publicKey,
      ]);
      passkeys.push(passkey);
      return {
        id: b64url(passkey.id),
        rawId: b64url(passkey.id),
        type: "public-key",
        response: {
          clientDataJSON: b64url(clientData("webauthn.create", options.challenge, m, origin)),
          attestationObject: b64url(cbor({ fmt: "none", attStmt: {}, authData })),
          transports: ["internal", "hybrid"],
        },
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
      };
    },
    /** navigator.credentials.get(): sign the challenge with one of this site's passkeys, after the face check. */
    get(options: Json, origin: string, m: Misbehave = {}): Json {
      const rpId: string = options.rpId ?? new URL(origin).hostname;
      const allowed = new Set((options.allowCredentials ?? []).map((c: { id: string }) => c.id));
      const passkey =
        m.passkey ?? passkeys.find((p) => p.rpId === rpId && (!allowed.size || allowed.has(b64url(p.id))));
      if (!passkey) throw new Error("NotAllowedError: no passkey for this site");
      if (!synced) passkey.counter++;
      const authData = Buffer.concat([sha256(rpId), Buffer.from([flags(m)]), u32(passkey.counter)]);
      const data = clientData("webauthn.get", options.challenge, m, origin);
      // ES256's signature is DER, as WebAuthn has it (not WebCrypto's raw r‖s); RS256's is PKCS #1 v1.5
      const signature = sign("sha256", Buffer.concat([authData, sha256(data)]), passkey.key);
      return {
        id: b64url(passkey.id),
        rawId: b64url(passkey.id),
        type: "public-key",
        response: {
          clientDataJSON: b64url(data),
          authenticatorData: b64url(authData),
          signature: b64url(signature),
          userHandle: passkey.userHandle,
        },
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
      };
    },
    /** Another device holding copies of these passkeys, at their counters now: a clone. */
    copy() {
      return passkeys.map((p) => ({ ...p }));
    },
  };
}
