// Rate limiting for the Worker's live routes (ADR 0055). Prerendered pages are static assets, served without the
// Worker, so this only sees the live ones: photos, videos, What's on, events, player cards and the join form. A
// generous limit per address, enough that no person notices, but a loop or a scraper can't spend the club's free
// quotas (Workers requests, D1 reads, Sanity, YouTube). The join form has its own, tighter limit (pages/api/join.ts).
// After a request that read Sanity, its count goes to D1 (ADR 0116); in `astro dev` each read is logged too, with the
// page and who asked (lib/server/sanity-trace.ts), so a runaway shows where it's from.
import { defineMiddleware } from "astro:middleware";
import type { APIContext, MiddlewareNext } from "astro";
import { flushSanityRequests, hasPendingSanityRequests } from "@cougars/shared/sanity-requests";
import { asking } from "./lib/server/sanity-trace";
import { rateLimit, type CacheLike } from "@cougars/shared/rate-limit";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("middleware");

export const LIVE_LIMIT = { limit: 240, windowSeconds: 60 };

/**
 * What a page may load (ADR 0036): our own files, Sanity's images, YouTube's thumbnails and player, Turnstile, and
 * Cloudflare's analytics beacon. No inline scripts (Base.astro loads scripts/head.js), so a script slipped into
 * content can't run. Inline styles are allowed: pages set `style="--i:…"` throughout. A violation is reported to
 * /api/csp-report. A new outside resource means widening this on purpose.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  // picsum: demo content's placeholder photos (dev and previews only, lib/sanity/demo.ts); an image can't run anything
  "img-src 'self' data: https://cdn.sanity.io https://i.ytimg.com https://picsum.photos https://fastly.picsum.photos",
  "font-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-src https://www.youtube-nocookie.com https://challenges.cloudflare.com",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
  // report-uri, not report-to: every browser sends it at once. With report-to, Chrome ignores it, and on dev never
  // delivered the report (ADR 0036)
  "report-uri /api/csp-report",
].join("; ");

/**
 * On every live response (ADR 0036): the policy above, HTTPS only for a year on every subdomain, never shown in
 * another site's frame, no sniffing a type, and only the origin to other sites. Prerendered pages get the same from
 * public/_headers; middleware.test.ts keeps the two the same.
 */
export const SITE_HEADERS: Record<string, string> = {
  "content-security-policy": CSP,
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

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
  // A prerendered page has no headers, even in astro dev; its user agent is in the dev server's own log
  // (count.integration.ts)
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
