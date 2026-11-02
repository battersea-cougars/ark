// The Worker's live routes, on every request: security headers, a rate limit per address (ADR 0055), and the count
// of Sanity reads into D1 (ADR 0003). Prerendered pages are static assets and never come through here.
import { defineMiddleware } from "astro:middleware";
import type { APIContext, MiddlewareNext } from "astro";
import { flushSanityRequests, hasPendingSanityRequests } from "@cougars/shared/sanity-requests";
import { asking } from "./lib/server/sanity-trace";
import { rateLimit, type CacheLike } from "@cougars/shared/rate-limit";
import { scribe } from "@cougars/shared/scribe";
import { SITE_ENV } from "astro:env/server";
import { siteHeaders } from "./lib/server/headers";

const log = scribe.logger("middleware");

// Generous, so no person notices, but a loop or a scraper can't spend the club's free quotas (Workers requests, D1
// reads, Sanity, YouTube). The join form has its own, tighter limit (pages/api/join.ts).
export const LIVE_LIMIT = { limit: 240, windowSeconds: 60 };

/**
 * On every live response (ADR 0024), for this site: production's, or dev's with picsum's placeholder photos
 * (lib/server/headers.ts). Prerendered pages get the same from the `_headers` file the build writes.
 */
export const SITE_HEADERS = siteHeaders(SITE_ENV);

export function secured(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SITE_HEADERS)) out.headers.set(k, v);
  return out;
}

/** A 429 if this address has made too many live requests this minute, else null. */
export async function tooMany(cache: CacheLike | null, ip: string, now = Date.now()): Promise<Response | null> {
  if (!cache) return null;
  const { allowed } = await rateLimit(cache, "live", ip, { ...LIVE_LIMIT, now });
  if (allowed) return null;
  // A warning, not reported (ADR 0110): the limit working, and a flood would spend Sentry's 5k a month
  log.warn("rate_limit.live", { ip });
  return secured(
    new Response("Too many requests from here. Wait a minute and try again.", {
      status: 429,
      headers: { "Retry-After": String(LIVE_LIMIT.windowSeconds), "Cache-Control": "no-store" },
    }),
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  // A build counts its own (astro.config's integration)
  if (context.isPrerendered && !import.meta.env.DEV) return next();
  // In astro dev each Sanity read is logged with the page and who asked (lib/server/sanity-trace.ts), so a runaway
  // shows where it's from. A prerendered page has no headers, even in astro dev; its user agent is in the dev
  // server's own log (count.integration.ts)
  const who = {
    route: context.url.pathname,
    userAgent: context.isPrerendered ? null : context.request.headers.get("user-agent"),
  };
  const res = import.meta.env.DEV ? await asking.run(who, () => live(context, next)) : await live(context, next);
  // `astro dev` has no execution context, and its process stays up: the count just goes
  const cf = context.locals.cfContext;
  const after = (p: Promise<void>) => (cf ? cf.waitUntil(p) : void p);
  // In astro dev a prerendered page renders in Node, outside the Worker and its D1: logged only
  if ((!cf && !import.meta.env.DEV) || context.isPrerendered) return res;
  if (!res.body) return (after(flushCounts()), res);
  // A page reads Sanity as it streams, so the count goes once the whole page is sent
  const { readable, writable } = new TransformStream();
  after(
    res.body
      .pipeTo(writable)
      // A visitor leaving mid-page (the stream aborted) is no fault: the count still goes
      .catch(() => {})
      .then(flushCounts),
  );
  return new Response(readable, res);
});

/** This process's Sanity count into the environment's D1 (local D1 in `astro dev`). A failure keeps it for next time. */
async function flushCounts() {
  if (!hasPendingSanityRequests()) return;
  try {
    const { env } = await import("cloudflare:workers");
    await flushSanityRequests(env.DB);
  } catch (error) {
    // A warning, not reported: the count stays in memory and goes with the next flush; the Usage page is a little behind
    log.warn("sanity.count_failed", error);
  }
}

async function live(context: APIContext, next: MiddlewareNext) {
  // At build time there's no visitor, and outside a Worker no Cache API. Not in astro dev: Vite's own inline scripts
  // would break under the policy
  if (context.isPrerendered || import.meta.env.DEV || typeof caches === "undefined") return next();
  const ip = context.request.headers.get("cf-connecting-ip") ?? "unknown";
  return (await tooMany(await caches.open("live-rate-limit"), ip)) ?? secured(await next());
}
