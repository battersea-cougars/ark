import { afterEach, describe, expect, it } from "vitest";
import { scribe } from "./scribe";
import { consoleAdapter } from "./scribe.console";
import { scrubEvent, sentryReporter, workerSentryOptions } from "./scribe.sentry";
import { captureLogs } from "./testing/scribe";

// Sentry as the apps see it: what was captured, and with what
function fakeSentry() {
  const captured: { kind: "exception" | "message"; what: unknown; context: Record<string, unknown> }[] = [];
  return {
    captured,
    captureException: (what: unknown, context: Record<string, unknown>) =>
      void captured.push({ kind: "exception", what, context }),
    captureMessage: (what: unknown, context: Record<string, unknown>) =>
      void captured.push({ kind: "message", what, context }),
  };
}

afterEach(() => scribe.configure({ adapter: consoleAdapter }));

describe("an error in the log reaches Sentry", () => {
  it("with its Error, the logger and event as tags, and its fields", () => {
    const sentry = fakeSentry();
    captureLogs({ report: sentryReporter(sentry) });
    const boom = new Error("D1 timed out");
    scribe.logger("cron").error("cron.failed", boom, { task: "dues" });
    expect(sentry.captured).toEqual([
      {
        kind: "exception",
        what: boom,
        context: {
          level: "error",
          tags: { logger: "cron", event: "cron.failed" },
          extra: expect.objectContaining({ task: "dues" }),
        },
      },
    ]);
  });

  it("as a message when the line carries no Error", () => {
    const sentry = fakeSentry();
    captureLogs({ report: sentryReporter(sentry) });
    scribe.logger("join").error("enquiry.no_club_inbox", { id: 4 });
    expect(sentry.captured[0]).toMatchObject({
      kind: "message",
      what: "enquiry.no_club_inbox",
      context: { extra: { id: 4 } },
    });
  });

  it("a warning stays in the log only", () => {
    const sentry = fakeSentry();
    captureLogs({ report: sentryReporter(sentry) });
    scribe.logger("cache").warn("cache.stale", new Error("slow"));
    expect(sentry.captured).toEqual([]);
  });
});

describe("nothing private reaches Sentry", () => {
  it("an event's messages, request and extras are cleaned as the log is", () => {
    const event = {
      message: "Couldn't email ada@club.org",
      exception: { values: [{ type: "Error", value: "Rejected: player.one@example.com" }] },
      request: { headers: { cookie: "session=abc", "user-agent": "Safari" } },
      extra: { phone: "07700 900123", token: "t" },
    };
    expect(scrubEvent(event)).toEqual({
      message: "Couldn't email a…@club.org",
      exception: { values: [{ type: "Error", value: "Rejected: p…@example.com" }] },
      request: { headers: { cookie: "[redacted]", "user-agent": "Safari" } },
      extra: { phone: "[redacted]", token: "[redacted]" },
    });
  });
});

describe("Sentry is told to collect nothing about a person", () => {
  it("no bodies, cookies, headers, query strings, SQL values or stack variables; off without a DSN", () => {
    const options = workerSentryOptions({ SENTRY_DSN: "", SITE_ENV: "production", BUILD_VERSION: "2026.10.18+abc" });
    expect(options.dsn).toBeUndefined();
    expect(options).toMatchObject({ environment: "production", release: "2026.10.18+abc", tracesSampleRate: 0 });
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    });
  });
});
