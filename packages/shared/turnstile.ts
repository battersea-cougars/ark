// Cloudflare Turnstile: did a person send the form? (docs/adr/0028-turnstile-and-auto-reply.md). Free, no cookies.
// The widget adds a token to the form; the server checks it once with Cloudflare. On the website's /join (as
// `cf-turnstile-response`) a missing or failed check doesn't stop the enquiry (the form must work without
// JavaScript): it's saved and the club is emailed, but there's no auto-reply. In the team app, asking for a sign-in
// code and asking to join are refused without one (apps/team/worker/auth/auth.turnstile.ts, #13).
import { scribe } from "./scribe";

const log = scribe.logger("turnstile");

export const TURNSTILE_FIELD = "cf-turnstile-response";
/**
 * The website's /join widget's action. Every form's widget has its own (the team app's are `sign-in` and `join`), so a
 * token from one is never accepted by another: the one Turnstile widget covers both sites (ADR 0028).
 */
export const ENQUIRY_ACTION = "enquiry";
export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * True only if Cloudflare confirms the token (and, given `action`, that the widget was rendered for it, so a token
 * from one form can't be spent on another). Never throws: any problem counts as not verified.
 */
export async function verifyTurnstile(
  token: unknown,
  secret: string | undefined,
  ip: string | undefined,
  { fetch = globalThis.fetch, action }: { fetch?: typeof globalThis.fetch; action?: string } = {},
): Promise<boolean> {
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const res = await fetch(SITEVERIFY, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json()) as { success?: boolean; action?: string; "error-codes"?: string[] };
    if (!body.success) log.info("turnstile.failed", { codes: body["error-codes"] ?? [] });
    else if (action && body.action !== action) log.info("turnstile.wrong_action", { action: body.action ?? null });
    return body.success === true && (!action || body.action === action);
  } catch (error) {
    log.error("turnstile.error", error);
    return false;
  }
}
