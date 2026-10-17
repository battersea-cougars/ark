// The deploy's smoke test of the "Try a session" form (scripts/ci/smoke-test.mjs, ADR 0027): a real enquiry, sent with
// the SMOKE_TOKEN secret in a header, that runs the whole path (saved, both emails sent) and leaves nothing behind.
// Its emails go only to the sending account, in production too, and its row is deleted at once. Without the right
// token a request is an ordinary enquiry, so nobody else can make the club send these.
import type { MailConfig } from "@cougars/shared/email";

export const SMOKE_HEADER = "X-Cougars-Smoke";

/** Whether this request carries the smoke token. Compared in constant time; no token set means never. */
export function isSmoke(request: Request, token: string | undefined): boolean {
  const given = request.headers.get(SMOKE_HEADER);
  if (!token || !given) return false;
  const [a, b] = [new TextEncoder().encode(given), new TextEncoder().encode(token)];
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * How a smoke test's emails go: as anywhere outside production, every one to the sending account itself (safeMail),
 * never to the club or the address on the form, whatever environment this is.
 */
export const smokeMailConfig = (config: MailConfig): MailConfig => ({
  ...config,
  siteEnv: "smoke",
  safeTo: null,
  allow: [],
});
