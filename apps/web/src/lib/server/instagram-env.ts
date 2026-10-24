// The Instagram feed's settings for live routes (lib/server/instagram.ts, ADR 0016). Apart from sanity-env.ts because
// it needs the database (the renewed token), which only a request has, never the build. INSTAGRAM_TOKEN and
// INSTAGRAM_TOKEN_KEY are Worker secrets (deploy.yml); SITE_ENV is inlined at build time.
import { env } from "cloudflare:workers";
import { INSTAGRAM_TOKEN, INSTAGRAM_TOKEN_KEY, SITE_ENV } from "astro:env/server";
import { instagramToken } from "./instagram-token";
import { mediaRefreshedAt } from "./media-refresh";
import type { InstagramConfig } from "./instagram";

export const instagramConfig = (): InstagramConfig => ({
  token: () => instagramToken({ DB: env.DB, INSTAGRAM_TOKEN, INSTAGRAM_TOKEN_KEY }),
  // Until the club connects Instagram: the sample feed on a laptop, dev and previews; nothing in production
  fake: SITE_ENV !== "production",
  // An admin's Refresh photos and videos (#109)
  refreshedAt: () => mediaRefreshedAt(env.DB),
});
