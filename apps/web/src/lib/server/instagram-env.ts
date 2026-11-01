// The Instagram feed's settings for live routes (lib/server/instagram.ts, ADR 0016). Apart from sanity-env.ts because
// it needs the database (an admin's Refresh photos and videos), which only a request has, never the build.
// INSTAGRAM_TOKEN is a Worker secret (deploy.yml): the club portfolio's system-user token, which never expires.
// SITE_ENV is inlined at build time.
import { env } from "cloudflare:workers";
import { INSTAGRAM_TOKEN, SITE_ENV } from "astro:env/server";
import { mediaRefreshedAt } from "./media-refresh";
import type { InstagramConfig } from "./instagram";

/** @batterseacougarshockey's ID on the Graph API (not a secret: Meta's business settings show it) */
const CLUB_ACCOUNT = "17841468675329944";

export const instagramConfig = (): InstagramConfig => ({
  account: CLUB_ACCOUNT,
  token: async () => INSTAGRAM_TOKEN || null,
  // Until the club connects Instagram: the sample feed on a laptop, dev and previews; nothing in production
  fake: SITE_ENV !== "production",
  // An admin's Refresh photos and videos (#109)
  refreshedAt: () => mediaRefreshedAt(env.DB),
});
