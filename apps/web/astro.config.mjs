// @ts-check
import { defineConfig, envField, fontProviders } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";
import { sanityProject } from "@cougars/shared/sanity";
import { sanityBuildCount } from "./src/lib/sanity/count.integration";

// The Sanity project for this build: production on `release`, otherwise dev (docs/adr/0010-environments-and-deploys.md).
// SITE_ENV is set by deploy.yml; a laptop and scripts/deploy-dev.sh are dev.
const sanity = sanityProject(process.env.SITE_ENV);

// Pages are prerendered at build time (content comes from Sanity; the site rebuilds
// daily and on each release, ADR 0004). Only routes that opt out with `prerender = false`
// (/api/*, later /kumite/live) run on the Worker. Admin lives in apps/ops.
export default defineConfig({
  site: process.env.SITE_URL || "https://cougars.workers.dev",
  output: "static",
  // No Astro sessions: avoids auto-provisioning a KV namespace. Admin auth
  // (phase 3) uses its own signed cookie + D1.
  session: false,
  trailingSlash: "ignore",
  // Every link starts fetching its page when the pointer rests on it (or it's focused, or touched), so by the click
  // the page is usually here already and the view transition starts at once.
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  // Old Wix addresses. /gallery/<album> is a server route (pages/gallery/[slug].ts): a config redirect to a
  // server-rendered page would point at a prerendered file that doesn't exist.
  redirects: { "/gallery": "/photos" },
  // Not in the sitemap: the thanks page (noindex) and the pieces the home page fetches (the reel, What's on). The
  // build's Sanity requests are counted into the environment's D1 (ADR 0116).
  integrations: [
    sitemap({ filter: (page) => !/\/(join\/thanks|videos\/reel|whats-on)(\/|$)/.test(new URL(page).pathname) }),
    sanityBuildCount(),
  ],
  adapter: cloudflare({
    // Resize local assets at build time with sharp; Sanity's CDN resizes CMS
    // images. Avoids the paid Cloudflare Images binding.
    imageService: "compile",
    prerenderEnvironment: "node",
    // Local D1 (apps/web/.wrangler/state), or main's when a worktree's site runs under the show switch (ADR 0115)
    ...(process.env.COUGARS_LOCAL_STATE && { persistState: { path: process.env.COUGARS_LOCAL_STATE } }),
  }),
  env: {
    schema: {
      SANITY_PROJECT_ID: envField.string({ context: "server", access: "public", default: sanity.projectId }),
      SANITY_DATASET: envField.string({ context: "server", access: "public", default: sanity.dataset }),
      // Not needed: both projects' datasets are public. Only for a private dataset or drafts later.
      SANITY_API_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
      // The club's YouTube videos, read live on the Worker (lib/server/videos.ts). Without it: Sanity videos only.
      YOUTUBE_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // The club's Instagram posts, the site's photos (lib/server/instagram.ts, ADR 0113). Worker secrets: the first
      // token, and the key the renewed one is sealed with in D1. Without a token: the sample feed, except in production.
      INSTAGRAM_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
      INSTAGRAM_TOKEN_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Which site this build is (deploy.yml sets it): production, or dev for everything else
      SITE_ENV: envField.enum({ values: ["production", "dev"], context: "server", access: "public", default: "dev" }),
      // Enquiry emails through the Gmail API (packages/shared/email.ts, README.md#gmail). Worker secrets; without them the
      // email is logged instead of sent.
      GMAIL_CLIENT_ID: envField.string({ context: "server", access: "secret", optional: true }),
      GMAIL_CLIENT_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
      GMAIL_REFRESH_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
      // Where every email goes outside production; unset, the sending account itself (the developer Gmail account).
      MAIL_SAFE_TO: envField.string({ context: "server", access: "public", optional: true }),
      // Cloudflare Turnstile on /join (packages/shared/turnstile.ts, ADR 0028). The site key is public, one per Cloudflare
      // account (deploy.yml); the default is Cloudflare's test key, which always passes, for a laptop. The secret is a
      // Worker secret; unset, nobody counts as verified (no auto-replies).
      TURNSTILE_SITE_KEY: envField.string({ context: "client", access: "public", default: "1x00000000000000000000AA" }),
      TURNSTILE_SECRET_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // The deploy's smoke test of the form (lib/server/smoke.ts): unset, there's no smoke path at all
      SMOKE_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
      // Where the Worker's errors go (ADR 0111, src/worker.ts reads it): a Worker secret; unset, only the log
      SENTRY_DSN: envField.string({ context: "server", access: "secret", optional: true }),
      PUBLIC_BUILD_VERSION: envField.string({ context: "client", access: "public", default: "dev" }),
      // Sample content + noindex for dev builds (local, PR previews, scripts/deploy-dev.sh). Never in production.
      DEMO_CONTENT: envField.boolean({ context: "server", access: "public", default: false }),
    },
  },
  // Self-hosted variable font, preloaded, with a metric-matched fallback so text
  // doesn't jump when it loads (Astro Fonts API).
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Inter Tight",
      cssVariable: "--font-sans",
      fallbacks: ["system-ui", "sans-serif"],
      options: {
        variants: [
          {
            src: ["./src/assets/fonts/InterTight-Variable.woff2"],
            weight: "100 900",
            style: "normal",
            display: "swap",
          },
        ],
      },
    },
    // Display (poster titles) and VCR on-screen-display type. Both SIL OFL, self-hosted.
    {
      provider: fontProviders.local(),
      name: "Anton",
      cssVariable: "--font-display",
      fallbacks: ["Impact", "Haettenschweiler", "sans-serif"],
      options: {
        variants: [{ src: ["./src/assets/fonts/Anton.woff2"], weight: "400", style: "normal", display: "swap" }],
      },
    },
    {
      provider: fontProviders.local(),
      name: "VT323",
      cssVariable: "--font-osd",
      fallbacks: ["ui-monospace", "monospace"],
      options: {
        variants: [{ src: ["./src/assets/fonts/VT323.woff2"], weight: "400", style: "normal", display: "swap" }],
      },
    },
  ],
  image: {
    remotePatterns: [{ protocol: "https", hostname: "cdn.sanity.io", pathname: "/images/**" }],
  },
  // 4500 is the website's; under the show switch (`npm run dev`, ADR 0115) it runs on a private port given as --port
  server: { port: 4500, host: true },
  devToolbar: { enabled: false },
  vite: {
    envDir: "../..",
    // Source maps for Sentry (ADR 0111): written but never linked from the scripts; the deploy uploads them, then
    // deletes them before the files go live
    build: {
      sourcemap: "hidden",
      // No inline scripts, however small, so the content security policy allows our own files only (ADR 0036)
      assetsInlineLimit: (file) => (file.endsWith(".js") ? false : undefined),
    },
    // The dev server keeps its own dependency cache: `astro build` and `astro check` rewrite
    // the default one, which breaks a dev server that is already running (500s on /_image).
    cacheDir: process.argv.includes("dev") ? "node_modules/.vite-dev" : "node_modules/.vite",
    // Pre-bundle the view-transition modules. Discovered late, they trigger a mid-session
    // re-optimise that leaves the dev server serving stale deps (500s on /_image).
    optimizeDeps: {
      include: [
        "astro/virtual-modules/transitions-events.js",
        "astro/virtual-modules/transitions-router.js",
        "astro/virtual-modules/transitions-swap-functions.js",
        "astro/virtual-modules/transitions-types.js",
      ],
    },
  },
});
