// The club's email, looked after from the app (#101, ADR 0027). Settings → Email says whether it works: the sending
// account, the From address, the last send or failure, and why (a cancelled token apart from Gmail being busy). When
// Google has cancelled the token, an admin presses "Reconnect email": Google's consent in this browser, back to
// /api/mail/callback, and the new token is kept sealed in D1 (@cougars/shared/gmail-token), used at once by this app
// and the website. No terminal, no Bitwarden, no deploy.
//
// The round trip through Google is OAuth's code flow for a Web application client, with PKCE: a state and a verifier,
// random, in a short-lived cookie in the browser that asked, so Google's answer counts only there, and only once. It
// must grant "Send email on your behalf", and it must not be the club's own account (nothing holds a token for it).
import { first } from "@cougars/shared/d1";
import { clubContact } from "@cougars/shared/club-contact";
import { clearTokenCache, isProduction, mailPausedUntil } from "@cougars/shared/email";
import { canReconnect, gmailCredentials, keepReconnectedToken } from "@cougars/shared/gmail-token";
import { readMailHealth, recordReconnect } from "@cougars/shared/mail-health";
import { scribe } from "@cougars/shared/scribe";
import { cookie, cookieName, setCookie, type AuthEnv } from "../auth/auth";
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
  const [health, using, club, paused] = await Promise.all([
    readMailHealth(env.DB),
    gmailCredentials(env),
    clubContact(env.SITE_ENV),
    mailPausedUntil(),
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
  };
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
    throw new HttpError(503, "Reconnecting isn't set up here yet: it needs the Web client and its key (README#gmail).");
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
