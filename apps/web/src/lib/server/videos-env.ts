// The videos' settings for live routes (/videos, the home page's reel): the build's (sanity-env.ts) and, since only a
// request has the database, when an admin last pressed Refresh photos and videos (media-refresh.ts, #109).
import { env } from "cloudflare:workers";
import { mediaRefreshedAt } from "./media-refresh";
import { videosConfig } from "./sanity-env";
import type { VideosConfig } from "./videos";

export const liveVideosConfig = (): VideosConfig => ({
  ...videosConfig(),
  refreshedAt: () => mediaRefreshedAt(env.DB),
});
