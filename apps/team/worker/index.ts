// The team app's Worker (ADR 0022): the JSON API under /api, and the built app for everything else (the assets
// binding falls back to index.html, so the app's own router takes any path).
import * as Sentry from "@sentry/cloudflare";
import { handleApi, type Env } from "./api/api";
import { chargeDue } from "./dues/dues";
import { countPlayed } from "./members/members.played";
import { sendQueued } from "./dues/reminders";
import { remindPlans } from "./dues/plan-reminders";
import { forgetOld } from "./settings/retention";
import { checkUsage } from "./settings/usage.alerts";
import { rebuildWebsite } from "./website/website";
import { drainPush, SEND_AT_ONCE } from "./push/push";
import { announceOpenSignups } from "./training/training.signup";
import { announceOpenTournaments } from "./tournaments/signup";
import { storeLinks, type StoreEnv } from "./store/store.links";
import { scribe } from "@cougars/shared/scribe";
import { flushSanityRequests, hasPendingSanityRequests } from "@cougars/shared/sanity-requests";
import { consoleAdapter } from "@cougars/shared/scribe.console";
import { sentryReporter, workerSentryOptions } from "@cougars/shared/scribe.sentry";
import { claimHour, finishHour } from "./cron/hourly";

// The log: JSON lines for Workers Logs (ADR 0110), and every error line to Sentry (ADR 0110)
scribe.configure({ adapter: consoleAdapter, report: sentryReporter(Sentry) });
const log = scribe.logger("cron");

// The live hub (ADR 0072): Cloudflare finds the Durable Object class here
export { LiveHub } from "./live/live";

// On every response the Worker sends. The app's pages and files are mostly served by the asset layer without the
// Worker (wrangler.jsonc: run_worker_first is /api/* only), so public/_headers carries the same set for them; a test
// keeps the two the same (security.test.ts, ADR 0036). The policy: the app runs only its own scripts, styles, fonts
// and files, talks only to its own origin, shows its own images and the ones it makes (team logos as data URLs,
// previews as blob URLs), and is never shown inside another site's frame. The one outsider is Cloudflare Turnstile on
// the sign-in page (#13): its script and its frame, from challenges.cloudflare.com. HTTPS only, for a year, as on the
// website. No camera, microphone or location for the app or anything it frames (#81): it uses none (a photo is picked
// as a file).
export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    // index.html's one inline script, which reads the club before the app's files arrive (ADR 0120); its hash, so
    // nothing else inline runs (api.security.test.ts checks it against the page)
    "script-src 'self' https://challenges.cloudflare.com 'sha256-C5G3NqX0uMVW33PZsPgX8GpIvrA94mxoDWbKvRdrTII='",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src https://challenges.cloudflare.com",
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
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
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
    if (url.pathname.startsWith("/api/")) {
      const res = await handleApi(request, env, new Date(), (p) => ctx.waitUntil(p));
      // The club's address is read from Sanity (shared/club-contact.ts): counted into D1 after the request (ADR 0059).
      // One read while sending an email after the reply is counted with the next request's.
      if (hasPendingSanityRequests()) ctx.waitUntil(task("sanity.count", () => flushSanityRequests(env.DB)));
      return secured(res);
    }
    const links = storeLinks(url.pathname, env);
    if (links) return secured(links);
    // The Vite dev server has no ASSETS binding: a /.well-known path it doesn't serve (Chrome DevTools asks for one) ends
    // here, so say not found instead of failing
    if (!env.ASSETS) return secured(new Response("Not found", { status: 404 }));
    return secured(await env.ASSETS.fetch(request));
  },
  async scheduled(controller: ScheduledController, env: Env) {
    const now = new Date(controller.scheduledTime);
    // Every minute: the hour's catch-up, when its run was missed or failed (cron/hourly.ts, ADR 0110), which is the
    // hourly run again, so it fits the same 50 subrequests; otherwise the push drain alone, a whole batch, so a
    // notification quiet hours or the debounce held goes within a minute of its time and a club-wide send held
    // overnight is out by 08:03 (ADR 0108). On a five-minute minute that run drains instead
    if (controller.cron === "* * * * *") {
      if (await hourly(env, now, "catch-up")) return;
      if (now.getUTCMinutes() % 5) await task("push.drain", () => drainPush(env, now, SEND_AT_ONCE));
      return;
    }
    // Hourly: the hour's own run (cron/hourly.ts)
    if (controller.cron !== "*/5 * * * *") {
      await hourly(env, now, "hourly");
      return;
    }
    await everyRun(env, now);
    // Every five minutes (wrangler.jsonc triggers): a wanted website rebuild, once it's quiet (ADR 0100)
    // and the next few dues reminders an admin sent still queued (ADR 0007), so a send to the whole club goes within
    // minutes
    await task("website.rebuild", () => rebuildWebsite(env, now));
    await task("dues.remind.send", () => sendQueued(env, now));
  },
} satisfies ExportedHandler<Env & StoreEnv & { ASSETS: Fetcher }>);

/**
 * Every run, five-minutely and hourly: a training night or a tournament whose sign-up has opened today is told to
 * members once (ADR 0030, 0074), queued for the drain straight after; then the next batch of notifications a club-wide
 * send left waiting (ADR 0108).
 */
async function everyRun(env: Env, now: Date) {
  await task("signup.open", () => announceOpenSignups(env, now));
  await task("signup.open.tournament", () => announceOpenTournaments(env, now));
  await task("push.drain", () => drainPush(env, now));
}

/**
 * The hourly run, or its catch-up (cron/hourly.ts): claimed, the five-minutely jobs, then the hour's. False if this
 * run had nothing to do: the hour is done, or this try was taken.
 */
async function hourly(env: Env, now: Date, trigger: "hourly" | "catch-up"): Promise<boolean> {
  const tried = await claimHour(env.DB, now, trigger);
  if (!tried) {
    // The hour's own run still does what every run does, even with the hour done
    if (trigger === "hourly") await everyRun(env, now);
    return false;
  }
  await everyRun(env, now);
  await finishHour(env.DB, tried, await hourlyJobs(env, now), now);
  return true;
}

/**
 * The hour's jobs: charge what a new day or quarter makes due (ADR 0007; no reminders of what's owed: an admin sends
 * them), tell next quarter's Quarterly Members its fee is due a few days before it starts (#187), count the nights
 * played (#177), tell the admins as the free allowance gets close, at 70% and 90% (ADR 0059), forget old sign-in
 * records (#30), and count Sanity's requests (ADR 0116). Each on its own, so one failing doesn't stop the rest, and
 * each safe to run twice, as a catch-up does. Returns the names of those that failed.
 */
async function hourlyJobs(env: Env, now: Date): Promise<string[]> {
  const jobs: [string, () => Promise<unknown>][] = [
    ["dues.charge", () => chargeDue(env, now)],
    ["dues.plan_remind", () => remindPlans(env, now)],
    ["members.played", () => countPlayed(env.DB, now)],
    ["usage.check", () => checkUsage(env, now)],
    ["retention.forget", () => forgetOld(env.DB, now)],
    ["sanity.count", () => flushSanityRequests(env.DB, now)],
  ];
  const failed: string[] = [];
  for (const [name, job] of jobs) if (!(await task(name, job))) failed.push(name);
  return failed;
}

/** One cron job, run on its own: a failure is logged and the next job still runs. True if it succeeded. */
async function task(name: string, job: () => Promise<unknown>): Promise<boolean> {
  try {
    await job();
    return true;
  } catch (e) {
    log.error("cron.failed", e, { task: name });
    return false;
  }
}
