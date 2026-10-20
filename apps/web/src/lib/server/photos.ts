// Photo albums, read live from Sanity (ADR 0016), so a published album is on the site without a rebuild. Reads go
// through Sanity's API CDN with plain fetch (no client library in the Worker), behind a circuit breaker
// (ADR 0055), and are cached for a minute (ADR 0053).
// When Sanity can't be reached, callers get empty data and `unavailable: true` and show a friendly empty
// state instead of an error page. With DEMO_CONTENT, the sample albums stand in until Sanity has some.
import { HttpFailure, QuotaError, guard, retryAfter } from "@cougars/shared/breaker";
import { cached, hashKey, type CacheOptions } from "./cache";
import * as q from "../sanity/queries";
import { demoAlbums as rawDemoAlbums } from "../sanity/demo";
import type { Album, AlbumSummary, Photo, SanityImage } from "../sanity/types";
import { scribe } from "@cougars/shared/scribe";
import { checkLinks } from "../links";

const log = scribe.logger("photos");

export interface PhotosConfig {
  projectId?: string;
  dataset: string;
  /** Viewer token. Only needed for a private dataset; Sanity's free plan only has public ones. */
  token?: string;
  demo?: boolean;
}

/** Browsers re-check after a minute; Cloudflare's edge keeps a page for five (once there's a domain, M5). */
export const CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
/** The "can't reach Sanity" state must not be cached, so the next visit tries again. */
export const UNAVAILABLE_CACHE_CONTROL = "no-store";

export const API_VERSION = "v2025-01-01";
/** Fresh for a minute, so a Studio change shows soon; the last good copy for a day if Sanity fails. */
export const PHOTOS_CACHE: CacheOptions = { ttlMs: 60_000, staleMs: 24 * 60 * 60_000 };
const TIMEOUT_MS = 5000;

export type Live<T> = { data: T; unavailable: boolean };

type RawPhoto = Partial<Photo> | null;
interface RawAlbum {
  title?: string | null;
  slug?: string | null;
  date?: string | null;
  cover?: RawPhoto;
  photos?: RawPhoto[] | null;
  photoCount?: number | null;
}

/**
 * Sanity's answer as an error the circuit breaker understands: 402 is a spent plan quota (look again in an hour),
 * 429 too many requests at once.
 */
export function sanityError(status: number, res?: Response, now = Date.now()): Error {
  if (status === 402) return new QuotaError("Sanity: HTTP 402, the plan's quota is spent", now + 60 * 60_000);
  if (status === 429) return new QuotaError("Sanity: HTTP 429", res ? retryAfter(res, 60_000, now) : now + 60_000);
  return new HttpFailure(`Sanity query failed: HTTP ${status}`, status);
}

/** Run a GROQ query against the published content on Sanity's API CDN. Throws on any failure, or while paused. */
export const sanityQuery = <T>(config: PhotosConfig, query: string, params: Record<string, string> = {}) =>
  guard("sanity", () => querySanity<T>(config, query, params));

async function querySanity<T>(config: PhotosConfig, query: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://${config.projectId}.apicdn.sanity.io/${API_VERSION}/data/query/${config.dataset}`);
  url.searchParams.set("query", query);
  url.searchParams.set("perspective", "published");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`$${k}`, JSON.stringify(v));
  const res = await fetch(url, {
    headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw sanityError(res.status, res);
  return checkLinks(((await res.json()) as { result: T }).result);
}

/** Fetch and map, falling back to demo content or an empty value. Never throws. */
async function live<Raw, T>(
  config: PhotosConfig,
  query: string,
  params: Record<string, string>,
  map: (raw: Raw | null) => T,
  isEmpty: (data: T) => boolean,
  demoData: () => T,
): Promise<Live<T>> {
  const fallback = (unavailable: boolean): Live<T> =>
    config.demo ? { data: demoData(), unavailable: false } : { data: map(null), unavailable };
  if (!config.projectId) return fallback(false);
  try {
    const key = `sanity:${config.projectId}:${config.dataset}:${hashKey(query + JSON.stringify(params))}`;
    const raw = await cached(key, PHOTOS_CACHE, () => sanityQuery<Raw | null>(config, query, params));
    const data = map(raw);
    return config.demo && isEmpty(data) ? fallback(false) : { data, unavailable: false };
  } catch (error) {
    log.error("photos.sanity_error", error);
    return fallback(true);
  }
}

/** Every album, newest first, with its cover and photo count. */
export const listAlbums = (config: PhotosConfig): Promise<Live<AlbumSummary[]>> =>
  live<RawAlbum[], AlbumSummary[]>(
    config,
    q.ALBUM_LIST,
    {},
    (raw) => newestFirst((raw ?? []).flatMap((a) => summary(a) ?? [])),
    (data) => data.length === 0,
    () => newestFirst(demoAlbums().map((a) => summary(a)!)),
  );

/** One album with all its photos, or null if no published album has that web address. */
export const findAlbum = (config: PhotosConfig, slug: string): Promise<Live<Album | null>> =>
  live<RawAlbum, Album | null>(
    config,
    q.ALBUM,
    { slug },
    (raw) => (raw ? toAlbum(raw) : null),
    (data) => data === null,
    () => demoAlbums().find((a) => a.slug === slug) ?? null,
  );

/** The newest photos across albums, newest album first: the home page strip. */
export const latestPhotos = (config: PhotosConfig, limit = 12): Promise<Live<Photo[]>> =>
  live<RawAlbum[], Photo[]>(
    config,
    q.LATEST_PHOTOS,
    {},
    (raw) => photosOf(newestFirst((raw ?? []).flatMap((a) => toAlbum(a) ?? [])), limit),
    (data) => data.length === 0,
    () => photosOf(newestFirst(demoAlbums()), limit),
  );

export const photosOf = (albums: Album[], limit = 12): Photo[] => albums.flatMap((a) => a.photos).slice(0, limit);

/**
 * A Sanity album in the site's shape: photos still uploading (no image yet) are left out, every photo gets
 * alt text (its description, else its caption), and the cover defaults to the first photo.
 */
export function toAlbum(raw: RawAlbum): Album | null {
  if (!raw.slug || !raw.title) return null;
  const photos = (raw.photos ?? []).filter(hasImage).map(toPhoto);
  return {
    title: raw.title,
    slug: raw.slug,
    date: raw.date ?? "",
    cover: hasImage(raw.cover) ? toPhoto(raw.cover) : (photos[0] ?? null),
    photos,
  };
}

/** The list view of an album: the query sends only its first photo, plus the full count. */
function summary(raw: RawAlbum): AlbumSummary | null {
  const album = toAlbum(raw);
  if (!album) return null;
  const { title, slug, date, cover, photos } = album;
  return { title, slug, date, cover, photoCount: raw.photoCount ?? photos.length };
}

const demoAlbums = () => rawDemoAlbums().flatMap((a) => toAlbum(a) ?? []);

const hasImage = (p: RawPhoto | undefined): p is Partial<Photo> =>
  Boolean((p as SanityImage | null)?.asset?._ref || p?.demoUrl);

function toPhoto(p: Partial<Photo>): Photo {
  const caption = p.caption?.trim() || null;
  return { ...p, caption, alt: p.alt?.trim() || caption || "" };
}

/** Newest first by album date; albums on the same day keep Sanity's order. */
const newestFirst = <T extends { date: string }>(albums: T[]): T[] =>
  [...albums].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
