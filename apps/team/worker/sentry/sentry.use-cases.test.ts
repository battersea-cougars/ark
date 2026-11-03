// What goes wrong reaches Sentry (ADR 0110): an error in a cron run or a request is one report with its breadcrumbs,
// and a run with nothing wrong sends nothing. Driven through the real Worker in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import { LiveHub } from "../live/live";
import { testWorld } from "../testing";

const ROSTER = [{ name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] }];

let w: ReturnType<typeof testWorld>;
let sentry: ReturnType<typeof w.sentryIngest>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = testWorld(ROSTER);
  sentry = w.sentryIngest();
});

/** A request as Cloudflare hands it to the Worker, with what it leaves to waitUntil finished. */
async function request(path: string) {
  const after: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void after.push(p), passThroughOnException() {}, props: {} };
  const fetch = worker.fetch as unknown as (r: Request, e: unknown, c: unknown) => Promise<Response>;
  const res = await fetch(new Request(`https://team.test${path}`), { ...w.env, ASSETS: undefined }, ctx);
  await Promise.all(after);
  return res;
}

describe("an error reaches Sentry from the invocation it happened in", () => {
  it("a cron job that fails: one report, with the run's lines up to it as breadcrumbs", async () => {
    w.db.failing = /DELETE FROM login_challenges/;
    await w.scheduled("7 * * * *", new Date("2026-10-06T11:07:00Z"));

    expect(sentry.reports).toHaveLength(1);
    const [report] = sentry.reports;
    expect(report.tags).toMatchObject({ logger: "cron", event: "cron.failed" });
    expect(report.breadcrumbs.map((b: { message: string }) => b.message)).toContain("cron.failed");
  });

  it("a request that fails: one report, with the request's method and address", async () => {
    w.db.failing = /./;
    const res = await request("/api/health");

    expect(res.status).toBe(503);
    expect(sentry.reports).toHaveLength(1);
    expect(sentry.reports[0].request).toEqual({ method: "GET", url: "https://team.test/api/health" });
    expect(sentry.reports[0].tags).toMatchObject({ event: "health.failed" });
  });

  it("a live hub call that fails: one report, from the hub's own invocation", async () => {
    const after: Promise<unknown>[] = [];
    const hub = new LiveHub({ waitUntil: (p: Promise<unknown>) => void after.push(p) }, w.env);
    // A change the hub can't read: a list of changes that isn't one
    const notify = new Request("https://live/notify", { method: "POST", body: JSON.stringify({ changed: 5 }) });
    await hub.fetch(new Request("https://live/subscribe?member=1"));
    await expect(hub.fetch(notify)).rejects.toThrow();
    await Promise.all(after);

    expect(sentry.reports).toHaveLength(1);
    expect(sentry.reports[0].request).toEqual({ method: "POST", url: "https://live/notify" });
    expect(sentry.reports[0].exception.values[0].mechanism).toMatchObject({ handled: false });
  });

  it("nothing wrong: a request and the minute's run send Sentry nothing", async () => {
    expect((await request("/api/health")).status).toBe(200);
    await w.scheduled("* * * * *", new Date("2026-10-06T11:01:00Z"));

    expect(sentry.events).toBe(0);
    expect(sentry.checkIns).toEqual([]);
  });
});
