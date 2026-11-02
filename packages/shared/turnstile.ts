// Cloudflare Turnstile: did a person send the form? (ADR 0027). Free, no cookies: the widget adds a token to the form
// and the server checks it once with Cloudflare. On the website's /join a missing or failed check only skips the
// auto-reply (the form must work without JavaScript); in the team app, asking for a sign-in code or to join is
// refused without one (apps/team/worker/auth/auth.turnstile.ts).
import { scribe } from "./scribe";

const log = scribe.logger("turnstile");

export const TURNSTILE_FIELD = "cf-turnstile-response";
/**
 * The website's /join widget's action. Every form's widget has its own (the team app's are `sign-in` and `join`), so a
 * token from one is never accepted by another: the one Turnstile widget covers both sites (ADR 0027).
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
