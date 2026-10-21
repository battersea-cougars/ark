// The app's own errors to Sentry (ADR 0111), in the browser and the store app alike: anything thrown that nothing
// caught. Through the Worker's /api/errors (the app talks only to its own origin, and ad blockers leave that alone).
// Errors only, nothing about the member: the same settings and clean-up as the Workers (packages/shared/scribe.sentry.ts).
// A build without a DSN (your machine) never loads this.
import * as Sentry from "@sentry/svelte";
import { DATA_COLLECTION, scrubEvent } from "@cougars/shared/scribe.sentry";
import { handOff, type How } from "./errors.early";
import { isStaleCode } from "./stale-code";

/** Each kind as Sentry names its own: not handled, unless it's the start-up, which the app caught and showed. */
const MECHANISM: Record<How, { type: string; handled: boolean }> = {
  onerror: { type: "auto.browser.global_handlers.onerror", handled: false },
  onunhandledrejection: { type: "auto.browser.global_handlers.onunhandledrejection", handled: false },
  start: { type: "app.start", handled: true },
};

export function startErrorReports(dsn: string) {
  Sentry.init({
    dsn,
    tunnel: "/api/errors",
    environment: import.meta.env.VITE_SITE_ENV || "production",
    release: import.meta.env.VITE_RELEASE || undefined,
    dataCollection: { ...DATA_COLLECTION, httpBodies: [] },
    tracesSampleRate: 0,
    // Old code after a deploy reloads itself (stale-code.ts): not a bug
    beforeSend: (event, hint) => (isStaleCode(hint.originalException) ? null : scrubEvent(event)),
  });
  // What went wrong before Sentry was up (errors.early.ts), and the start-up's failure whenever it comes. The same
  // beforeSend sees each: old code is dropped, the rest cleaned.
  handOff((error, how) =>
    Sentry.captureException(error, {
      mechanism: MECHANISM[how],
      captureContext: { tags: { phase: how === "start" ? "start" : "early" } },
    }),
  );
}
