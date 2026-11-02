import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import * as Sentry from "@sentry/cloudflare";
import { rateLimit } from "@cougars/shared/rate-limit";
import { scribe } from "@cougars/shared/scribe";
import { errorReportAllowed } from "@cougars/shared/error-report-cap";
import { withinLimit } from "../../lib/server/body-limit";
import { cspViolations } from "../../lib/server/csp-reports";

const log = scribe.logger("browser");

export const prerender = false;

// A visitor's browser refused something our content security policy doesn't allow (lib/server/csp-reports.ts,
// ADR 0024): either something we added without widening the policy, or something slipped into a page. Browsers send
// these without an Origin, so only reports about our own pages count, a few per visitor at most and a hundred a day
// across the club (with the browsers' errors), and always a quiet
// 204. Each kind of refusal is one Sentry issue, however many pages hit it.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const done = new Response(null, { status: 204 });
  const site = new URL(request.url).origin;
  const { allowed } = await rateLimit(await caches.open("rate-limit"), "csp-report", clientAddress ?? "unknown", {
    limit: 10,
    windowSeconds: 10 * 60,
  });
  // Over its limit, or past this visitor's few, it isn't read at all (#73)
  if (!allowed) return done;
  const sent = await withinLimit(request, 20_000);
  if (!sent) return done;
  const body = await sent.text();
  let report: unknown;
  try {
    report = JSON.parse(body);
  } catch {
    return done;
  }
  const violations = cspViolations(report, site);
  if (!violations.length) return done;
  // Past the club's daily cap (finding 13, #201): only the log has it, so made-up reports can't spend Sentry's month
  const toSentry = await errorReportAllowed(env.DB);
  for (const v of violations) {
    // The log's copy; Sentry gets its own event below, as a warning
    log.warn("browser.csp_violation", { ...v });
    if (!toSentry) continue;
    // A plain event, like a browser error's: captureMessage adds a stack of our own code, and Sentry names the issue
    // after it
    Sentry.captureEvent({
      message: `CSP refused ${v.blocked} (${v.directive})`,
      level: "warning",
      tags: { source: "csp", directive: v.directive, page: v.page },
      contexts: { violation: { ...v } },
      fingerprint: ["csp", v.directive, v.blocked],
    });
  }
  return done;
};
