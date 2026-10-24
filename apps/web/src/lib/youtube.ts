import { HttpFailure, QuotaError, guard, nextMidnight, retryAfter } from "@cougars/shared/breaker";
import { londonDay } from "./dates";
import type { Video, VideoOverride } from "./sanity/types";

/** Extract the 11-char video id from any common YouTube URL form, or null. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^(www\.|m\.)/, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1] ?? null;
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export const thumbnailUrl = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const embedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;

// ---------------------------------------------------------------------------------------------------------------
// The club's videos from YouTube, read live and cached (lib/server/videos.ts, docs/adr/0016-photos-and-videos-read-live.md).
// YouTube Data API v3 with an API key: a club playlist is read directly; a channel costs one `channels` call to find
// its uploads playlist first. Then, per 50 videos, one `playlistItems` call and one `videos` call asking which are
// done processing (a video is in the playlist from the moment its upload starts). Each call is 1 unit of the free
// 10,000 a day.

export type Channel = { handle: string } | { id: string };

/** The channel in a club YouTube link: youtube.com/@handle, youtube.com/channel/UC..., or a bare "@handle". */
export function parseChannel(url: string): Channel | null {
  const s = url.trim();
  if (/^@[\w.-]{3,30}$/.test(s)) return { handle: s.slice(1) };
  try {
    const u = new URL(s);
    if (!/^(www\.|m\.)?youtube\.com$/.test(u.hostname)) return null;
    const handle = u.pathname.match(/^\/@([\w.-]{3,30})(?:\/|$)/)?.[1];
    if (handle) return { handle: decodeURIComponent(handle) };
    const id = u.pathname.match(/^\/channel\/(UC[\w-]{22})(?:\/|$)/)?.[1];
    return id ? { id } : null;
  } catch {
    return null;
  }
}

/** A playlist ID, from the ID itself or any YouTube link with `list=` in it. */
export function parsePlaylist(input: string): string | null {
  const s = input.trim();
  if (/^(PL|OL|UU|FL)[\w-]{10,}$/.test(s)) return s;
  try {
    const id = new URL(s).searchParams.get("list");
    return id && /^[\w-]{12,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Where the club's videos come from: its playlists if any are set (they may hold unlisted videos), otherwise the
 * channel's public uploads, from the channel ID or the channel link. Null when there's neither.
 */
export interface Playlist {
  id: string;
  label: string | null;
}
export type VideoSource = { playlists: Playlist[] } | { channel: Channel };
export function videoSource(club: {
  youtubePlaylists?: { url?: string | null; label?: string | null }[] | null;
  youtubeChannelId?: string | null;
  socials?: { youtube?: string | null };
}): VideoSource | null {
  const playlists = (club.youtubePlaylists ?? []).flatMap((p) => {
    const id = p.url ? parsePlaylist(p.url) : null;
    return id ? [{ id, label: p.label?.trim() || null }] : [];
  });
  if (playlists.length) return { playlists };
  if (club.youtubeChannelId) return { channel: { id: club.youtubeChannelId } };
  const channel = club.socials?.youtube ? parseChannel(club.socials.youtube) : null;
  return channel ? { channel } : null;
}

/** A stable name for a source, for cache keys and logs. */
export const sourceKey = (source: VideoSource) =>
  "playlists" in source
    ? `playlists:${source.playlists.map((p) => `${p.id}=${p.label ?? ""}`).join(",")}`
    : "handle" in source.channel
      ? `handle:${source.channel.handle}`
      : `channel:${source.channel.id}`;

const API = "https://www.googleapis.com/youtube/v3";
const PAGE = 50; // the API's maximum per page

interface PlaylistItem {
  snippet?: { title?: string; description?: string; publishedAt?: string; resourceId?: { videoId?: string } };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
  status?: { privacyStatus?: string };
}

/**
 * A playlist item as a Video, or null for private and deleted ones. Unlisted videos only count when
 * `unlisted` is set: the club put them in its playlist on purpose, whereas a channel's uploads list them too.
 */
export function toVideo(item: PlaylistItem, { unlisted = false } = {}): Video | null {
  const id = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
  // Deleted videos have no videoPublishedAt; private ones (and unlisted uploads) aren't for the website.
  const published = item.contentDetails?.videoPublishedAt;
  const privacy = item.status?.privacyStatus;
  if (!id || !published || !(privacy === "public" || (unlisted && privacy === "unlisted"))) return null;
  return {
    _id: `youtube-${id}`,
    ...tidyTitle(item.snippet?.title ?? "", londonDay(published)),
    youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
    description: firstParagraph(item.snippet?.description),
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
const SEP = String.raw`[\s\-–—:|·,]*`;
const DATES: [RegExp, (m: RegExpMatchArray) => [string, string, string]][] = [
  // 2nd October 2026, 2 Oct 2026
  [new RegExp(String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH},?\s+(\d{4})`, "i"), (m) => [m[3], m[2], m[1]]],
  // October 2nd, 2026
  [new RegExp(String.raw`${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`, "i"), (m) => [m[3], m[1], m[2]]],
  // 2026-10-02
  [/(\d{4})-(\d{2})-(\d{2})/, (m) => [m[1], m[2], m[3]]],
  // 02/10/2026 or 2.10.26 (UK order)
  [/(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/, (m) => [m[3].length === 2 ? `20${m[3]}` : m[3], m[2], m[1]]],
];

/**
 * A YouTube title as the card shows it: without the club's name (the whole site is the club) and without the date
 * (the card shows that separately). A date in the title is when it was filmed, so it's the recorded date; otherwise
 * the upload date. If nothing's left, the video is named after its day.
 */
export function tidyTitle(raw: string, published: string): { title: string; recordedOn: string } {
  // "Battersea Cougars - …", not "Cougars v Lions": the name goes only when a separator follows it.
  let title = raw.trim().replace(new RegExp(String.raw`^(battersea\s+)?cougars\s*([-–—:|·,]${SEP}|$)`, "i"), "");
  let recordedOn = published;
  for (const [pattern, parts] of DATES) {
    const m = title.match(pattern);
    if (!m) continue;
    const [y, mo, d] = parts(m);
    const month = /^\d+$/.test(mo) ? Number(mo) : MONTHS.indexOf(mo.slice(0, 3).toLowerCase()) + 1;
    const day = `${y}-${String(month).padStart(2, "0")}-${d.padStart(2, "0")}`;
    // A real date, and not after the upload: otherwise it's a typo, so keep the upload date.
    const date = new Date(`${day}T12:00:00Z`);
    if (!isNaN(+date) && date.toISOString().startsWith(day) && day <= published) recordedOn = day;
    title = title.replace(m[0], " ");
    break;
  }
  title = title
    .replace(new RegExp(String.raw`^${SEP}|${SEP}$`, "g"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();
  const friday = new Date(`${recordedOn}T12:00:00Z`).getUTCDay() === 5;
  return { title: title || (friday ? "Friday session" : "Cougars video"), recordedOn };
}

// YouTube descriptions often end in links and hashtags; the card only has room for the opening lines.
const firstParagraph = (text?: string) =>
  text
    ?.trim()
    .split(/\n\s*\n/)[0]
    .trim() || null;

interface FetchOptions {
  max?: number;
  fetch?: typeof globalThis.fetch;
}

type ApiError = { error?: { message?: string; errors?: { reason?: string }[] } };

/**
 * YouTube's refusal as an error the circuit breaker understands (ADR 0055): a spent daily quota pauses YouTube until
 * it resets at midnight Pacific time; a rate limit for a minute.
 */
export function youtubeError(path: string, res: Response, body: ApiError, now = Date.now()): Error {
  const message = `YouTube ${path}: ${res.status} ${body.error?.message ?? res.statusText}`;
  const reasons = (body.error?.errors ?? []).map((e) => e.reason);
  if (reasons.some((r) => r === "quotaExceeded" || r === "dailyLimitExceeded"))
    return new QuotaError(message, nextMidnight("America/Los_Angeles", now));
  if (res.status === 429 || reasons.some((r) => r === "rateLimitExceeded" || r === "userRateLimitExceeded"))
    return new QuotaError(message, retryAfter(res, 60_000, now));
  return new HttpFailure(message, res.status);
}

// One API call, behind YouTube's circuit breaker. Throws on any API or network error (or while paused), with a
// message that never contains the key.
const apiGet =
  (key: string, fetch: typeof globalThis.fetch) =>
  <T>(path: string, params: Record<string, string>): Promise<T> =>
    guard("youtube", async () => {
      const res = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key })}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as T & ApiError;
      if (!res.ok) throw youtubeError(path, res, body);
      return body;
    });

/**
 * Which of these videos YouTube has finished processing (one `videos` call, at most 50 ids). A video sits in its
 * playlist while it's still uploading or processing, with a grey placeholder for a thumbnail and nothing to play;
 * its `uploadStatus` is "uploaded" then, and "processed" once it's ready. Failed, rejected and deleted uploads, and
 * any the API doesn't return, never count. (`processingDetails` would say more, but only to the channel's owner.)
 */
async function processedIds(get: ReturnType<typeof apiGet>, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { items = [] } = await get<{ items?: { id?: string; status?: { uploadStatus?: string } }[] }>("videos", {
    part: "status",
    id: ids.join(","),
    maxResults: String(PAGE),
  });
  return new Set(items.flatMap((v) => (v.id && v.status?.uploadStatus === "processed" ? [v.id] : [])));
}

/**
 * A playlist's videos in playlist order, at most `max`, leaving out any YouTube is still processing. Unlisted ones
 * count when `unlisted` is set. Throws.
 */
export async function fetchPlaylistVideos(
  playlistId: string,
  key: string,
  { max = 200, fetch = globalThis.fetch, unlisted = false }: FetchOptions & { unlisted?: boolean } = {},
): Promise<Video[]> {
  const get = apiGet(key, fetch);
  const videos: Video[] = [];
  let pageToken: string | undefined;
  do {
    const page = await get<{ items?: PlaylistItem[]; nextPageToken?: string }>("playlistItems", {
      part: "snippet,contentDetails,status",
      playlistId,
      maxResults: String(PAGE),
      ...(pageToken ? { pageToken } : {}),
    });
    const listed = (page.items ?? []).flatMap((item) => toVideo(item, { unlisted }) ?? []);
    const ready = await processedIds(
      get,
      listed.map((v) => youtubeId(v.youtubeUrl)!),
    );
    videos.push(...listed.filter((v) => ready.has(youtubeId(v.youtubeUrl)!)));
    pageToken = page.nextPageToken;
  } while (pageToken && videos.length < max);
  return videos.slice(0, max);
}

/** The channel's public uploads, newest first, at most `max`. Throws. */
export async function fetchChannelVideos(
  channel: Channel,
  key: string,
  { max = 200, fetch = globalThis.fetch }: FetchOptions = {},
): Promise<Video[]> {
  const get = apiGet(key, fetch);
  const which: Record<string, string> = "handle" in channel ? { forHandle: `@${channel.handle}` } : { id: channel.id };
  const { items = [] } = await get<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>(
    "channels",
    { part: "contentDetails", ...which },
  );
  const uploads = items[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`YouTube channel not found: ${JSON.stringify(which)}`);
  return fetchPlaylistVideos(uploads, key, { max, fetch });
}

/**
 * The videos from a source: the club playlists (unlisted ones included), each video labelled with its playlist, or
 * a channel's public uploads. A video in two playlists is listed once, under the first. Throws if any call fails.
 */
export async function fetchSourceVideos(source: VideoSource, key: string, options: FetchOptions = {}) {
  if (!("playlists" in source)) return fetchChannelVideos(source.channel, key, options);
  const lists = await Promise.all(
    source.playlists.map(async ({ id, label }) =>
      (await fetchPlaylistVideos(id, key, { ...options, unlisted: true })).map((v) => ({ ...v, label })),
    ),
  );
  const byId = new Map<string, Video>();
  for (const v of lists.flat()) if (!byId.has(v._id)) byId.set(v._id, v);
  return [...byId.values()];
}

/**
 * Channel videos plus Sanity `video` documents, for the website. A document with the same YouTube id overrides the
 * channel video field by field (empty fields keep YouTube's); one with no match adds a video. Hidden ones are
 * dropped. Pinned first, then newest first.
 */
export function mergeVideos(channel: Video[], overrides: VideoOverride[]): Video[] {
  const byId = new Map<string, Video & { hidden?: boolean; pinned?: boolean }>();
  for (const v of channel) byId.set(youtubeId(v.youtubeUrl)!, v);
  for (const o of overrides) {
    const id = youtubeId(o.youtubeUrl);
    if (!id) continue;
    const base = byId.get(id);
    byId.set(id, {
      _id: o._id,
      title: o.title || base?.title || "Cougars video",
      recordedOn: o.recordedOn || base?.recordedOn || londonDay(o._createdAt ?? new Date().toISOString()),
      youtubeUrl: base?.youtubeUrl ?? o.youtubeUrl,
      description: o.description || base?.description || null,
      label: base?.label ?? null,
      hidden: !!o.hidden,
      pinned: !!o.pinned,
    });
  }
  return [...byId.values()]
    .filter((v) => !v.hidden)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || day(b.recordedOn).localeCompare(day(a.recordedOn)))
    .map(({ hidden: _h, pinned: _p, ...v }) => v);
}

// Sanity dates are "YYYY-MM-DD"; older documents and demo videos may hold a full timestamp.
const day = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : londonDay(d));
