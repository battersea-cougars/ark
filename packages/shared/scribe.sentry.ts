// Scribe's errors to Sentry (ADR 0110): every error or fatal line becomes a Sentry issue, and every event is cleaned
// of private details before it leaves, the same way as the log (scribe.ts). Takes the app's own Sentry SDK
// (@sentry/cloudflare in a Worker, @sentry/svelte in the team app), so this package depends on neither.
import { clean, type Entry, type Reporter } from "./scribe";

type Context = { level: "error" | "fatal"; tags: Record<string, string>; extra: Record<string, unknown> };
export interface SentryLike {
  captureException(error: unknown, context: Context): unknown;
  captureMessage(message: string, context: Context): unknown;
}

/** A reporter for scribe.configure(): the line's Error as an exception, or its message when it carries none. */
export const sentryReporter =
  (sentry: SentryLike): Reporter =>
  (error: unknown, entry: Entry) => {
    const context: Context = {
      level: entry.level === "fatal" ? "fatal" : "error",
      tags: { logger: entry.name, event: entry.msg },
      extra: entry.fields,
    };
    if (error instanceof Error) sentry.captureException(error, context);
    else sentry.captureMessage(entry.msg, context);
  };

/** For Sentry's beforeSend: the event with secrets, phones and email addresses taken out, as in a log line. */
export const scrubEvent = <T>(event: T): T => clean(event) as T;

/**
 * What Sentry may collect, everywhere (ADR 0110): nothing about a person. Sentry's defaults send request bodies (the join
 * form: a name, an email, a phone), cookies, headers, query strings (the team app's ?email=), SQL values and stack
 * variables; all off. A stack trace and its source lines are what's left, and beforeSend cleans even those.
 */
export const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  stackFrameVariables: false,
} as const;

/** What a Worker tells Sentry (withSentry's options): no DSN (your machine, tests) means Sentry stays off. Errors only,
 *  no tracing. */
export const workerSentryOptions = (env: { SENTRY_DSN?: string; SITE_ENV?: string; BUILD_VERSION?: string }) => ({
  dsn: env.SENTRY_DSN || undefined,
  environment: env.SITE_ENV || "local",
  release: env.BUILD_VERSION || undefined,
  dataCollection: { ...DATA_COLLECTION, httpBodies: [...DATA_COLLECTION.httpBodies] },
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
});
