// The club's videos, read live (docs/adr/0016-photos-and-videos-read-live.md): a new upload or a Studio change shows within
// minutes, with no rebuild. Two cached reads, merged:
//   - Sanity: the club's YouTube settings and the `video` documents (overrides and pasted links). Fresh for a
//     minute, so Studio changes show quickly; Sanity's API CDN is cheap.
//   - YouTube: the club playlist or channel, without videos still processing (lib/youtube.ts). Fresh for ten
//     minutes, so a page view almost never costs quota and a video shows within ten minutes of being ready;
//     if YouTube fails, the last good list is shown for up to a day. An admin's Refresh photos and videos (team app,
//     Settings → Website) makes the next visit read it again (media-refresh.ts).
// Never throws. Without an API key, or before the club has a channel, it's the Sanity videos only.
import { cached, type CacheDeps, type CacheOptions } from "./cache";
import { sanityQuery, type Live, type SanityConfig } from "./sanity-live";
import { fetchSourceVideos, mergeVideos, sourceKey, videoSource, type VideoSource } from "../youtube";
import { DEMO_VIDEOS } from "../sanity/demo";
import * as q from "../sanity/queries";
import type { Club, Video, VideoOverride } from "../sanity/types";
import { scribe } from "@cougars/shared/scribe";
import { logFailure } from "@cougars/shared/breaker";

const log = scribe.logger("videos");

export interface VideosConfig {
  sanity: SanityConfig;
  /** YouTube Data API key: a Worker secret (or the build's environment). */
  youtubeKey?: string;
  demo?: boolean;
  /** When an admin last pressed Refresh photos and videos (ms, 0 for never; media-refresh.ts): YouTube's copy from
   * before then is read again. */
  refreshedAt?: () => Promise<number>;
}

export const SANITY_CACHE = { ttlMs: 60_000, staleMs: 60 * 60_000 };
export const YOUTUBE_CACHE = { ttlMs: 10 * 60_000, staleMs: 24 * 60 * 60_000 };

type ClubYoutube = Pick<Club, "socials" | "youtubeChannelId" | "youtubePlaylists">;
interface SanityVideoData {
  club: ClubYoutube | null;
  videos: VideoOverride[] | null;
}

/** The website's video list: YouTube plus Sanity, merged (hidden dropped, pinned first, then newest). */
export async function liveVideos(
  config: VideosConfig,
  deps: CacheDeps & { fetch?: typeof globalThis.fetch } = {},
): Promise<Live<Video[]>> {
  const { fetch, ...cacheDeps } = deps;
  let unavailable = false;
  let data: SanityVideoData = { club: null, videos: [] };
  if (config.sanity.projectId) {
    try {
      const key = `sanity:${config.sanity.projectId}:${config.sanity.dataset}:videos`;
      data = await cached(
        key,
        SANITY_CACHE,
        () => sanityQuery<SanityVideoData>(config.sanity, q.VIDEO_DATA),
        cacheDeps,
      );
    } catch (error) {
      logFailure(log, "videos.sanity_error", error);
      unavailable = true;
    }
  }

  const source = data.club ? videoSource(data.club) : null;
  const youtubeCache = { ...YOUTUBE_CACHE, freshAfter: (await config.refreshedAt?.()) ?? 0 };
  const channel =
    source && config.youtubeKey ? await youtubeVideos(source, config.youtubeKey, youtubeCache, cacheDeps, fetch) : [];
  const videos = mergeVideos(channel, data.videos ?? []);
  if (config.demo && videos.length === 0) return { data: DEMO_VIDEOS, unavailable: false };
  return { data: videos, unavailable: unavailable && videos.length === 0 };
}

async function youtubeVideos(
  source: VideoSource,
  key: string,
  options: CacheOptions,
  deps: CacheDeps,
  fetch?: typeof globalThis.fetch,
): Promise<Video[]> {
  try {
    return await cached(`youtube:${sourceKey(source)}`, options, () => fetchSourceVideos(source, key, { fetch }), deps);
  } catch (error) {
    // Message never contains the key (lib/youtube.ts). The Sanity videos still show, but the channel's are gone from
    // the page (no copy left within the cache's stale time): an error, so a broken key or a dead channel is heard of
    logFailure(log, "videos.youtube_error", error, { source: sourceKey(source) });
    return [];
  }
}
