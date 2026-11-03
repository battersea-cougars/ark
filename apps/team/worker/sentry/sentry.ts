// Sentry for the team Worker (ADR 0110), loaded only when there's something to send: each invocation runs `within` a
// small record of its own, and a report, a cron check-in or an uncaught error loads Sentry and sends inside
// withSentry's own wrapper, flushed before the invocation ends.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Adapter, Entry, Reporter } from "@cougars/shared/scribe";
import { sentryReporter, workerSentryOptions } from "@cougars/shared/scribe.sentry";

type SentrySdk = typeof import("@sentry/cloudflare");
export interface SentryEnv {
  SENTRY_DSN?: string;
  SITE_ENV?: string;
  BUILD_VERSION?: string;
}

/** Where an invocation's work after its reply goes: the Worker's execution context, or a Durable Object's state. */
export interface Waiting {
  waitUntil(promise: Promise<unknown>): void;
}

/** What set an invocation off: a request, or a Cron Trigger's run. */
type Trigger = { request: Request } | { controller: ScheduledController };

/** One invocation, as a report needs it: where to send from, and its last lines (Sentry's breadcrumbs). */
interface Invocation {
  env: SentryEnv;
  ctx: Waiting;
  trigger: Trigger;
  lines: Entry[];
}

/** As many of the invocation's lines as Sentry's breadcrumbs keep by default. */
const BREADCRUMBS = 100;
const invocations = new AsyncLocalStorage<Invocation>();

/**
 * Run one invocation (a request or a cron run) so what it reports reaches Sentry. Anything it throws that nothing
 * caught is reported too, as withSentry did, then thrown on.
 */
export function within<T>(env: SentryEnv, ctx: Waiting, trigger: Trigger, run: () => Promise<T>): Promise<T> {
  return invocations.run({ env, ctx, trigger, lines: [] }, async () => {
    try {
      return await run();
    } catch (e) {
      const type = "request" in trigger ? "auto.http.cloudflare" : "auto.faas.cloudflare.scheduled";
      send((sentry) => sentry.captureException(e, { mechanism: { handled: false, type } }));
      throw e;
    }
  });
}

/** Scribe's reporter (ADR 0110): every error or fatal line to Sentry, from the invocation it was logged in. */
export const report: Reporter = (error, entry) => send((sentry) => sentryReporter(sentry)(error, entry));

/** A cron monitor's check-in (cron/hourly.ts). */
export const checkIn = (monitorSlug: string, status: "ok" | "error", duration: number) =>
  send((sentry) => sentry.captureCheckIn({ monitorSlug, status, duration }));

/** An adapter that also keeps each line for the invocation's breadcrumbs, then writes it as `adapter` does. */
export const remembering = (adapter: Adapter): Adapter => ({
  write(entry) {
    const lines = invocations.getStore()?.lines;
    if (lines) {
      lines.push(entry);
      if (lines.length > BREADCRUMBS) lines.shift();
    }
    adapter.write(entry);
  },
});

/** Send from the invocation running: nothing outside one, or without a DSN (your machine, tests without Sentry). */
function send(capture: (sentry: SentrySdk) => void) {
  const invocation = invocations.getStore();
  if (!invocation?.env.SENTRY_DSN) return;
  invocation.ctx.waitUntil(deliver(invocation, capture).catch(() => {}));
}

/**
 * Sentry, imported and set up (once an isolate: its client is kept), the report made inside withSentry's own wrapper
 * around a stand-in for this invocation, and sent before the invocation ends.
 */
async function deliver({ env, trigger, lines }: Invocation, capture: (sentry: SentrySdk) => void) {
  const sentry = await import("@sentry/cloudflare");
  const make = async () => {
    for (const { level, name, msg } of lines)
      sentry.addBreadcrumb({ category: name, message: msg, level: crumb(level) });
    capture(sentry);
  };
  const options = () => workerSentryOptions(env);
  const once: ExportedHandler<SentryEnv> =
    "request" in trigger
      ? {
          async fetch() {
            await make();
            return new Response(null, { status: 204 });
          },
        }
      : { scheduled: make };
  const handler = sentry.withSentry(options, once);
  // withSentry flushes through the context's waitUntil: kept here and awaited, so the report's sent within this one
  const flushing: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void flushing.push(p), passThroughOnException() {}, props: {} };
  if ("request" in trigger) {
    const { method, url } = trigger.request;
    await handler.fetch!(new Request(url, { method }) as never, env, ctx as never);
  } else await handler.scheduled!(trigger.controller, env, ctx as never);
  await Promise.all(flushing);
}

/** Scribe's level as Sentry's breadcrumb level. */
const crumb = (level: Entry["level"]) => (level === "warn" ? "warning" : level === "trace" ? "debug" : level);
