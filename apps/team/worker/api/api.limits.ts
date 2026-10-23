// Rate limits for the team app's API (ADR 0055), best effort through the Workers Cache API (packages/shared/rate-limit.ts).
// Where there's no Cache API (a plain unit test) everything goes through; the per-member sign-in limits in D1 still
// hold. Generous: nobody tapping normally should see them. A whole squad on the rink's wifi shares one address, so a
// signed-in member is counted as themselves, not by where they are (#113); the address keeps a ceiling over them all.
import { rateLimit } from "@cougars/shared/rate-limit";
import { HttpError } from "./api.http";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("api");

export interface Limit {
  limit: number;
  windowSeconds: number;
}

export const LIMITS = {
  /** Every API request from one address with no session: sign-in, error reports, pages that aren't there, strangers. */
  perAddress: { limit: 600, windowSeconds: 60 },
  /** Session cookies from one address that turn out to be nobody's: refused before another is looked up in D1. */
  unknownSessions: { limit: 600, windowSeconds: 60 },
  /** Every API request by one signed-in member, wherever they are: a phone on a live page reloads once per change. */
  perMember: { limit: 600, windowSeconds: 60 },
  /** Every API request from one address, signed in or not: a club's worth of phones on one wifi, and no more. */
  addressCeiling: { limit: 6000, windowSeconds: 60 },
  /** Changes by one member: a tap is one, and nobody taps once a second for a minute. */
  writesPerMember: { limit: 60, windowSeconds: 60 },
  /** Asking for a sign-in code, from one address. */
  signIn: { limit: 10, windowSeconds: 600 },
  /** A passkey's challenge, from one address: the sign-in page asks for one as it opens, and again after a try. */
  passkey: { limit: 60, windowSeconds: 600 },
  /** The join form, from one address. */
  join: { limit: 5, windowSeconds: 3600 },
  /** "Send a test email", by one admin (Settings → Email). */
  testMail: { limit: 5, windowSeconds: 3600 },
} satisfies Record<string, Limit>;

export const addressOf = (request: Request) => request.headers.get("cf-connecting-ip") ?? "unknown";

/** Throws a 429 once `key` has used up `limit` in its window. `spend: false` only checks, without counting this one. */
export async function enforce(
  bucket: string,
  key: string,
  { limit, windowSeconds }: Limit,
  message: string,
  spend = true,
) {
  if (typeof caches === "undefined") return;
  const cache = await caches.open("team-rate-limit");
  const { allowed } = await rateLimit(cache, bucket, key, { limit, windowSeconds, spend });
  if (allowed) return;
  // A warning, not reported (ADR 0110): someone going too fast is the limit working, and a flood of them would spend
  // Sentry's 5k a month
  log.warn("rate_limit", { bucket, key });
  throw new HttpError(429, message);
}
