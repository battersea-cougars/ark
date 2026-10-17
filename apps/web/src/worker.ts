// The website's Worker: Astro answers requests, and a daily cron (wrangler.jsonc triggers) deletes enquiries the
// privacy page says we no longer keep (ADR 0029). Runs whether or not anything deploys.
import { handle } from "@astrojs/cloudflare/handler";
import { expireEnquiries } from "./lib/server/enquiries";
import { scribe } from "@cougars/shared/scribe";
import { consoleAdapter } from "@cougars/shared/scribe.console";

// The log: JSON lines for Workers Logs (ADR 0110)
scribe.configure({ adapter: consoleAdapter });
const log = scribe.logger("cron");

export default {
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
} satisfies ExportedHandler<Env>;
