// Refresh photos and videos (ADR 0016): when an admin last pressed it in the team app's Settings → Website (kept in
// D1, packages/shared/website-times.ts). YouTube's and Instagram's copies read before then aren't fresh any more
// (cache.ts `freshAfter`); the last good copy still stands if the source fails.
import { websiteTime } from "@cougars/shared/website-times";
import { scribe } from "@cougars/shared/scribe";
import { cached, type CacheDeps, type CacheOptions } from "./cache";

const log = scribe.logger("media-refresh");

// Half a minute: one D1 read per half minute per data centre, and a press shows within a minute
export const REFRESH_CACHE: CacheOptions = { ttlMs: 30_000, staleMs: 24 * 60 * 60_000 };

/** When photos and videos were last refreshed, in ms; 0 for never, or if D1 can't say (the caches as they are). */
export async function mediaRefreshedAt(db: D1Database, deps?: CacheDeps): Promise<number> {
  try {
    const at = await cached("d1:media-refreshed", REFRESH_CACHE, () => websiteTime(db, "media_refreshed"), deps);
    return at ? Date.parse(at) : 0;
  } catch (error) {
    // A warning, not reported: the photos and videos are served as cached (a refresh shows a little later), and D1
    // failing is reported by the pages that need it (What's on, events)
    log.warn("media_refresh.read_error", error);
    return 0;
  }
}
