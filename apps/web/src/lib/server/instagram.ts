// The club's photos: its Instagram posts, read live (ADR 0113). Admins post on Instagram; the website shows the newest,
// within ten minutes. Read through Instagram's API with the club's token (instagram-token.ts), behind a circuit
// breaker (ADR 0055) and cached (ADR 0053): fresh for ten minutes, the last good copy for three days if Instagram
// fails. Pictures are served through our own Worker (/api/photos/<id>): Instagram's addresses expire, and visitors'
// browsers never contact Meta. Before the club connects its account, a sample feed stands in outside production.
import { HttpFailure, QuotaError, guard, logFailure } from "@cougars/shared/breaker";
import { scribe } from "@cougars/shared/scribe";
import { cached, type CacheDeps, type CacheOptions } from "./cache";
import { FAKE_POSTS } from "./instagram.fake";

export { FAKE_POSTS };

const log = scribe.logger("instagram");

export interface Post {
  id: string;
  kind: "image" | "video" | "album";
  /** The picture: our own address for it, or the sample's */
  image: string;
  caption: string | null;
  /** The caption's first sentence, else a plain description */
  alt: string;
  /** The post on Instagram */
  href: string;
  takenAt: string;
  /** An album's number of photos */
  count?: number;
}

export type Live<T> = { data: T; unavailable: boolean };

export interface InstagramConfig {
  /** The token to read with, or null before the club has connected Instagram (instagram-token.ts) */
  token: () => Promise<string | null>;
  /** The sample feed when there's no token: anywhere but production */
  fake?: boolean;
}

type Deps = CacheDeps & { fetch?: typeof globalThis.fetch };

const API = "https://graph.instagram.com/v23.0";
/** As many as /photos/ shows; the home page takes the first twelve */
export const FEED_SIZE = 48;
export const INSTAGRAM_CACHE: CacheOptions = { ttlMs: 10 * 60_000, staleMs: 3 * 24 * 60 * 60_000 };
const TIMEOUT_MS = 8000;
/** Browsers keep a picture a week: a post's picture never changes */
const IMAGE_CACHE_CONTROL = "public, max-age=604800, immutable";
const INSTAGRAM_CDN = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;

interface Media {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  children?: { data: { id: string }[] };
}
/** What's cached: the posts, and where each picture is on Instagram's servers today */
interface Feed {
  posts: Post[];
  pictures: Record<string, string>;
}

/** Instagram's refusal as an error the breaker understands: its rate limits pause it for an hour. */
function instagramError(status: number, code: number | undefined, now = Date.now()): Error {
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613)
    return new QuotaError(`Instagram: rate limited (${code ?? status})`, now + 60 * 60_000);
  return new HttpFailure(`Instagram API: HTTP ${status}${code ? ` (code ${code})` : ""}`, status);
}

async function api<T>(path: string, params: Record<string, string>, token: string, fetch = globalThis.fetch) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { code?: number } };
  // The message never carries the address, which holds the token
  if (!res.ok) throw instagramError(res.status, body.error?.code);
  return body;
}

const picture = (m: Pick<Media, "media_type" | "media_url" | "thumbnail_url">) =>
  m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url;

function toPost(m: Media): Post {
  const caption = m.caption?.trim() || null;
  const first = caption?.split(/(?<=[.!?])\s/)[0].slice(0, 160);
  const kind = m.media_type === "VIDEO" ? "video" : m.media_type === "CAROUSEL_ALBUM" ? "album" : "image";
  return {
    id: m.id,
    kind,
    image: `/api/photos/${m.id}`,
    caption,
    alt: first || "A photo from the club's Instagram",
    href: m.permalink,
    takenAt: new Date(m.timestamp).toISOString(),
    ...(kind === "album" ? { count: m.children?.data.length ?? 1 } : {}),
  };
}

async function readFeed(token: string, fetch?: typeof globalThis.fetch): Promise<Feed> {
  const { data } = await api<{ data: Media[] }>(
    "/me/media",
    {
      fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id}",
      limit: String(FEED_SIZE),
    },
    token,
    fetch,
  );
  const usable = data.filter((m) => picture(m));
  return {
    posts: usable.map(toPost),
    pictures: Object.fromEntries(usable.map((m) => [m.id, picture(m)!])),
  };
}

const feed = (token: string, { fetch, ...cacheDeps }: Deps) =>
  cached("instagram:feed", INSTAGRAM_CACHE, () => guard("instagram", () => readFeed(token, fetch)), cacheDeps);

/** The newest posts, newest first. Never throws: Instagram failing with nothing cached is `unavailable`. */
export async function latestPosts(config: InstagramConfig, deps: Deps = {}, limit = FEED_SIZE): Promise<Live<Post[]>> {
  const token = await config.token();
  if (!token) return { data: config.fake ? FAKE_POSTS.slice(0, limit) : [], unavailable: false };
  try {
    return { data: (await feed(token, deps)).posts.slice(0, limit), unavailable: false };
  } catch (error) {
    logFailure(log, "instagram.feed_error", error);
    return { data: [], unavailable: true };
  }
}

const notFound = () => new Response(null, { status: 404 });

/**
 * One of the club's recent posts' pictures, fetched from Instagram's servers. Only posts in the feed, only from
 * Instagram's own picture hosts, so this is never a way to fetch anything else. An expired address is asked for again.
 */
export async function postImage(config: InstagramConfig, id: string, deps: Deps = {}): Promise<Response> {
  if (!/^\d+$/.test(id)) return notFound();
  const token = await config.token();
  if (!token) return notFound();
  const fetch = deps.fetch ?? globalThis.fetch;
  let address: string | undefined;
  try {
    address = (await feed(token, deps)).pictures[id];
  } catch (error) {
    // Warnings, not reported, here and below: one picture missing; the feed's own failure is reported by latestPosts
    log.warn("instagram.picture_feed_error", error, { id });
    return new Response(null, { status: 503 });
  }
  if (!address) return notFound();

  const get = (url: string) =>
    INSTAGRAM_CDN.test(new URL(url).hostname)
      ? fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      : Promise.resolve(notFound());
  let res = await get(address);
  if (res.status === 403 || res.status === 410) {
    // Instagram's addresses are signed and expire: ask for this post's current one
    try {
      const fresh = await guard("instagram", () =>
        api<Pick<Media, "media_type" | "media_url" | "thumbnail_url">>(
          `/${id}`,
          { fields: "media_type,media_url,thumbnail_url" },
          token,
          fetch,
        ),
      );
      const url = picture(fresh);
      if (url) res = await get(url);
    } catch (error) {
      log.warn("instagram.picture_refresh_error", error, { id });
    }
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) {
    log.warn("instagram.picture_error", { id, status: res.status });
    return new Response(null, { status: 502 });
  }
  return new Response(res.body, { headers: { "content-type": type, "cache-control": IMAGE_CACHE_CONTROL } });
}
