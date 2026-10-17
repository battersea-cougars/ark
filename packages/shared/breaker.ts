// Circuit breakers for the outside services we call: Sanity, YouTube, Gmail (ADR 0055). When a service is down or
// has told us to stop (a spent quota, a rate limit), we stop calling it for a while instead of failing every request
// against it, which wastes time and, for a quota, can keep it spent. Callers fall back as they do for any failure:
// the last good copy (lib/server/cache.ts), an empty state, or "email isn't working right now".
//
//   - A quota or rate-limit answer (QuotaError) opens the breaker until that quota resets.
//   - Three failures in a row (network, timeout, 5xx) open it for 30 seconds, doubling each time it trips again, up
//     to 15 minutes. A 4xx other than a quota is our mistake, not the service's, and doesn't count.
//   - After the time is up, the next call is a trial: success closes the breaker, failure opens it again.
//
// The open state is kept in this isolate's memory and in the Workers Cache API, so every isolate in a data centre
// sees it. Like packages/shared/rate-limit.ts, best effort: the Cache API only works on a custom domain.
import { scribe } from "./scribe";

const log = scribe.logger("breaker");

export class BreakerOpen extends Error {
  override name = "BreakerOpen";
  constructor(
    readonly service: string,
    readonly until: number,
  ) {
    super(`${service} is paused until ${new Date(until).toISOString()} (circuit breaker)`);
  }
}

/** The service said stop until `until` (epoch ms): a spent quota or a rate limit. */
export class QuotaError extends Error {
  override name = "QuotaError";
  constructor(
    message: string,
    readonly until: number,
  ) {
    super(message);
  }
}

/** The service answered with an error status. 5xx counts towards opening the breaker; other 4xx don't. */
export class HttpFailure extends Error {
  override name = "HttpFailure";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type EdgeCache = Pick<Cache, "match" | "put" | "delete">;

export interface BreakerDeps {
  now?: () => number;
  /** Shared state between isolates, or null for memory only. Defaults to Cloudflare's `caches.default`. */
  edge?: EdgeCache | null;
}

const FAILURES = 3;
const FIRST_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 15 * 60_000;

interface State {
  failures: number;
  openUntil: number;
  cooldownMs: number;
}

const states = new Map<string, State>();
const stateOf = (service: string): State => {
  let s = states.get(service);
  if (!s) states.set(service, (s = { failures: 0, openUntil: 0, cooldownMs: FIRST_COOLDOWN_MS }));
  return s;
};

const edgeUrl = (service: string) => `https://breaker.cougars.internal/${encodeURIComponent(service)}`;
const defaultEdge = (): EdgeCache | null => (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;

/** Until when the service is paused (epoch ms), or null if calls may go ahead. */
export async function pausedUntil(
  service: string,
  { now = Date.now, edge = defaultEdge() }: BreakerDeps = {},
): Promise<number | null> {
  const s = stateOf(service);
  if (s.openUntil > now()) return s.openUntil;
  if (!edge) return null;
  try {
    const hit = await edge.match(edgeUrl(service));
    const until = hit ? Number(await hit.text()) : 0;
    if (until > now()) {
      s.openUntil = until;
      return until;
    }
  } catch {
    // the edge cache is an optimisation: never let it break a call
  }
  return null;
}

/** Run `call` unless the service is paused; throws BreakerOpen if it is. Records the outcome. */
export async function guard<T>(service: string, call: () => Promise<T>, deps: BreakerDeps = {}): Promise<T> {
  const { now = Date.now, edge = defaultEdge() } = deps;
  const until = await pausedUntil(service, { now, edge });
  if (until) throw new BreakerOpen(service, until);
  const s = stateOf(service);
  try {
    const value = await call();
    if (s.failures || s.openUntil) {
      Object.assign(s, { failures: 0, openUntil: 0, cooldownMs: FIRST_COOLDOWN_MS });
      await edge?.delete(edgeUrl(service)).catch(() => false);
    }
    return value;
  } catch (error) {
    if (error instanceof QuotaError) await open(service, s, error.until, edge, now, String(error));
    // A breaker that has tripped before (and not closed since) reopens on the trial call's failure
    else if (!(error instanceof HttpFailure && error.status < 500) && ++s.failures >= (tripped(s) ? 1 : FAILURES)) {
      await open(service, s, now() + s.cooldownMs, edge, now, String(error));
      s.cooldownMs = Math.min(s.cooldownMs * 2, MAX_COOLDOWN_MS);
    }
    throw error;
  }
}

const tripped = (s: State) => s.cooldownMs > FIRST_COOLDOWN_MS;

async function open(service: string, s: State, until: number, edge: EdgeCache | null, now: () => number, why: string) {
  s.openUntil = until;
  s.failures = 0;
  log.warn("breaker.open", { service, until: new Date(until).toISOString(), error: why });
  if (!edge) return;
  const maxAge = Math.max(1, Math.ceil((until - now()) / 1000));
  try {
    await edge.put(
      edgeUrl(service),
      new Response(String(until), { headers: { "Cache-Control": `max-age=${maxAge}` } }),
    );
  } catch {
    // as above
  }
}

/** Retry-After (seconds or a date) as epoch ms, or `fallbackMs` from now. */
export function retryAfter(res: Response, fallbackMs: number, now = Date.now()): number {
  const h = res.headers.get("retry-after");
  if (h && /^\d+$/.test(h)) return now + Number(h) * 1000;
  const date = h ? Date.parse(h) : NaN;
  return isNaN(date) ? now + fallbackMs : date;
}

/** The next midnight in a time zone, as epoch ms: when a daily quota resets (YouTube's is Pacific time). */
export function nextMidnight(timeZone: string, now = Date.now()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  );
  const sinceMidnight = ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000;
  return now - sinceMidnight - (now % 1000) + 86_400_000;
}

/** Forget every breaker (tests). */
export const resetBreakers = () => states.clear();
