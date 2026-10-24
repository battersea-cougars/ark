// Every read of Sanity the website makes (ADR 0053): the build's content (lib/sanity/content.ts) and the Worker's live
// reads (lib/server/videos.ts). Through Sanity's API CDN with plain fetch (no client library), behind a circuit
// breaker (ADR 0055), counted (ADR 0059); callers cache (ADR 0053).
import { HttpFailure, QuotaError, guard, retryAfter } from "@cougars/shared/breaker";
import { nearSanityLimit, nextMonth, sanityFetch } from "@cougars/shared/sanity-requests";
import { scribe } from "@cougars/shared/scribe";
import { checkLinks } from "../links";
import { asking } from "./sanity-trace";

const log = scribe.logger("sanity");

export interface SanityConfig {
  projectId?: string;
  dataset: string;
  /** Viewer token. Only needed for a private dataset; Sanity's free plan only has public ones. */
  token?: string;
  demo?: boolean;
  /** Where the read is from (`web.build`, `web.dev`, `web.worker`), in Sanity's own request log (ADR 0059). */
  tag?: string;
}

export type Live<T> = { data: T; unavailable: boolean };

/** Browsers re-check after a minute; Cloudflare's edge keeps a page for five. */
export const CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
/** The "can't reach it" state must not be cached, so the next visit tries again. */
export const UNAVAILABLE_CACHE_CONTROL = "no-store";

export const API_VERSION = "v2025-01-01";
const TIMEOUT_MS = 5000;

/**
 * Sanity's answer as an error the circuit breaker understands: 402 is a spent plan quota (look again in an hour),
 * 429 too many requests at once.
 */
export function sanityError(status: number, res?: Response, now = Date.now()): Error {
  if (status === 402) return new QuotaError("Sanity: HTTP 402, the plan's quota is spent", now + 60 * 60_000);
  if (status === 429) return new QuotaError("Sanity: HTTP 429", res ? retryAfter(res, 60_000, now) : now + 60_000);
  return new HttpFailure(`Sanity query failed: HTTP ${status}`, status);
}

/**
 * At 90% of the month's CDN requests, as the last count had it, reads stop until the quota resets on the 1st, so the
 * builds keep the rest (ADR 0059). Only a process that counts into D1 knows (the Worker, astro dev); a build doesn't.
 */
export const SAVE_FOR_BUILDS = 0.9;

/** Run a GROQ query against the published content on Sanity's API CDN. Throws on any failure, or while paused. */
export const sanityQuery = <T>(config: SanityConfig, query: string, params: Record<string, string> = {}) =>
  guard("sanity", () => querySanity<T>(config, query, params));

async function querySanity<T>(config: SanityConfig, query: string, params: Record<string, string>): Promise<T> {
  if (config.projectId && nearSanityLimit(config.projectId, "cdn", SAVE_FOR_BUILDS))
    throw new QuotaError("Sanity: 90% of this month's CDN requests used, kept for the builds", nextMonth());
  const url = new URL(`https://${config.projectId}.apicdn.sanity.io/${API_VERSION}/data/query/${config.dataset}`);
  url.searchParams.set("query", query);
  url.searchParams.set("perspective", "published");
  if (config.tag) url.searchParams.set("tag", config.tag);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`$${k}`, JSON.stringify(v));
  // In `astro dev` (the middleware says who's asking), every read with the page and who asked, to find a runaway
  const who = asking.getStore();
  if (who) log.info("sanity.read", { ...who, query: query.slice(0, 60) });
  const res = await sanityFetch(url, {
    headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw sanityError(res.status, res);
  // Every link an editor typed is checked (lib/links.ts)
  return checkLinks(((await res.json()) as { result: T }).result);
}
