// Email through the Gmail API (HTTPS, not SMTP), for the website and the team app. Pattern from gwenda-hackney/ark
// (packages/shared/gmail-send.js), with the club's consumer Gmail account: an OAuth refresh token (send-only) instead of a
// Workspace service account. Setup: README.md#gmail. Decision: docs/adr/0027-email-through-gmail-api.md.
//
// Outside production nothing reaches a real person (sendMail always runs safeMail):
//   - production means SITE_ENV is exactly "production"; anything else, including unset, is not;
//   - every recipient is replaced by one safe address: MAIL_SAFE_TO, or else the sending account itself (dev sends
//     from the developer account to itself); the real recipients go in the subject and a header;
//   - the club's own inbox (Sanity → Club → Contact email, club-contact.ts) is refused, as the safe address and as the
//     sending account; while it isn't known, the dev allow list is ignored;
//   - without Gmail credentials (a laptop, tests) it logs the email instead of sending.
//
// Gmail is behind a circuit breaker (packages/shared/breaker.ts, ADR 0055): when it's down or has rate-limited the account,
// sends fail at once for a while instead of each waiting for Google, and the sign-in page can say so up front.
import { HttpFailure, QuotaError, guard, pausedUntil, retryAfter } from "./breaker";
import { scribe } from "./scribe";

const log = scribe.logger("mail");

const FROM_NAME = "Battersea Cougars";

export interface Mail {
  to: string[];
  subject: string;
  text: string;
  /** An HTML version beside the text one, for clients that show it; the text one is always sent too. */
  html?: string;
  replyTo?: string;
  /** Values never written to a log, in any part of the mail (a sign-in code): a logged copy says [redacted]. */
  secrets?: string[];
}

/**
 * The fake world's inbox (the Worker's tests, ADR 0031): each mail that isn't sent, whole, as it would have gone.
 * Nothing sets it in a deployed Worker, where an unsent mail is only logged, with its secrets redacted.
 */
export const outbox: { capture?: (mail: Mail) => void } = {};

/** A mail's text with its secrets taken out, for a log. */
function redact(value: string | undefined, secrets: readonly string[] = []): string | undefined {
  if (value === undefined) return value;
  return secrets.filter(Boolean).reduce((v, secret) => v.split(secret).join("[redacted]"), value);
}

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface MailConfig {
  /** SITE_ENV: only exactly "production" sends to real recipients. */
  siteEnv: string | undefined;
  /** Null when the secrets aren't there: the email is logged, not sent. */
  gmail: GmailCredentials | null;
  /** Where every email goes outside production. Defaults to the sending account. */
  safeTo?: string | null;
  /** Outside production, addresses that get their own email (the team app's Dev tools list). Ignored in production. */
  allow?: readonly string[];
  /**
   * The club's inbox (club-contact.ts): production sends as it, a Gmail alias of the sending account; elsewhere it
   * never gets email. Null when unknown: production then sends as the account itself.
   */
  club?: string | null;
}

export type SendResult = { status: "sent"; id: string; to: string[] } | { status: "logged"; to: string[] };

export class MailRefused extends Error {}

export const isProduction = (siteEnv: string | undefined) => siteEnv === "production";

/**
 * The email as it may leave this environment. Production: unchanged. Anywhere else: to the safe address only, with
 * the real recipients in the subject and X-Cougars-Original-To. Throws MailRefused rather than risk a real inbox.
 */
export function safeMail(
  mail: Mail,
  {
    siteEnv,
    safeTo,
    allow = [],
    club = null,
  }: {
    siteEnv: string | undefined;
    safeTo: string | null | undefined;
    allow?: readonly string[];
    club?: string | null;
  },
): Mail & { headers?: Record<string, string> } {
  if (isProduction(siteEnv)) return mail;
  const safe = safeTo?.trim().toLowerCase();
  const inbox = club?.trim().toLowerCase() || null;
  if (!safe) throw new MailRefused(`No safe address outside production (SITE_ENV=${siteEnv ?? "unset"}); not sending.`);
  if (safe === inbox) throw new MailRefused(`The club's inbox can't be the safe address outside production.`);
  const shown = mail.to.join(", ");
  // The dev allow list (set in the team app's Dev tools): when every recipient is on it, they get it themselves. Never
  // the club's inbox, and not at all while the club's inbox isn't known; if anyone isn't on it, the whole email goes to
  // the safe address.
  const allowed = new Set(inbox ? allow.map((a) => a.trim().toLowerCase()).filter((a) => a && a !== inbox) : []);
  const to = mail.to.map((a) => a.trim().toLowerCase());
  const through = to.length > 0 && to.every((a) => allowed.has(a));
  return {
    ...mail,
    to: through ? to : [safe],
    subject: `[${siteEnv || "unset"}, for ${shown}] ${mail.subject}`,
    headers: { "X-Cougars-Original-To": shown },
  };
}

interface AccessToken {
  token: string;
  /** The account the token sends as, from Google's id_token. */
  account: string;
  expiresAt: number;
}
let cachedToken: (AccessToken & { refreshToken: string }) | undefined;

/** An access token for the account, reused until a minute before it expires. Throws on any Google error. */
export async function accessToken(
  gmail: GmailCredentials,
  { fetch = globalThis.fetch, now = Date.now } = {},
): Promise<AccessToken> {
  if (cachedToken?.refreshToken === gmail.refreshToken && cachedToken.expiresAt > now() + 60_000) return cachedToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: gmail.clientId,
      client_secret: gmail.clientSecret,
      refresh_token: gmail.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    id_token?: string;
    error?: string;
  };
  // The error code only (e.g. invalid_grant: the token was revoked); never the response, which holds the token.
  if (!res.ok || !body.access_token)
    throw gmailError(`Gmail token: ${res.status} ${body.error ?? "no access token"}`, res);
  const account = body.id_token ? accountOf(body.id_token) : "";
  if (!account) throw new Error("Gmail token: no account address (re-run scripts/gmail-auth.mjs)");
  cachedToken = {
    refreshToken: gmail.refreshToken,
    token: body.access_token,
    account,
    expiresAt: now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken;
}

/** For tests: forget the cached access token. */
export const clearTokenCache = () => void (cachedToken = undefined);

// The id_token comes straight from Google over TLS in the same response, so its payload is read without verifying.
function accountOf(idToken: string): string {
  try {
    const payload = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Send one email, safely (see the top of this file). Without credentials it logs and returns "logged". Throws on a
 * refusal or a Gmail error; callers that run it after the response (waitUntil) catch and log.
 */
export async function sendMail(
  mail: Mail,
  config: MailConfig,
  { fetch = globalThis.fetch, now = Date.now } = {},
): Promise<SendResult> {
  if (!config.gmail) {
    const safe = safeMail(mail, {
      siteEnv: config.siteEnv,
      safeTo: config.safeTo ?? "nobody@example.invalid",
      allow: config.allow,
      club: config.club,
    });
    outbox.capture?.(safe);
    // Never a secret in a log (#74): a deploy missing its Gmail secrets would otherwise log live sign-in codes
    const hide = (v: string | undefined) => redact(v, mail.secrets);
    log.info("mail.logged", { to: safe.to, subject: hide(safe.subject), text: hide(safe.text), html: hide(safe.html) });
    return { status: "logged", to: safe.to };
  }
  const gmail = config.gmail;
  const { token, account } = await guard("gmail", () => accessToken(gmail, { fetch, now }));
  const club = config.club?.trim().toLowerCase() || null;
  if (!isProduction(config.siteEnv) && account === club) {
    throw new MailRefused(`Outside production the club's account must never send (it's ${account}).`);
  }
  const safe = safeMail(mail, { siteEnv: config.siteEnv, safeTo: config.safeTo || account, allow: config.allow, club });
  // Production sends from the developer account but reads as the club: the club's address is that account's "Send
  // mail as" alias (ADR 0027), so replies go to the club inbox. Until the alias is verified, or while the club's address
  // isn't known, it's the account's own. Elsewhere the account is its own sender.
  const sender = isProduction(config.siteEnv) && club ? club : account;
  if (safe.to !== mail.to) {
    log.info("mail.redirected", { to: safe.to, originalTo: mail.to });
  }
  const id = await guard("gmail", async () => {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: base64url(mime(safe, sender)) }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string; errors?: { reason?: string }[] };
    };
    if (!res.ok || !body.id) {
      const reasons = (body.error?.errors ?? []).map((e) => e.reason ?? "");
      throw gmailError(`Gmail send: ${res.status} ${body.error?.message ?? "no message id"}`, res, reasons);
    }
    return body.id;
  });
  return { status: "sent", id, to: safe.to };
}

/**
 * Google's refusal as an error the circuit breaker understands: a rate limit or a spent sending limit pauses Gmail
 * (for Retry-After, else 15 minutes); another 4xx is ours to fix and doesn't count against Gmail.
 */
function gmailError(message: string, res: Response, reasons: string[] = []): Error {
  if (res.status === 429 || reasons.some((r) => /rateLimitExceeded|dailyLimitExceeded|quotaExceeded/.test(r)))
    return new QuotaError(message, retryAfter(res, 15 * 60_000));
  return new HttpFailure(message, res.status);
}

/** Until when sending is paused by the circuit breaker (epoch ms), or null when email should work. */
export const mailPausedUntil = () => pausedUntil("gmail");

// Header values come partly from a form, so no line breaks may get through (header injection).
const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const ADDRESS = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const address = (value: string) => {
  const a = clean(value);
  if (!ADDRESS.test(a)) throw new MailRefused(`Not an email address: ${JSON.stringify(a)}`);
  return a;
};

const utf8Base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const base64url = (text: string) => utf8Base64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// RFC 2047 encoded word, so names and subjects can be any language.
const encoded = (text: string) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${utf8Base64(text)}?=`);

/** The RFC 5322 message: UTF-8 text, base64 so long lines and accents survive; with an HTML part beside it if given. */
export function mime(mail: Mail & { headers?: Record<string, string> }, from: string): string {
  const headers = [
    `From: ${encoded(FROM_NAME)} <${address(from)}>`,
    `To: ${mail.to.map(address).join(", ")}`,
    ...(mail.replyTo ? [`Reply-To: ${address(mail.replyTo)}`] : []),
    `Subject: ${encoded(clean(mail.subject))}`,
    ...Object.entries(mail.headers ?? {}).map(([k, v]) => `${k}: ${encoded(clean(v))}`),
    "MIME-Version: 1.0",
  ];
  const text = part("text/plain", mail.text.replace(/\r?\n/g, "\r\n"));
  if (!mail.html) return [...headers, text].join("\r\n");
  // Base64 bodies can't contain "=_", so this boundary never appears inside a part.
  const boundary = "=_cougars_alt";
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    text,
    `--${boundary}`,
    part("text/html", mail.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// One body: its headers, a blank line, then the base64 in 76-character lines.
const part = (type: string, body: string) =>
  [
    `Content-Type: ${type}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(body).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
