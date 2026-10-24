// What Settings → Website shows (#107): when the site was last rebuilt from the app, whether one is on its way, when
// its photos and videos were last refreshed (#109), and
// where the site and its Studio are for this environment (ADR 0010, ADR 0112).
import { first } from "@cougars/shared/d1";
import { websiteTime } from "@cougars/shared/website-times";
import { canRebuild, type WebsiteEnv } from "./website";

const ADDRESSES = {
  production: { siteUrl: "https://batterseacougars.com", studioUrl: "https://studio.batterseacougars.com" },
  dev: { siteUrl: "https://web.cougars-dev.workers.dev", studioUrl: "https://studio.cougars-dev.workers.dev" },
  // A laptop: the show switch's ports (ADR 0115)
  local: { siteUrl: "http://localhost:4500", studioUrl: "http://localhost:4520" },
};

export interface WebsiteStatus {
  /** The last rebuild the app asked GitHub for: a result's, or Rebuild now. */
  lastRebuildAt: string | null;
  /** One is waiting to be sent: a result changed in the last five minutes, or GitHub couldn't be reached. */
  rebuildWanted: boolean;
  /** When an admin last pressed Refresh photos and videos (#109). */
  mediaRefreshedAt: string | null;
  /** This Worker asks GitHub (a laptop's never does). */
  canRebuild: boolean;
  siteUrl: string;
  studioUrl: string;
}

const addressesOf = (env: WebsiteEnv) =>
  env.SITE_ENV === "production" ? ADDRESSES.production : env.SITE_ENV === "dev" ? ADDRESSES.dev : ADDRESSES.local;

export async function websiteStatus(env: WebsiteEnv): Promise<WebsiteStatus> {
  const [lastRebuildAt, mediaRefreshedAt, wanted] = await Promise.all([
    websiteTime(env.DB, "rebuild_sent"),
    websiteTime(env.DB, "media_refreshed"),
    first<{ id: number }>(env.DB, "SELECT id FROM website_rebuild WHERE id = 1"),
  ]);
  return {
    lastRebuildAt,
    rebuildWanted: !!wanted,
    mediaRefreshedAt,
    canRebuild: canRebuild(env),
    ...addressesOf(env),
  };
}
