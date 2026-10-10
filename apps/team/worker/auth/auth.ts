// Sign-in (ADR 0023, ADR 0023). A member types their email; the browser gets a private nonce cookie and the member
// gets a 6-digit code by email. The code signs them in only next to that cookie, so a forwarded email signs no one
// in elsewhere. There's no link to tap: on an iPhone it would open a browser, never the installed app. Then a
// session cookie for about 6 months, renewed while it's used, backed by an auth_sessions row an admin can revoke.
// New people ask for access; an admin approves them on Teammates.
//
// Every token (nonce, code, session) is random and stored only as its SHA-256 hash. The reply to an email
// never says whether it's a member's. Guesses are counted before a code is checked, in one statement, so requests
// sent all at once can't get past the limits, and a code is spent the same way, so it signs in once.
import { all, first, run } from "@cougars/shared/d1";
import { assignReferenceSql } from "@cougars/shared/payment-reference";
import { isProduction, mailPausedUntil, sendMail, type MailConfig } from "@cougars/shared/email";
import { tellAdminsOfRequest } from "../members/members.mail";
import { LIMITS, addressOf, enforce } from "../api/api.limits";
import { londonToday } from "../../src/lib/dates";
import { HttpError, body, json, oneOf, text } from "../api/api.http";
import { signInEmail } from "./auth.email";
import { audit } from "../settings/audit";
import { firstAdmin } from "../members/members";

export interface AuthEnv {
  DB: D1Database;
  /** "local" only under `vite` on your machine: no email leaves it, even with Gmail set up; the code is shown on screen. */
  TEAM_ENV?: string;
  SITE_ENV?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  MAIL_SAFE_TO?: string;
}

const CHALLENGE_MINUTES = 15;
/** Wrong codes allowed against one emailed code. */
const MAX_ATTEMPTS = 5;
// The limits count against the browser asking (its nonce), not the member (#69): a stranger who knows someone's email
// can't use them up and lock the member out. Guessing stays bounded by the member-wide ceiling: 30 codes × 5 tries
// a day, against a code that's one in a million.
/** New codes one browser may ask for, for one member, in an hour and in a day. */
const MAX_CHALLENGES_PER_HOUR = 5;
const MAX_CHALLENGES_PER_DAY = 10;
/** Codes one member is sent in a day, across every browser: their inbox's limit. */
const MAX_CHALLENGES_PER_MEMBER_DAY = 30;
/** Wrong codes one browser may type in a day before it stops taking any (and being sent new ones). */
const MAX_FAILURES_PER_DAY = 20;
const SESSION_DAYS = 180;
/** A session's expiry moves on at most once a day, so most requests don't write. */
const RENEW_AFTER_MS = 24 * 3600_000;
/** Asking to join stops while this many are waiting, so a script can't fill the list. */
const MAX_PENDING = 50;

const SAME_REPLY = "If that email is a member's, a code is on its way. It works for 15 minutes, in this browser.";
const ELSEWHERE = "That code has run out, or this isn't the browser you asked in. Ask for a new one.";

// ─── Tokens and cookies ───

const encoder = new TextEncoder();
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
/** Six digits, every one equally likely. */
function code(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do n = crypto.getRandomValues(buf)[0];
  while (n >= 4_294_000_000); // a multiple of 1,000,000, so no code is likelier than another
  return String(n % 1_000_000).padStart(6, "0");
}

const isHttps = (request: Request) => new URL(request.url).protocol === "https:";

/** An address only this machine or its network can reach: loopback, a private range, or a name that can't be public. */
export function privateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h.endsWith(".test")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * Whether this is your own machine's server (ADR 0023): `vite` says so (TEAM_ENV "local"), and the request came to a
 * private address. A build never says so; and if one ever did by mistake, a public address still gets nothing local
 * (no code on screen, no first admin without signing in).
 */
export const localHere = (env: { TEAM_ENV?: string }, request: Request) =>
  env.TEAM_ENV === "local" && privateHost(new URL(request.url).hostname);
/**
 * A cookie's name here. On https it carries the __Host- prefix: the browser then insists on Secure, Path=/ and no
 * Domain, so no sibling subdomain can set or shadow it. Plain http (a local server on the LAN) can't use it.
 */
const cookieName = (request: Request, base: "session" | "nonce") =>
  `${isHttps(request) ? "__Host-" : ""}cougars_${base}`;

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}
/** A private cookie: not for scripts, not sent cross-site, Secure wherever the page is https. */
function setCookie(request: Request, base: "session" | "nonce", value: string, maxAge: number): string {
  const secure = isHttps(request) ? "; Secure" : "";
  return `${cookieName(request, base)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const addMs = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

const TOO_MANY_TRIES = "Too many tries from here. Wait a few minutes.";

export const mailConfig = (env: AuthEnv): MailConfig => ({
  siteEnv: env.SITE_ENV,
  gmail:
    env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN
      ? { clientId: env.GMAIL_CLIENT_ID, clientSecret: env.GMAIL_CLIENT_SECRET, refreshToken: env.GMAIL_REFRESH_TOKEN }
      : null,
  safeTo: env.MAIL_SAFE_TO ?? null,
});

/** How to send: the secrets, and outside production who gets their own email (Dev tools, ADR 0027). */
export async function mailSetup(env: AuthEnv): Promise<MailConfig> {
  const config = mailConfig(env);
  if (isProduction(env.SITE_ENV)) return config;
  // The admins always (so they can sign in here and open Dev tools), and whoever Dev tools lists
  const rows = await all<{ email: string }>(
    env.DB,
    `SELECT lower(m.email) AS email FROM members m
       JOIN member_roles mr ON mr.member_id = m.id JOIN roles r ON r.id = mr.role_id
      WHERE r.name = 'Admin' AND m.status = 'active' AND m.email IS NOT NULL
     UNION SELECT email FROM dev_mail_recipients`,
  );
  return { ...config, allow: rows.map((r) => r.email) };
}

// ─── Sessions ───

/** The member a request's session cookie belongs to, and a renewed cookie when it's due one. */
export async function sessionOf(
  request: Request,
  env: AuthEnv,
  now: Date,
): Promise<{ memberId: number; setCookie?: string } | null> {
  const value = cookie(request, cookieName(request, "session"));
  if (!value) return null;
  const row = await first<{ id: number; member_id: number; last_seen_at: string }>(
    env.DB,
    `SELECT s.id, s.member_id, s.last_seen_at FROM auth_sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND m.status = 'active'`,
    [await sha256(value), now.toISOString()],
  );
  if (!row) return null;
  if (now.getTime() - Date.parse(row.last_seen_at) < RENEW_AFTER_MS) return { memberId: row.member_id };
  await run(env.DB, `UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`, [
    now.toISOString(),
    addMs(now, SESSION_DAYS * 86_400_000),
    row.id,
  ]);
  return { memberId: row.member_id, setCookie: setCookie(request, "session", value, SESSION_DAYS * 86_400) };
}

/** A member's bank reference (ADR 0007), unless they have one. */
export async function giveReference(db: D1Database, memberId: number, name: string) {
  const { sql, candidates } = assignReferenceSql(name, "id = ?");
  await run(db, sql, [...candidates, memberId]);
}

async function startSession(request: Request, env: AuthEnv, now: Date, memberId: number, method: string) {
  // Someone made before references read as names (migration 0012) gets theirs the next time they sign in
  const unreferenced = await first<{ name: string }>(
    env.DB,
    `SELECT name FROM members WHERE id = ? AND payment_reference IS NULL`,
    [memberId],
  );
  if (unreferenced) await giveReference(env.DB, memberId, unreferenced.name);
  const value = token();
  await run(
    env.DB,
    `INSERT INTO auth_sessions (member_id, token_hash, method, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      memberId,
      await sha256(value),
      method,
      (request.headers.get("user-agent") ?? "").slice(0, 200),
      now.toISOString(),
      now.toISOString(),
      addMs(now, SESSION_DAYS * 86_400_000),
    ],
  );
  await audit(env.DB, now, memberId, "sign_in", { method });
  return [setCookie(request, "session", value, SESSION_DAYS * 86_400), setCookie(request, "nonce", "", 0)];
}

const withCookies = (res: Response, cookies: string[]) => {
  for (const c of cookies) res.headers.append("set-cookie", c);
  return res;
};

// ─── The routes, before anyone is signed in ───

type Waiter = (p: Promise<unknown>) => void;

/** Sign-in's own routes, answered without a session. Null for anything else. */
export async function handleAuth(
  request: Request,
  env: AuthEnv,
  now: Date,
  waitUntil?: Waiter,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const m = request.method;
  if (pathname === "/api/auth/start" && m === "POST") return start(request, env, now, waitUntil);
  if (pathname === "/api/auth/verify" && m === "POST") return verify(request, env, now);
  if (pathname === "/api/auth/sign-out" && m === "POST") return signOut(request, env, now);
  if (pathname === "/api/auth/request" && m === "POST") return requestAccess(request, env, now);
  // Your own machine only: anywhere else it isn't there at all (null: the API's 404)
  if (pathname === "/api/auth/dev" && m === "POST" && localHere(env, request)) return devSignIn(request, env, now);
  return null;
}

const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
/** An email address from a request body: trimmed, lower case, and shaped like one. */
export function email(o: Record<string, unknown>): string {
  const e = text(o, "email", { max: 254 }).toLowerCase();
  if (!EMAIL.test(e)) throw new HttpError(400, "That doesn't look like an email address.");
  return e;
}

/** Wrong codes typed in one browser (by its nonce) in the last day. */
async function failuresToday(db: D1Database, nonceHash: string, now: Date) {
  const row = await first<{ n: number | null }>(
    db,
    `SELECT sum(attempts) AS n FROM login_challenges WHERE nonce_hash = ? AND created_at > ?`,
    [nonceHash, addMs(now, -86_400_000)],
  );
  return row?.n ?? 0;
}

/**
 * Email in: a nonce cookie in this browser (the one it already has, so an earlier code in the same browser keeps
 * working), and a code to the member, if it's a member's.
 */
async function start(request: Request, env: AuthEnv, now: Date, waitUntil?: Waiter): Promise<Response> {
  await enforce("sign-in", addressOf(request), LIMITS.signIn, TOO_MANY_TRIES);
  const address = email(await body(request));
  // Gmail is paused (circuit breaker, ADR 0055): no code could reach anyone, so say so now. The same for everyone,
  // member or not, so it gives nothing away.
  const local = localHere(env, request);
  if (!local && mailConfig(env).gmail && (await mailPausedUntil()))
    throw new HttpError(503, "Email isn't sending right now, so a code can't reach you. Try again in a few minutes.");
  let nonce = cookie(request, cookieName(request, "nonce")) ?? token();
  const res = (devCode?: string) =>
    withCookies(json({ ok: true, message: SAME_REPLY, ...(devCode ? { devCode } : {}) }), [
      setCookie(request, "nonce", nonce, CHALLENGE_MINUTES * 60),
    ]);

  const member = await first<{ id: number; name: string }>(
    env.DB,
    `SELECT id, name FROM members WHERE email = ? AND status = 'active'`,
    [address],
  );
  if (!member) return res();
  // One member a browser at a time (ADR 0023): asking for another account's code starts a fresh nonce, so the earlier
  // account's codes die with the old one, and every guess under a nonce counts against the one account it's for
  const another = await first(
    env.DB,
    `SELECT 1 FROM login_challenges WHERE nonce_hash = ? AND used_at IS NULL AND expires_at > ? AND member_id != ?`,
    [await sha256(nonce), now.toISOString(), member.id],
  );
  if (another) nonce = token();
  const nonceHash = await sha256(nonce);
  const counts = await first<{ hour: number; day: number; everywhere: number }>(
    env.DB,
    `SELECT coalesce(sum(nonce_hash = ? AND created_at > ?), 0) AS hour,
            coalesce(sum(nonce_hash = ?), 0) AS day, count(*) AS everywhere
     FROM login_challenges WHERE member_id = ? AND created_at > ?`,
    [nonceHash, addMs(now, -3600_000), nonceHash, member.id, addMs(now, -86_400_000)],
  );
  // This browser's own limits: it waits, and nobody else does
  if ((counts?.hour ?? 0) >= MAX_CHALLENGES_PER_HOUR || (counts?.day ?? 0) >= MAX_CHALLENGES_PER_DAY) return res();
  if ((await failuresToday(env.DB, nonceHash, now)) >= MAX_FAILURES_PER_DAY) return res();
  // The member's inbox has had enough for today: on the record, for an admin to see
  if ((counts?.everywhere ?? 0) >= MAX_CHALLENGES_PER_MEMBER_DAY) {
    await audit(env.DB, now, member.id, "sign_in.capped");
    return res();
  }

  const theCode = code();
  await run(
    env.DB,
    `INSERT INTO login_challenges (member_id, code_hash, nonce_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [member.id, await sha256(theCode), nonceHash, addMs(now, CHALLENGE_MINUTES * 60_000), now.toISOString()],
  );
  // On your own machine nothing is emailed, even with Gmail set up: the code comes back to the screen
  if (local) return res(theCode);
  const mail = { to: [address], ...signInEmail(theCode, CHALLENGE_MINUTES) };
  const setup = await mailSetup(env);
  // Outside production, a code that goes to its member also goes to the dev mailbox, just in case (ADR 0027): the same
  // email with no allow list lands in the safe inbox. One that went there already isn't sent twice.
  const copy = !isProduction(env.SITE_ENV) && setup.allow?.includes(address);
  const sending = (async () => {
    await sendMail(mail, setup);
    if (copy) await sendMail(mail, { ...setup, allow: [] });
  })().catch((e) => console.error(JSON.stringify({ event: "sign_in.email_failed", error: String(e) })));
  if (waitUntil) waitUntil(sending);
  else await sending;
  return res();
}

interface Challenge {
  id: number;
  member_id: number;
  code_hash: string;
  attempts: number;
}

/** This browser's live challenges: every code it asked for in the last 15 minutes, still unused. */
async function liveChallenges(request: Request, env: AuthEnv, now: Date): Promise<[string, Challenge[]] | null> {
  const nonce = cookie(request, cookieName(request, "nonce"));
  if (!nonce) return null;
  const nonceHash = await sha256(nonce);
  const rows = await all<Challenge>(
    env.DB,
    `SELECT id, member_id, code_hash, attempts FROM login_challenges
     WHERE nonce_hash = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC`,
    [nonceHash, now.toISOString()],
  );
  return rows.length ? [nonceHash, rows] : null;
}

/** Spends a challenge in one statement: only the first request to get here signs in with it, and the rest of this
 * browser's codes go with it. */
async function spend(env: AuthEnv, now: Date, c: Challenge, nonceHash: string): Promise<boolean> {
  const res = await run(env.DB, `UPDATE login_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL`, [
    now.toISOString(),
    c.id,
  ]);
  if (res.meta.changes !== 1) return false;
  await run(env.DB, `UPDATE login_challenges SET used_at = ? WHERE nonce_hash = ? AND used_at IS NULL`, [
    now.toISOString(),
    nonceHash,
  ]);
  return true;
}

/** The 6-digit code, typed in the browser that asked. Any of its live codes will do. */
async function verify(request: Request, env: AuthEnv, now: Date): Promise<Response> {
  const typed = text(await body(request), "code", { max: 20 }).replace(/\s/g, "");
  const live = await liveChallenges(request, env, now);
  if (!live) throw new HttpError(400, ELSEWHERE);
  const [nonceHash, challenges] = live;
  if ((await failuresToday(env.DB, nonceHash, now)) >= MAX_FAILURES_PER_DAY)
    throw new HttpError(429, "Too many wrong codes today. Try again tomorrow.");
  // Count the guess before looking at it, in one statement, so a burst of guesses can't all see "no tries yet"
  const counted = await first<{ id: number }>(
    env.DB,
    `UPDATE login_challenges SET attempts = attempts + 1
     WHERE id = (SELECT id FROM login_challenges WHERE nonce_hash = ? AND used_at IS NULL AND expires_at > ?
                 AND attempts < ? ORDER BY id DESC LIMIT 1)
     RETURNING id`,
    [nonceHash, now.toISOString(), MAX_ATTEMPTS],
  );
  if (!counted) throw new HttpError(400, "Too many tries. Ask for a new code.");

  const hash = await sha256(typed);
  const match = challenges.find((c) => c.code_hash === hash);
  if (match && (await spend(env, now, match, nonceHash))) {
    // A right code isn't a wrong one
    await run(env.DB, `UPDATE login_challenges SET attempts = attempts - 1 WHERE id = ?`, [counted.id]);
    return withCookies(json({ ok: true }), await startSession(request, env, now, match.member_id, "code"));
  }
  if (match) throw new HttpError(400, ELSEWHERE);
  const left = await first<{ n: number }>(
    env.DB,
    `SELECT coalesce(sum(? - attempts), 0) AS n FROM login_challenges
     WHERE nonce_hash = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?`,
    [MAX_ATTEMPTS, nonceHash, now.toISOString(), MAX_ATTEMPTS],
  );
  const n = left?.n ?? 0;
  throw new HttpError(
    400,
    n > 0 ? `That's not the code. ${n} ${n === 1 ? "try" : "tries"} left.` : "Too many tries. Ask for a new code.",
  );
}

/**
 * Signing in on your own machine without a code (ADR 0023), for scripts, tests and agents driving a headless browser
 * (`node scripts/dev-sign-in.mjs`): any active member, by email (none: the first admin), as often as asked. No code, no caps: the caps guard a
 * member's inbox and their account, and on your own machine there's neither. A real session, so the app behaves as
 * it does for anyone; on the record as `sign_in` with method `dev`. Only ever answered by localHere.
 */
async function devSignIn(request: Request, env: AuthEnv, now: Date): Promise<Response> {
  // No email: the first admin, as TEAM_AUTO_ADMIN does, so a script needs nobody's address written into it
  const b = await body(request);
  const memberId = b.email
    ? (await first<{ id: number }>(env.DB, `SELECT id FROM members WHERE email = ? AND status = 'active'`, [email(b)]))
        ?.id
    : await firstAdmin(env.DB);
  if (memberId == null) throw new HttpError(404, "No active member has that email.");
  return withCookies(json({ ok: true, memberId }), await startSession(request, env, now, memberId, "dev"));
}

async function signOut(request: Request, env: AuthEnv, now: Date): Promise<Response> {
  const value = cookie(request, cookieName(request, "session"));
  if (value) {
    const row = await first<{ id: number; member_id: number }>(
      env.DB,
      `SELECT id, member_id FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL`,
      [await sha256(value)],
    );
    if (row) {
      await run(env.DB, `UPDATE auth_sessions SET revoked_at = ? WHERE id = ?`, [now.toISOString(), row.id]);
      await audit(env.DB, now, row.member_id, "sign_out");
    }
  }
  return withCookies(json({ ok: true }), [setCookie(request, "session", "", 0)]);
}

/** Someone new asks to join: a pending member an admin approves. The reply never says the email was taken. */
async function requestAccess(request: Request, env: AuthEnv, now: Date): Promise<Response> {
  await enforce("join", addressOf(request), LIMITS.join, TOO_MANY_TRIES);
  const b = await body(request);
  const name = text(b, "name", { max: 80 });
  const address = email(b);
  const phone = text(b, "phone", { optional: true, max: 30 }) || null;
  const position = oneOf(b, "position", ["F", "D", "G"] as const);
  const reply = json({ ok: true, message: "Thanks. An admin will let you in; then sign in with that email." });

  if (await first(env.DB, `SELECT 1 FROM members WHERE email = ?`, [address])) return reply;
  const pending = await first<{ n: number }>(env.DB, `SELECT count(*) AS n FROM members WHERE status = 'pending'`);
  if ((pending?.n ?? 0) >= MAX_PENDING)
    throw new HttpError(429, "Lots of people are waiting to be let in. Try tomorrow.");
  const res = await run(
    env.DB,
    `INSERT INTO members (name, email, phone, position, status, joined_on, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    [name, address, phone, position, londonToday(now), now.toISOString()],
  );
  const id = Number(res.meta.last_row_id);
  await giveReference(env.DB, id, name);
  await audit(env.DB, now, id, "access.requested");
  // The admins hear at once, with a link to their sheet (ADR 0069)
  await tellAdminsOfRequest(env, { id, name, position }, new URL(request.url).origin);
  return reply;
}
