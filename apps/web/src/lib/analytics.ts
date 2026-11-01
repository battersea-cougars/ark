// Cloudflare Web Analytics (#92, docs/setup.md): the beacon is in the website's own pages (layouts/Base.astro), not
// added by Cloudflare's automatic setup, which put it on every page of the zone, the team app's included, whose CSP
// refuses it. Production only, with the site's token: public (it's in every page), set in deploy.yml.
import type { SiteEnv } from "./server/headers";

const BEACON = "https://static.cloudflareinsights.com/beacon.min.js";

/** The beacon's script for this build, or null: none off production, or before the token is set. */
export function analyticsBeacon(siteEnv: SiteEnv, token: string | undefined): { src: string; config: string } | null {
  if (siteEnv !== "production" || !token) return null;
  // Cloudflare's tokens are hex; anything else isn't one, and never goes into the page
  if (!/^[0-9a-f]{16,64}$/i.test(token)) return null;
  return { src: BEACON, config: JSON.stringify({ token }) };
}
