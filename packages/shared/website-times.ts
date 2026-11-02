// When something last happened to the website (db/schema.sql website_times): the team app writes them, the website
// reads one.
import { first, run } from "./d1";

/**
 * `rebuild_sent`: the last rebuild the team app asked GitHub for (apps/team/worker/website, ADR 0016).
 * `media_refreshed`: an admin pressed Refresh photos and videos (Settings → Website). The website's copies of YouTube
 * and Instagram read before then aren't fresh any more (apps/web/src/lib/server/cache.ts `freshAfter`), so the next
 * visit in each data centre reads them again; the last good copy is still kept.
 */
export type WebsiteTime = "rebuild_sent" | "media_refreshed";

/** When `name` last happened, as an ISO time, or null for never. */
export async function websiteTime(db: D1Database, name: WebsiteTime): Promise<string | null> {
  const row = await first<{ at: string }>(db, "SELECT at FROM website_times WHERE name = ?", [name]);
  return row?.at ?? null;
}

/** `name` happened at `now`. */
export const markWebsiteTime = (db: D1Database, name: WebsiteTime, now: Date) =>
  run(db, "INSERT INTO website_times (name, at) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET at = excluded.at", [
    name,
    now.toISOString(),
  ]);
