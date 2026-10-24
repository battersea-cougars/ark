// The website's security headers (ADR 0036), one source for both ways a response leaves: the Worker's live routes
// (middleware.ts) and the prerendered pages and files the asset layer serves without the Worker, through the `_headers`
// file the build writes (headers.integration.ts). Per environment: only dev's allow picsum's placeholder photos.

/** Which site: production on `release`, dev for everything else (a laptop, dev, PR previews). */
export type SiteEnv = "production" | "dev";

/** picsum: demo content's placeholder photos (lib/sanity/demo.ts), dev and previews only; an image can't run anything. */
const PLACEHOLDER_PHOTOS = ["https://picsum.photos", "https://fastly.picsum.photos"];

/**
 * What a page may load: our own files, Sanity's images, YouTube's thumbnails and player, Turnstile, and Cloudflare's
 * analytics beacon (and, off production, picsum). No inline scripts (Base.astro loads scripts/head.js), so a script
 * slipped into content can't run. Inline styles are allowed: pages set `style="--i:…"` throughout. A violation is
 * reported to /api/csp-report. A new outside resource means widening this on purpose.
 */
export function csp(siteEnv: SiteEnv): string {
  const images = ["'self'", "data:", "https://cdn.sanity.io", "https://i.ytimg.com"];
  if (siteEnv !== "production") images.push(...PLACEHOLDER_PHOTOS);
  return [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${images.join(" ")}`,
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
}

/**
 * On every response: the policy above, HTTPS only for a year on every subdomain, never shown in another site's frame,
 * no sniffing a type, and only the origin to other sites.
 */
export function siteHeaders(siteEnv: SiteEnv): Record<string, string> {
  return {
    "content-security-policy": csp(siteEnv),
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
}

/** The same headers as a Cloudflare `_headers` file, for every prerendered page and file. */
export function headersFile(siteEnv: SiteEnv): string {
  const lines = Object.entries(siteHeaders(siteEnv)).map(([name, value]) => `  ${name}: ${value}`);
  return [
    "# Security headers for every prerendered page and file, which the asset layer serves without the Worker.",
    `# Written by the build for ${siteEnv} (apps/web/src/lib/server/headers.ts); decision: docs/adr/0036-api-security.md.`,
    "/*",
    ...lines,
    "",
  ].join("\n");
}
