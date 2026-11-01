// Refresh photos and videos (#109, ADR 0016): an admin presses it in the team app's Settings → Website, which keeps
// the time in D1 (website_times.media_refreshed, packages/shared/website-times.ts). YouTube's and Instagram's copies
// read before then aren't fresh any more (cache.ts `freshAfter`), so the next visit in each data centre reads them
// again; the last good copy is still there if the source fails. The time itself is read through the cache for half a
// minute, so it costs one D1 read per half minute per data centre, and a press shows within a minute.
import { websiteTime } from "@cougars/shared/website-times";
import { scribe } from "@cougars/shared/scribe";
import { cached, type CacheDeps, type CacheOptions } from "./cache";

const log = scribe.logger("media-refresh");

export const REFRESH_CACHE: CacheOptions = { ttlMs: 30_000, staleMs: 24 * 60 * 60_000 };

/** When photos and videos were last refreshed, in ms; 0 for never, or if D1 can't say (the caches as they are). */
export async function mediaRefreshedAt(db: D1Database, deps?: CacheDeps): Promise<number> {
  try {
    const at = await cached("d1:media-refreshed", REFRESH_CACHE, () => websiteTime(db, "media_refreshed"), deps);
    return at ? Date.parse(at) : 0;
  } catch (error) {
    log.warn("media_refresh.read_error", error);
    return 0;
  }
}
