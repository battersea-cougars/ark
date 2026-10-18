// The website's Worker: Astro answers requests, and a daily cron (wrangler.jsonc triggers) deletes enquiries the
// privacy page says we no longer keep (ADR 0029). Runs whether or not anything deploys.
import * as Sentry from "@sentry/cloudflare";
import { handle } from "@astrojs/cloudflare/handler";
import { expireEnquiries } from "./lib/server/enquiries";
import { scribe } from "@cougars/shared/scribe";
import { consoleAdapter } from "@cougars/shared/scribe.console";
import { sentryReporter, workerSentryOptions } from "@cougars/shared/scribe.sentry";

// The log: JSON lines for Workers Logs (ADR 0110), and every error line to Sentry (ADR 0111)
scribe.configure({ adapter: consoleAdapter, report: sentryReporter(Sentry) });
const log = scribe.logger("cron");

// Sentry around the whole Worker: an error nothing caught is reported too. No SENTRY_DSN (your machine): off.
export default Sentry.withSentry(
  // SENTRY_DSN is a Worker secret and BUILD_VERSION a var the deploy adds (scripts/ci/target.mjs), so not in Env's types
  (env) => workerSentryOptions(env as Env & { SENTRY_DSN?: string; BUILD_VERSION?: string }),
  {
    fetch: handle,
    async scheduled(controller, env) {
      try {
        const deleted = await expireEnquiries(env.DB, new Date(controller.scheduledTime));
        log.info("enquiries.expired", { deleted });
      } catch (e) {
        log.error("cron.failed", e, { task: "expire-enquiries" });
        throw e;
      }
    },
  } satisfies ExportedHandler<Env>,
);
