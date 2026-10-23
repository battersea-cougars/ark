// Passkeys (ADR 0023): sign in with Face ID, a fingerprint or the device's PIN, with no email, for when Gmail is down
// or the inbox is on another phone. A signed-in member adds one on the You page; the sign-in page offers it first,
// and the emailed code stays for a first sign-in, a new phone, or a lost passkey. Verified here with WebCrypto by
// @simplewebauthn/server (ES256 and RS256): no attestation asked for, user verification required, the signature
// counter checked and moved on in one statement.
//
// The passkey belongs to the team app's own domain, the one this request came to (localhost on your machine, dev's
// team.cougars-dev.workers.dev, production's team domain from SITE_URL, scripts/ci/target.mjs: production answers on
// nothing else), and the browser says which page asked (its origin), which must be the same. The store app loads that
// same address (capacitor.config.ts), and the iPhone checks the domain trusts it (webcredentials, store.links.ts).
//
// A challenge is random, stored only as its hash, single-use and lasts five minutes. Adding a passkey: bound to the
// session that asked. Signing in: bound to the browser that asked, by a nonce cookie of its own, as a code is; it's
// spent in the statement that claims it, before the signature's checked, so two requests with one challenge make at
// most one session (ADR 0121).
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { all, first, run } from "@cougars/shared/d1";
import { HttpError, body, json } from "../api/api.http";
import { LIMITS, addressOf, enforce } from "../api/api.limits";
import { audit } from "../settings/audit";
import { addMs, cookie, cookieName, setCookie, sha256, startSession, withCookies, type AuthEnv } from "./auth";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("auth");

const CHALLENGE_MINUTES = 5;
/** ES256 (every phone, Mac and security key) and RS256 (Windows Hello). */
const ALGORITHMS = [-7, -257];
/** Plenty for a phone, a laptop, a tablet and a spare, and a few lost along the way. */
const MAX_PASSKEYS = 10;
const RP_NAME = "Battersea Cougars";

const TRY_AGAIN = "That took too long, or this isn't the browser that asked. Try again.";
const NOT_THAT = "That passkey didn't check out. Try again, or sign in with a code.";

/** The team app's domain and origin, as this request reached it: what a passkey here belongs to. */
export function relyingParty(request: Request) {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

// ─── Base64url ───

const toB64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The challenge a browser's response says it signed, from its clientDataJSON; null for anything that isn't one. */
function challengeOf(response: unknown): string | null {
  const data = (response as { response?: { clientDataJSON?: unknown } } | null)?.response?.clientDataJSON;
  if (typeof data !== "string" || data.length > 4096) return null;
  try {
    const challenge = JSON.parse(new TextDecoder().decode(fromB64url(data))).challenge;
    return typeof challenge === "string" && challenge.length <= 128 ? challenge : null;
  } catch {
    return null;
  }
}

// ─── What a passkey's called ───

/** Who keeps it, from its AAGUID: the password managers members will have. Anything else is just the device. */
const PROVIDERS: Record<string, string> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
};

/** The device a passkey was made on, from its browser: "iPhone", "Mac", "Windows". */
export function deviceOf(userAgent: string): string {
  const ua = userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux|X11/.test(ua)) return "Linux";
  return "A device";
}
const nameOf = (userAgent: string, aaguid: string) =>
  [deviceOf(userAgent), PROVIDERS[aaguid]].filter(Boolean).join(" · ");

/** A member's passkeys, as the You page and their sheet list them: by device and date. */
export async function passkeysOf(db: D1Database, memberId: number) {
  return all<{ id: number; name: string; createdAt: string; lastUsedAt: string | null }>(
    db,
    `SELECT id, name, created_at createdAt, last_used_at lastUsedAt FROM passkeys WHERE member_id = ?
     ORDER BY created_at, id`,
    [memberId],
  );
}

/**
 * Every passkey of a member's gone: an admin removed them, or they were made inactive or given a new sign-in email
 * (whoever had the account before can't keep a way in). How many there were.
 */
export async function forgetPasskeys(db: D1Database, memberId: number): Promise<number> {
  return (await run(db, "DELETE FROM passkeys WHERE member_id = ?", [memberId])).meta.changes;
}

/** How many passkeys a member has: what an admin's removal changes, on the record. */
export async function passkeyCount(db: D1Database, memberId: number) {
  const row = await first<{ n: number }>(db, "SELECT count(*) n FROM passkeys WHERE member_id = ?", [memberId]);
  return { passkeys: row?.n ?? 0 };
}

async function newChallenge(
  env: AuthEnv,
  now: Date,
  purpose: "register" | "sign_in",
  bound: { sessionId: number; userHandle: string } | { nonceHash: string },
): Promise<Uint8Array<ArrayBuffer>> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  await run(
    env.DB,
    `INSERT INTO passkey_challenges (challenge_hash, purpose, session_id, user_handle, nonce_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      await sha256(toB64url(challenge)),
      purpose,
      "sessionId" in bound ? bound.sessionId : null,
      "userHandle" in bound ? bound.userHandle : null,
      "nonceHash" in bound ? bound.nonceHash : null,
      addMs(now, CHALLENGE_MINUTES * 60_000),
      now.toISOString(),
    ],
  );
  return challenge;
}

/**
 * Spend the challenge a response says it signed, in one statement: only if it's live, for this purpose, and bound to
 * whoever's asking. The first request to get here has it; any other sent with it gets nothing.
 */
async function spendChallenge(
  env: AuthEnv,
  now: Date,
  challenge: string | null,
  purpose: "register" | "sign_in",
  bound: { sessionId: number } | { nonceHash: string },
) {
  if (!challenge) return null;
  const [column, value] = "sessionId" in bound ? ["session_id", bound.sessionId] : ["nonce_hash", bound.nonceHash];
  return first<{ id: number; user_handle: string | null }>(
    env.DB,
    `UPDATE passkey_challenges SET used_at = ?
     WHERE challenge_hash = ? AND purpose = ? AND ${column} = ? AND used_at IS NULL AND expires_at > ?
     RETURNING id, user_handle`,
    [now.toISOString(), await sha256(challenge), purpose, value, now.toISOString()],
  );
}

/** Adding a passkey, step one: what the device needs to make it ("Use Face ID next time"). */
export async function registerOptions(
  request: Request,
  env: AuthEnv,
  now: Date,
  mine: { memberId: number; sessionId: number },
) {
  const member = await first<{ name: string; email: string | null }>(
    env.DB,
    "SELECT name, email FROM members WHERE id = ?",
    [mine.memberId],
  );
  const theirs = await all<{ credential_id: string; transports: string; user_handle: string }>(
    env.DB,
    "SELECT credential_id, transports, user_handle FROM passkeys WHERE member_id = ? ORDER BY id",
    [mine.memberId],
  );
  if (theirs.length >= MAX_PASSKEYS) throw new HttpError(400, `That's ${MAX_PASSKEYS} passkeys. Remove one first.`);
  // A random id the passkey knows the member by, the same for all of theirs: never their number or email
  const userHandle = theirs[0]?.user_handle ?? toB64url(crypto.getRandomValues(new Uint8Array(32)));
  const { rpID } = relyingParty(request);
  const challenge = await newChallenge(env, now, "register", { sessionId: mine.sessionId, userHandle });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: member?.email ?? `member-${mine.memberId}`,
    userDisplayName: member?.name ?? "",
    userID: fromB64url(userHandle),
    challenge,
    timeout: CHALLENGE_MINUTES * 60_000,
    attestationType: "none",
    // Discoverable, so the sign-in page needs no email first; and the face, finger or PIN, every time
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    // The member's passkeys already here: their device says it has one rather than making a second
    excludeCredentials: theirs.map((p) => ({ id: p.credential_id, transports: JSON.parse(p.transports) })),
    supportedAlgorithmIDs: ALGORITHMS,
  });
  return json({ options });
}

/** Adding a passkey, step two: the device's new passkey, checked, kept, named for the device it was made on. */
export async function register(
  request: Request,
  env: AuthEnv,
  now: Date,
  mine: { memberId: number; sessionId: number },
) {
  const response = (await body(request)).response as RegistrationResponseJSON;
  const challenge = challengeOf(response);
  const spent = await spendChallenge(env, now, challenge, "register", { sessionId: mine.sessionId });
  if (!spent?.user_handle) throw new HttpError(400, TRY_AGAIN);
  const { rpID, origin } = relyingParty(request);
  let checked;
  try {
    checked = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge!,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    });
  } catch (e) {
    log.warn("passkey.register_refused", { member: mine.memberId, why: e instanceof Error ? e.message : String(e) });
    throw new HttpError(400, "Your device's passkey didn't check out. Try again.");
  }
  if (!checked.verified) throw new HttpError(400, "Your device's passkey didn't check out. Try again.");
  const { credential, aaguid, credentialBackedUp } = checked.registrationInfo;
  const name = nameOf(request.headers.get("user-agent") ?? "", aaguid);
  // Unless it's here already, or they're at the most (two devices adding one at once can't pass it)
  const added = await run(
    env.DB,
    `INSERT INTO passkeys (member_id, credential_id, public_key, sign_count, user_handle, transports, rp_id, name,
       backed_up, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM passkeys WHERE member_id = ?) < ?
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      mine.memberId,
      credential.id,
      toB64url(credential.publicKey),
      credential.counter,
      spent.user_handle,
      JSON.stringify(credential.transports ?? []),
      rpID,
      name,
      Number(credentialBackedUp),
      now.toISOString(),
      mine.memberId,
      MAX_PASSKEYS,
    ],
  );
  if (added.meta.changes !== 1)
    throw new HttpError(400, "That passkey's here already, or you've the most you can have.");
  await audit(env.DB, now, mine.memberId, "passkey.added", { name });
  return json({ ok: true, passkeys: await passkeysOf(env.DB, mine.memberId) });
}

/**
 * Signing in, step one: a challenge for this browser (its own nonce cookie), and no list of passkeys: the device
 * offers whichever of this site's it holds. The sign-in page asks as it opens, for the passkey in the email field's
 * suggestions (conditional mediation), and again for the button.
 */
export async function signInOptions(request: Request, env: AuthEnv, now: Date) {
  await enforce("passkey", addressOf(request), LIMITS.passkey, "Too many tries from here. Wait a few minutes.");
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const challenge = await newChallenge(env, now, "sign_in", { nonceHash: await sha256(toB64url(nonce)) });
  const options = await generateAuthenticationOptions({
    rpID: relyingParty(request).rpID,
    challenge,
    timeout: CHALLENGE_MINUTES * 60_000,
    userVerification: "required",
  });
  return withCookies(json({ options }), [setCookie(request, "passkey", toB64url(nonce), CHALLENGE_MINUTES * 60)]);
}

/** Signing in, step two: the device's signed answer. The same session as a code's, on the same rules. */
export async function signIn(request: Request, env: AuthEnv, now: Date) {
  const response = (await body(request)).response as AuthenticationResponseJSON;
  const nonce = cookie(request, cookieName(request, "passkey"));
  if (!nonce) throw new HttpError(400, TRY_AGAIN);
  const challenge = challengeOf(response);
  // Spent before anything's checked: one challenge, one try, however many requests carry it
  if (!(await spendChallenge(env, now, challenge, "sign_in", { nonceHash: await sha256(nonce) })))
    throw new HttpError(400, TRY_AGAIN);
  const credentialId = typeof response?.id === "string" ? response.id : "";
  const { rpID, origin } = relyingParty(request);
  const key = await first<{
    id: number;
    member_id: number;
    public_key: string;
    sign_count: number;
    transports: string;
    user_handle: string;
    active: number;
  }>(
    env.DB,
    `SELECT p.id, p.member_id, p.public_key, p.sign_count, p.transports, p.user_handle, m.status = 'active' active
     FROM passkeys p JOIN members m ON m.id = p.member_id WHERE p.credential_id = ? AND p.rp_id = ?`,
    [credentialId, rpID],
  );
  // Removed (by them or an admin), or never here: the page tells the device, so it stops offering it
  if (!key)
    return json({ error: "That passkey isn't one the club knows. Sign in with a code.", unknownCredential: true }, 400);
  if (!key.active) throw new HttpError(400, "That account isn't active. Ask an admin.");
  const handle = response.response?.userHandle;
  if (handle && handle !== key.user_handle) throw new HttpError(400, NOT_THAT);
  let checked;
  try {
    checked = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge!,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credentialId,
        publicKey: fromB64url(key.public_key),
        counter: key.sign_count,
        transports: JSON.parse(key.transports),
      },
      requireUserVerification: true,
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // A counter that's gone backwards: a copy of the key. On the record for an admin to see
    if (/counter/i.test(why)) await audit(env.DB, now, key.member_id, "sign_in.passkey_cloned", { passkeyId: key.id });
    log.warn("passkey.sign_in_refused", { member: key.member_id, why });
    throw new HttpError(400, NOT_THAT);
  }
  if (!checked.verified) throw new HttpError(400, NOT_THAT);
  const { newCounter, credentialBackedUp } = checked.authenticationInfo;
  // The counter moves on only from where it was read: two sign-ins with the same count can't both get in. A synced
  // passkey's is always 0, and stays so
  const moved = await run(
    env.DB,
    `UPDATE passkeys SET sign_count = ?, last_used_at = ?, backed_up = ?
     WHERE id = ? AND sign_count = ? AND (? > sign_count OR ? = 0)`,
    [newCounter, now.toISOString(), Number(credentialBackedUp), key.id, key.sign_count, newCounter, newCounter],
  );
  if (moved.meta.changes !== 1) {
    await audit(env.DB, now, key.member_id, "sign_in.passkey_cloned", { passkeyId: key.id });
    throw new HttpError(400, NOT_THAT);
  }
  const { cookies } = await startSession(request, env, now, key.member_id, "passkey");
  return withCookies(json({ ok: true }), cookies);
}

/** Removes one of a member's own passkeys, on the record. A 404 when it isn't theirs. */
export async function forgetPasskey(db: D1Database, now: Date, memberId: number, passkeyId: number) {
  const gone = await run(db, "DELETE FROM passkeys WHERE id = ? AND member_id = ?", [passkeyId, memberId]);
  if (gone.meta.changes !== 1) throw new HttpError(404, "That passkey isn't one of yours.");
  await audit(db, now, memberId, "passkey.removed", { passkeyId });
}
