// Rate limits for the team app's API (ADR 0055), best effort through the Workers Cache API (packages/shared/rate-limit.ts).
// Where there's no Cache API (a plain unit test) everything goes through; the per-member sign-in limits in D1 still
// hold. Generous: a whole squad on the rink's wifi shares one address, and nobody tapping normally should see them.
import { rateLimit } from "@cougars/shared/rate-limit";
import { HttpError } from "./api.http";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("api");

export interface Limit {
  limit: number;
  windowSeconds: number;
}

export const LIMITS = {
  /** Every API request from one address. */
  perAddress: { limit: 600, windowSeconds: 60 },
  /** Changes by one member: a tap is one, and nobody taps once a second for a minute. */
  writesPerMember: { limit: 60, windowSeconds: 60 },
  /** Asking for a sign-in code, from one address. */
  signIn: { limit: 10, windowSeconds: 600 },
  /** A passkey's challenge, from one address: the sign-in page asks for one as it opens, and again after a try. */
  passkey: { limit: 60, windowSeconds: 600 },
  /** The join form, from one address. */
  join: { limit: 5, windowSeconds: 3600 },
} satisfies Record<string, Limit>;

export const addressOf = (request: Request) => request.headers.get("cf-connecting-ip") ?? "unknown";

/** Throws a 429 once `key` has used up `limit` in its window. */
export async function enforce(bucket: string, key: string, { limit, windowSeconds }: Limit, message: string) {
  if (typeof caches === "undefined") return;
  const { allowed } = await rateLimit(await caches.open("team-rate-limit"), bucket, key, { limit, windowSeconds });
  if (allowed) return;
  log.warn("rate_limit", { bucket, key });
  throw new HttpError(429, message);
}
