// The team app's Worker (ADR 0022): the JSON API under /api, and the built app for everything else (the assets
// binding falls back to index.html, so the app's own router takes any path).
import * as Sentry from "@sentry/cloudflare";
import { handleApi, type Env } from "./api/api";
import { chargeDue } from "./dues/dues";
import { forgetOld } from "./settings/retention";
import { checkUsage } from "./settings/usage";
import { rebuildWebsite } from "./website/website";
import { storeLinks, type StoreEnv } from "./store/store.links";
import { scribe } from "@cougars/shared/scribe";
import { consoleAdapter } from "@cougars/shared/scribe.console";
import { sentryReporter, workerSentryOptions } from "@cougars/shared/scribe.sentry";

// The log: JSON lines for Workers Logs (ADR 0110), and every error line to Sentry (ADR 0111)
scribe.configure({ adapter: consoleAdapter, report: sentryReporter(Sentry) });
const log = scribe.logger("cron");

// The live hub (ADR 0072): Cloudflare finds the Durable Object class here
export { LiveHub } from "./live/live";

// On every response the Worker sends. The app's pages and files are mostly served by the asset layer without the
// Worker (wrangler.jsonc: run_worker_first is /api/* only), so public/_headers carries the same set for them; a test
// keeps the two the same (security.test.ts, ADR 0036). The policy: the app runs only its own scripts, styles, fonts
// and files, talks only to its own origin, shows its own images and the ones it makes (team logos as data URLs,
// previews as blob URLs), and is never shown inside another site's frame. HTTPS only, for a year, as on the website.
export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

function secured(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

// Sentry around the whole Worker: an error nothing caught is reported too. No SENTRY_DSN (your machine, tests): off.
export default Sentry.withSentry((env: Env) => workerSentryOptions(env), {
  async fetch(request: Request, env: Env & StoreEnv & { ASSETS: Fetcher }, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/"))
      return secured(await handleApi(request, env, new Date(), (p) => ctx.waitUntil(p)));
    const links = storeLinks(url.pathname, env);
    if (links) return secured(links);
    return secured(await env.ASSETS.fetch(request));
  },
  async scheduled(controller: ScheduledController, env: Env) {
    const now = new Date(controller.scheduledTime);
    // Every five minutes (wrangler.jsonc triggers): a wanted website rebuild, once it's quiet (ADR 0100)
    if (controller.cron === "*/5 * * * *") await task("website.rebuild", () => rebuildWebsite(env, now));
    // Hourly: charge what a new day or quarter makes due (ADR 0007), warn the admins before the free allowance runs
    // out (ADR 0059), and forget old sign-in records (#30). Each on its own, so one failing doesn't stop the rest.
    else {
      await task("dues.charge", () => chargeDue(env, now));
      await task("usage.check", () => checkUsage(env, now));
      await task("retention.forget", () => forgetOld(env.DB, now));
    }
  },
} satisfies ExportedHandler<Env & StoreEnv & { ASSETS: Fetcher }>);

/** One cron job, run on its own: a failure is logged and the next job still runs. */
async function task(name: string, job: () => Promise<unknown>) {
  try {
    await job();
  } catch (e) {
    log.error("cron.failed", e, { task: name });
  }
}
