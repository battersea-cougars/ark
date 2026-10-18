// The app's own errors to Sentry (ADR 0111), in the browser and the store app alike: anything thrown that nothing
// caught. Through the Worker's /api/errors (the app talks only to its own origin, and ad blockers leave that alone).
// Errors only, nothing about the member: the same settings and clean-up as the Workers (packages/shared/scribe.sentry.ts).
// A build without a DSN (your machine) never loads this.
import * as Sentry from "@sentry/svelte";
import { DATA_COLLECTION, scrubEvent } from "@cougars/shared/scribe.sentry";
import { isStaleCode } from "./stale-code";

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
}
