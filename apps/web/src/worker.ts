// The website's Worker: Astro answers requests, and a daily cron (wrangler.jsonc triggers) deletes enquiries the
// privacy page says we no longer keep (ADR 0029). Runs whether or not anything deploys. Each task fails on its own:
// one breaking never stops another.
import * as Sentry from "@sentry/cloudflare";
import { handle } from "@astrojs/cloudflare/handler";
import { expireEnquiries } from "./lib/server/enquiries";
import { scribe } from "@cougars/shared/scribe";
import { consoleAdapter } from "@cougars/shared/scribe.console";
import { sentryReporter, workerSentryOptions } from "@cougars/shared/scribe.sentry";

// The log: JSON lines for Workers Logs (ADR 0110), and every error line to Sentry (ADR 0110)
scribe.configure({ adapter: consoleAdapter, report: sentryReporter(Sentry) });
const log = scribe.logger("cron");

// Sentry around the whole Worker: an error nothing caught is reported too. No SENTRY_DSN (your machine): off.
export default Sentry.withSentry(
  // SENTRY_DSN is a Worker secret and BUILD_VERSION a var the deploy adds (scripts/ci/target.mjs), so not in Env's types
  (env) => workerSentryOptions(env as Env & { SENTRY_DSN?: string; BUILD_VERSION?: string }),
  {
    fetch: handle,
    async scheduled(controller, env) {
      const now = controller.scheduledTime;
      const tasks = {
        "expire-enquiries": async () =>
          log.info("enquiries.expired", { deleted: await expireEnquiries(env.DB, new Date(now)) }),
      };
      const failed: unknown[] = [];
      for (const [task, run] of Object.entries(tasks)) {
        try {
          await run();
        } catch (e) {
          log.error("cron.failed", e, { task });
          failed.push(e);
        }
      }
      if (failed.length) throw failed[0];
    },
  } satisfies ExportedHandler<Env>,
);
