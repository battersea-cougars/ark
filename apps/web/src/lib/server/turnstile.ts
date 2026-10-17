// Cloudflare Turnstile: did a person send the form? (docs/adr/0028-turnstile-and-auto-reply.md). Free, no cookies.
// The widget on /join adds its token to the form as `cf-turnstile-response`; the server checks it once with
// Cloudflare. A missing or failed check doesn't stop the enquiry (the form must work without JavaScript): it's
// saved and the club is emailed, but there's no auto-reply.
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("turnstile");

export const TURNSTILE_FIELD = "cf-turnstile-response";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** True only if Cloudflare confirms the token. Never throws: any problem counts as not verified. */
export async function verifyTurnstile(
  token: FormDataEntryValue | null,
  secret: string | undefined,
  ip: string | undefined,
  { fetch = globalThis.fetch } = {},
): Promise<boolean> {
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const res = await fetch(SITEVERIFY, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!body.success) log.info("turnstile.failed", { codes: body["error-codes"] ?? [] });
    return body.success === true;
  } catch (error) {
    log.error("turnstile.error", error);
    return false;
  }
}
