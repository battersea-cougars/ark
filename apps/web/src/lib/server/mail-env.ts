// Email settings for the Worker (packages/shared/email.ts). SITE_ENV is a wrangler var: target.mjs makes it "production"
// only on release. The Gmail values are Worker secrets (deploy.yml), read on each request. The club's inbox is the
// Studio's Club → Contact email (read as the rest of the club facts are, lib/sanity/content.ts).
import { env } from "cloudflare:workers";
import {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN,
  MAIL_SAFE_TO,
  SMOKE_TOKEN,
  TURNSTILE_SECRET_KEY,
} from "astro:env/server";
import type { MailConfig } from "@cougars/shared/email";
import { getClub } from "../sanity/content";

/** The club's inbox, where enquiries go (in production), or null when the Studio has none. */
export const clubInbox = async () => (await getClub()).contactEmail.trim().toLowerCase() || null;

export const mailConfig = (club: string | null): MailConfig => ({
  siteEnv: env.SITE_ENV,
  gmail:
    GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN
      ? { clientId: GMAIL_CLIENT_ID, clientSecret: GMAIL_CLIENT_SECRET, refreshToken: GMAIL_REFRESH_TOKEN }
      : null,
  safeTo: MAIL_SAFE_TO ?? null,
  club,
});

/** Turnstile's secret for this environment (packages/shared/turnstile.ts); unset, nobody counts as verified. */
export const turnstileSecret = () => TURNSTILE_SECRET_KEY;

/** The deploy smoke test's token (lib/server/smoke.ts); unset, nothing counts as a smoke test. */
export const smokeToken = () => SMOKE_TOKEN;
