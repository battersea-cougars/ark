// A small cache for the Worker's live reads (YouTube, Sanity), so a page view doesn't cost an API call
// (docs/adr/0016-photos-and-videos-read-live.md). Three layers, cheapest first:
//   1. This isolate's memory. Workers keep an isolate alive between requests, so most views stop here.
//   2. Cloudflare's edge cache (Cache API), shared by every isolate in a data centre. It only works on a custom
//      domain; on *.workers.dev its calls do nothing, which is fine.
//   3. The source itself. Concurrent misses share one fetch.
// If the source fails, the last good value is served for up to `staleMs`, so a YouTube outage or a spent quota
// shows yesterday's list rather than nothing. Every live read goes through here (ADR 0053); the sources themselves
// are behind circuit breakers (packages/shared/breaker.ts, ADR 0055).
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("cache");

interface Entry<T> {
  value: T;
  at: number;
}

export interface CacheOptions {
  /** How long a value is fresh. */
  ttlMs: number;
  /** How long an expired value may still be served when the source fails. */
  staleMs?: number;
}

/** What the cache needs from the outside world, so tests can control time and the edge cache. */
export interface CacheDeps {
  now?: () => number;
  /** The edge cache, or null to skip it. Defaults to Cloudflare's `caches.default` where it exists. */
  edge?: Pick<Cache, "match" | "put"> | null;
}

// Bounded, so made-up addresses (a player id, a picture id) can't grow it forever; the oldest goes first.
const MAX_ENTRIES = 500;
const memory = new Map<string, Entry<unknown>>();
function remember(key: string, entry: Entry<unknown>) {
  memory.delete(key);
  memory.set(key, entry);
  if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
}
const inFlight = new Map<string, Promise<unknown>>();

// The edge cache stores Responses under URLs; this host is never fetched, it only names entries.
const edgeUrl = (key: string) => `https://cache.cougars.internal/${encodeURIComponent(key)}`;

const defaultEdge = (): Pick<Cache, "match" | "put"> | null =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;

/**
 * The value for `key`: from memory or the edge cache while fresh, otherwise from `load`. Throws only when `load`
 * fails and there's no value within `staleMs` to fall back on.
 */
export async function cached<T>(
  key: string,
  { ttlMs, staleMs = 0 }: CacheOptions,
  load: () => Promise<T>,
  { now = Date.now, edge = defaultEdge() }: CacheDeps = {},
): Promise<T> {
  const hit = memory.get(key) as Entry<T> | undefined;
  if (hit && now() - hit.at < ttlMs) return hit.value;

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const refresh = (async () => {
    const shared = await edgeGet<T>(edge, key);
    if (shared && now() - shared.at < ttlMs) {
      remember(key, shared);
      return shared.value;
    }
    try {
      const entry = { value: await load(), at: now() };
      remember(key, entry);
      await edgePut(edge, key, entry, ttlMs + staleMs);
      return entry.value;
    } catch (error) {
      const last = [hit, shared].filter((e): e is Entry<T> => !!e).sort((a, b) => b.at - a.at)[0];
      if (last && now() - last.at < ttlMs + staleMs) {
        // A warning, not reported: the last good copy is served. Once that's too old the caller reports the failure.
        // A paused source (circuit breaker) was logged once when it paused
        if ((error as Error)?.name !== "BreakerOpen") log.warn("cache.stale", error, { key });
        return last.value;
      }
      throw error;
    }
  })();
  inFlight.set(key, refresh);
  try {
    return await refresh;
  } finally {
    inFlight.delete(key);
  }
}

async function edgeGet<T>(edge: CacheDeps["edge"], key: string): Promise<Entry<T> | null> {
  if (!edge) return null;
  try {
    const res = await edge.match(edgeUrl(key));
    return res ? ((await res.json()) as Entry<T>) : null;
  } catch {
    return null; // the edge cache is an optimisation: never let it break a page
  }
}

async function edgePut<T>(edge: CacheDeps["edge"], key: string, entry: Entry<T>, keepMs: number): Promise<void> {
  if (!edge) return;
  try {
    const maxAge = Math.ceil(keepMs / 1000);
    await edge.put(edgeUrl(key), Response.json(entry, { headers: { "Cache-Control": `max-age=${maxAge}` } }));
  } catch {
    // as above
  }
}

/** Forget everything (tests). */
export function clearCache(): void {
  memory.clear();
  inFlight.clear();
}
