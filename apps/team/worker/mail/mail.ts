// The club's email, looked after from the app (#101, ADR 0027). Settings → Email says whether it works: the sending
// account, the From address, the last send or failure, and why (a cancelled token apart from Gmail being busy). When
// Google has cancelled the token, an admin presses "Reconnect email": Google's consent in this browser, back to
// /api/mail/callback, and the new token is kept sealed in D1 (@cougars/shared/gmail-token), used at once by this app
// and the website. No terminal, no Bitwarden, no deploy.
//
// The round trip through Google is OAuth's code flow for a Web application client, with PKCE: a state and a verifier,
// random, in a short-lived cookie in the browser that asked, so Google's answer counts only there, and only once. It
// must grant "Send email on your behalf", and it must not be the club's own account (nothing holds a token for it).
// Every try is on the record with how it ended (mail.reconnected, or mail.reconnect_tried with the outcome, never
// anything from Google's answer), and Settings → Email reads the last one from there, not only from its address.
//
// "Send a test email" sends one, the way every email goes (mailSetup: the reconnected token, else the deployed one,
// with how it went written down), to the admin who pressed it and nobody else: there's no address to type.
import { first } from "@cougars/shared/d1";
import { clubContact } from "@cougars/shared/club-contact";
import {
  MailRefused,
  clearTokenCache,
  isProduction,
  mailFailureOf,
  mailPausedUntil,
  sendMail,
  type MailFailure,
} from "@cougars/shared/email";
import { canReconnect, gmailCredentials, keepReconnectedToken } from "@cougars/shared/gmail-token";
import { readMailHealth, recordReconnect } from "@cougars/shared/mail-health";
import { scribe } from "@cougars/shared/scribe";
import { cookie, cookieName, mailSetup, setCookie, type AuthEnv } from "../auth/auth";
import { LIMITS, enforce } from "../api/api.limits";
import { HttpError, json } from "../api/api.http";
import { audit } from "../settings/audit";

const log = scribe.logger("mail");

const CONSENT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const SEND = "https://www.googleapis.com/auth/gmail.send";
/** Send only (it can't read the mailbox), and the account's address, to check who signed in. */
const SCOPES = [SEND, "openid", "email"];
/** Long enough to sign in to Google and tick a box. */
const ROUND_TRIP_SECONDS = 10 * 60;
export const CALLBACK = "/api/mail/callback";
const PAGE = "/settings/email";

/** How the round trip ended, as the page it lands on says it (Settings → Email, ?email=). */
export type Reconnected = "reconnected" | "denied" | "no-send" | "club" | "expired" | "failed";

export async function mailStatus(env: AuthEnv) {
  const [health, using, club, paused, tried] = await Promise.all([
    readMailHealth(env.DB),
    gmailCredentials(env),
    clubContact(env.SITE_ENV),
    mailPausedUntil(),
    lastAttempt(env.DB),
  ]);
  const by = health.reconnectedBy
    ? await first<{ id: number; name: string }>(env.DB, "SELECT id, name FROM members WHERE id = ?", [
        health.reconnectedBy,
      ])
    : null;
  return {
    account: health.account,
    // Production sends as the club's address, an alias of the account; anywhere else the account is its own sender
    from: health.account && (isProduction(env.SITE_ENV) && club ? club : health.account),
    source: using?.source ?? null,
    lastSentAt: health.lastSentAt,
    failedAt: health.failedAt,
    failure: health.failure,
    pausedUntil: paused ? new Date(paused).toISOString() : null,
    reconnectedAt: health.reconnectedAt,
    reconnectedBy: by,
    canReconnect: canReconnect(env),
    lastAttempt: tried,
  };
}

/** How the last trip through Google ended, whoever made it, from the record. */
async function lastAttempt(db: D1Database) {
  const row = await first<{ action: string; detail: string; at: string; id: number | null; name: string | null }>(
    db,
    `SELECT a.action, a.detail, a.at, m.id, m.name FROM audit_log a LEFT JOIN members m ON m.id = a.member_id
      WHERE a.action IN ('mail.reconnected', 'mail.reconnect_tried') ORDER BY a.id DESC LIMIT 1`,
  );
  if (!row) return null;
  const outcome: Reconnected =
    row.action === "mail.reconnected"
      ? "reconnected"
      : ((JSON.parse(row.detail) as { to?: { outcome?: Reconnected } }).to?.outcome ?? "failed");
  return { outcome, at: row.at, by: row.id ? { id: row.id, name: row.name! } : null };
}

const randomUrlSafe = (bytes: number) =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const challengeOf = async (verifier: string) =>
  btoa(
    String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const callbackOf = (request: Request) => `${new URL(request.url).origin}${CALLBACK}`;

/** "Reconnect email": Google's consent page to send the browser to, and the cookie that lets its answer back in. */
export async function startReconnect(env: AuthEnv, request: Request): Promise<Response> {
  if (!canReconnect(env))
    throw new HttpError(
      503,
      "Reconnecting isn't set up here yet: it needs the Web client and its key (docs/secrets.md#gmail).",
    );
  const state = randomUrlSafe(16);
  const verifier = randomUrlSafe(32);
  const { account } = await readMailHealth(env.DB);
  const url = new URL(CONSENT);
  url.search = new URLSearchParams({
    client_id: env.GMAIL_WEB_CLIENT_ID!,
    redirect_uri: callbackOf(request),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // a refresh token, not just an hour's access
    prompt: "consent select_account", // always a refresh token, and always ask which account
    state,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: "S256",
    ...(account ? { login_hint: account } : {}),
  }).toString();
  const res = json({ url: url.toString() });
  res.headers.append("set-cookie", setCookie(request, "gmail", `${state}.${verifier}`, ROUND_TRIP_SECONDS));
  return res;
}

/** Back from Google: keep the new token if it's right, and land on Settings → Email saying how it went. */
export async function finishReconnect(env: AuthEnv, request: Request, memberId: number, now: string) {
  const outcome = await reconnect(env, request, memberId, now).catch((error) => {
    log.error("mail.reconnect_failed", error);
    return "failed" as const;
  });
  // A try that didn't reconnect is on the record too, so the page can say why whatever its address says
  if (outcome !== "reconnected")
    await audit(env.DB, now, memberId, "mail.reconnect_tried", { to: { outcome } }).catch((e) =>
      log.error("mail.reconnect_unrecorded", e),
    );
  log.info("mail.reconnect_tried", { outcome });
  return new Response(null, {
    status: 303,
    headers: [
      ["location", `${PAGE}?email=${outcome}`],
      ["cache-control", "no-store"],
      // Spent, however it went
      ["set-cookie", setCookie(request, "gmail", "", 0)],
    ],
  });
}

async function reconnect(env: AuthEnv, request: Request, memberId: number, now: string): Promise<Reconnected> {
  const q = new URL(request.url).searchParams;
  const [state, verifier] = (cookie(request, cookieName(request, "gmail")) ?? "").split(".");
  if (!state || !verifier || q.get("state") !== state) return "expired";
  if (q.get("error")) return q.get("error") === "access_denied" ? "denied" : "failed";
  if (!canReconnect(env)) return "failed";
  const res = await fetch(TOKEN, {
    method: "POST",
    body: new URLSearchParams({
      code: q.get("code") ?? "",
      client_id: env.GMAIL_WEB_CLIENT_ID!,
      client_secret: env.GMAIL_WEB_CLIENT_SECRET!,
      redirect_uri: callbackOf(request),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = (await res.json().catch(() => ({}))) as {
    refresh_token?: string;
    scope?: string;
    id_token?: string;
    error?: string;
  };
  // The error code only; never the answer, which holds the token
  if (!res.ok) throw new Error(`Google's token exchange: ${res.status} ${token.error ?? ""}`);
  if (!token.scope?.split(" ").includes(SEND)) return "no-send";
  const account = accountOf(token.id_token);
  if (!account || !token.refresh_token) throw new Error("Google's answer had no account or no refresh token");
  if (account === (await clubContact(env.SITE_ENV))) return "club";
  await keepReconnectedToken(env, token.refresh_token, now);
  await recordReconnect(env.DB, account, memberId, now);
  await audit(env.DB, now, memberId, "mail.reconnected", { to: { account } });
  // The next email asks Google afresh, with the new token
  clearTokenCache();
  log.info("mail.reconnected", { account });
  return "reconnected";
}

// The id_token comes straight from Google over TLS in the same answer, so its payload is read without verifying.
function accountOf(idToken: string | undefined): string {
  try {
    const payload = JSON.parse(atob(idToken!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  } catch {
    return "";
  }
}

/** How a test email went: Gmail took it, or there's no email set up here (logged), or why it didn't go. */
export type TestResult = "sent" | "logged" | MailFailure | "refused";

/** "Send a test email": one, to the admin who asked, the way every email goes. */
export async function sendTestEmail(env: AuthEnv, memberId: number, now: string) {
  await enforce(
    "mail-test",
    String(memberId),
    LIMITS.testMail,
    "That's 5 test emails this hour. Try again in an hour.",
  );
  const me = await first<{ email: string | null }>(env.DB, "SELECT email FROM members WHERE id = ?", [memberId]);
  const address = me?.email?.trim().toLowerCase();
  if (!address) throw new HttpError(409, "You have no email address here to send it to.");
  const [setup, using, { account }] = await Promise.all([
    mailSetup(env),
    gmailCredentials(env),
    readMailHealth(env.DB),
  ]);
  // Outside production the admin's own address gets it (safeMail still keeps the club's inbox out). It reads as the
  // club's address everywhere, as production's email does, so the alias is checked before launch
  const config = { ...setup, allow: [...(setup.allow ?? []), address] };
  const mail = { to: [address], asClub: true, ...testEmail(account, using?.source ?? null, setup.club ?? null) };
  let result: TestResult;
  let to = [address];
  let refused: string | undefined;
  try {
    const sent = await sendMail(mail, config);
    result = sent.status;
    to = sent.to;
  } catch (error) {
    result = error instanceof MailRefused ? "refused" : mailFailureOf(error);
    if (error instanceof MailRefused) refused = error.message;
    log.error("mail.test_failed", error);
  }
  await audit(env.DB, now, memberId, "mail.test_sent", { to: { to: to.join(", "), result } });
  return { result, to, ...(refused ? { refused } : {}) };
}

/** What a test email says: who sent it, with which token, and how the From line reads in production. */
function testEmail(account: string | null, source: "reconnected" | "deployed" | null, club: string | null) {
  const token =
    source === "reconnected"
      ? "the reconnected token (an admin pressed Reconnect email)"
      : source === "deployed"
        ? "the deployed token (the one set up with the app)"
        : "no token at all";
  return {
    subject: "Cougars: Test email. Top shelf.",
    text: [
      "Bar down. The club's email works: this came the way every sign-in code and reminder goes.",
      "",
      `Sent by: ${account ?? "the sending account"}`,
      `With: ${token}`,
      `The From line should read: "Battersea Cougars <${club ?? "the club's address"}>". If it shows ${account ?? "the sending account"} instead, the club's address isn't a verified "Send mail as" alias in that account's Gmail yet.`,
      "",
      "Only you get this: a test email only ever goes to the admin who pressed the button.",
      "",
      "Battersea Cougars Inline Hockey Club",
    ].join("\n"),
  };
}
