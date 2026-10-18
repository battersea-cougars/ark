import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { rateLimit } from "@cougars/shared/rate-limit";
import { scribe } from "@cougars/shared/scribe";
import { browserErrorEvent } from "../../lib/server/client-errors";

const log = scribe.logger("browser");

export const prerender = false;

// A visitor's browser hit an error in our scripts (lib/server/client-errors.ts, ADR 0111). Only our own pages, a few
// reports per visitor at most (Sentry's free 5k a month is for real errors), and always a quiet 204: a broken page
// has nothing to do with the answer.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const done = new Response(null, { status: 204 });
  const site = new URL(request.url).origin;
  if (request.headers.get("origin") !== site) return done;
  const { allowed } = await rateLimit(await caches.open("rate-limit"), "client-error", clientAddress ?? "unknown", {
    limit: 10,
    windowSeconds: 10 * 60,
  });
  const body = (await request.text()).slice(0, 10_000);
  if (!allowed) return done;
  let report: unknown;
  try {
    report = JSON.parse(body);
  } catch {
    return done;
  }
  const event = browserErrorEvent(report, site);
  if (!event) return done;
  log.warn("browser.error", { page: event.tags.page, error: event.exception.values[0].value });
  Sentry.captureEvent(event);
  return done;
};
