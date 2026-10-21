// Web Push (ADR 0108, #24): notifications to a browser (Android's Chrome or Firefox, a desktop, an iPhone with the app
// on its Home Screen), free through each browser's own push service. The payload is encrypted for that browser alone
// (RFC 8291, aes128gcm: ECDH P-256, HKDF, AES-128-GCM) and the request carries our VAPID key's signature (RFC 8292, an
// ES256 JWT), all WebCrypto: the Node `web-push` package doesn't run on Workers. One request per browser, like fcm.ts.
import type { Message, Result } from "./fcm";

/** A browser's subscription keys, as PushSubscription.toJSON() gives them (base64url). */
export interface WebKeys {
  /** The browser's ECDH P-256 public key, uncompressed (65 bytes). */
  p256dh: string;
  /** Its 16-byte authentication secret. */
  auth: string;
}

/** A notification for a browser: `token` is the subscription's endpoint, the push service's address for it. */
export interface WebMessage extends Message {
  keys: WebKeys;
}

/** The club's VAPID key pair (base64url): the public key uncompressed (VAPID_PUBLIC_KEY), the private its `d`. */
export interface Vapid {
  publicKey: string;
  privateKey: string;
}

/**
 * Who's sending, for a push service that has to get in touch (RFC 8292 `sub`): the club's website. Apple refuses a
 * JWT without one.
 */
export const VAPID_SUBJECT = "https://batterseacougars.com";

/**
 * The push services browsers use: Chrome's and Edge-on-Android's (Google), Firefox's (Mozilla), Safari's (Apple), and
 * Edge's on Windows. A subscription anywhere else is refused, so nobody can make the Worker fetch an address of
 * their choosing (SSRF).
 */
const PUSH_SERVICES = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

/** The endpoint, if it's https on a known push service (no port, no user); else null. */
export function pushService(endpoint: string): URL | null {
  if (!URL.canParse(endpoint)) return null;
  const url = new URL(endpoint);
  const plain = url.protocol === "https:" && !url.port && !url.username && !url.password;
  return plain && PUSH_SERVICES.some((p) => p.test(url.hostname)) ? url : null;
}

export const b64url = (data: Uint8Array | string) =>
  btoa(String.fromCharCode(...(typeof data === "string" ? new TextEncoder().encode(data) : data)))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

export function fromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** The keys as they must be: a P-256 point (65 bytes, 0x04 first) and a 16-byte secret. */
export function validKeys(keys: unknown): keys is WebKeys {
  if (!keys || typeof keys !== "object") return false;
  const { p256dh, auth } = keys as Record<string, unknown>;
  const b64 = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]+=*$/.test(v) && v.length < 200;
  if (!b64(p256dh) || !b64(auth)) return false;
  const point = fromB64url(p256dh.replace(/=+$/, ""));
  return point.length === 65 && point[0] === 4 && fromB64url(auth.replace(/=+$/, "")).length === 16;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
};

/** HKDF-SHA-256, extract then expand, `length` bytes. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** The record size we declare: the whole message fits one record (a push service takes 4096 bytes at most). */
const RECORD_SIZE = 4096;

/**
 * The body of a push message: `plaintext` sealed for this browser alone (RFC 8291 §3, RFC 8188 aes128gcm), one record,
 * with a new key pair and salt each time. `fixed` sets them, for RFC 8291's own example (the tests).
 */
export async function encrypt(
  plaintext: Uint8Array,
  to: WebKeys,
  fixed?: { salt: Uint8Array; serverKeys: CryptoKeyPair },
): Promise<Uint8Array> {
  const uaPublic = fromB64url(to.p256dh);
  const authSecret = fromB64url(to.auth);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const server =
    fixed?.serverKeys ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", server.publicKey)) as ArrayBuffer);
  const ua = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: ua }, server.privateKey, 256),
  );
  // The browser's secret mixed in (RFC 8291 §3.3), then the content key and nonce (RFC 8188 §2.2, 2.3)
  const ikm = await hkdf(authSecret, ecdhSecret, concat(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // The last (and only) record ends in 0x02, with no padding
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, new Uint8Array([2]))),
  );
  // The header (RFC 8188 §2.1): salt, record size, and our public key as the key id
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

/** How long a JWT is good for: a push service takes up to 24 hours. */
const JWT_HOURS = 12;

/** The Authorization header for one push service (RFC 8292 §3): `vapid t=<ES256 JWT>, k=<public key>`. */
export async function vapidAuthorization(vapid: Vapid, audience: string, now: number): Promise<string> {
  const point = fromB64url(vapid.publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64url(point.slice(1, 33)),
    y: b64url(point.slice(33, 65)),
    d: vapid.privateKey,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const claims = { aud: audience, exp: Math.floor(now / 1000) + JWT_HOURS * 3600, sub: VAPID_SUBJECT };
  const unsigned = `${b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }))}.${b64url(JSON.stringify(claims))}`;
  // WebCrypto's ECDSA signature is r ‖ s, as JWS wants it
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(unsigned));
  return `vapid t=${unsigned}.${b64url(new Uint8Array(signature))}, k=${vapid.publicKey}`;
}

/** What the service worker (public/sw.js) shows: a notice's words, where tapping goes, and a tag, so the same notice
 * sent again replaces itself rather than showing twice. */
export const payloadOf = (m: Message) =>
  JSON.stringify({ title: m.title, body: m.body, path: m.path, tag: `${m.path} ${m.title}` });

/** A day: a notification that couldn't reach a browser in that time is old news. */
const TTL_SECONDS = 24 * 3600;

/**
 * Send each message (one request each), what became of each in the same order: 2xx sent; 404 or 410 gone (the browser
 * unsubscribed, or the subscription expired: forget it); anything else failed, with the push service's status for the
 * log. Each is one subrequest, like fcm.ts, so callers send at most SEND_AT_ONCE (push.ts). One JWT per push service.
 */
export async function sendAll(vapid: Vapid, messages: WebMessage[], now = Date.now()): Promise<Result[]> {
  const jwts = new Map<string, Promise<string>>();
  const authFor = (origin: string) => {
    if (!jwts.has(origin)) jwts.set(origin, vapidAuthorization(vapid, origin, now));
    return jwts.get(origin)!;
  };
  return Promise.all(
    messages.map(async (m): Promise<Result> => {
      const service = pushService(m.token);
      // Refused when it subscribed; never fetched, whatever is in the table
      if (!service) return { outcome: "gone", reason: "not a push service" };
      try {
        const res = await fetch(m.token, {
          method: "POST",
          headers: {
            authorization: await authFor(service.origin),
            "content-encoding": "aes128gcm",
            "content-type": "application/octet-stream",
            ttl: String(TTL_SECONDS),
            urgency: "normal",
          },
          body: await encrypt(utf8(payloadOf(m)), m.keys),
        });
        if (res.ok) return { outcome: "sent" };
        if (res.status === 404 || res.status === 410) return { outcome: "gone" };
        const said = (await res.text().catch(() => "")).slice(0, 80).trim();
        return { outcome: "failed", reason: `${service.hostname} ${res.status}${said ? ` ${said}` : ""}` };
      } catch (e) {
        return { outcome: "failed", reason: `${service.hostname}: ${e instanceof Error ? e.message : String(e)}` };
      }
    }),
  );
}
