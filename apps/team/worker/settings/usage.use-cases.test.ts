// The club's free Cloudflare allowance (ADR 0059): admins see today's use on the Usage page, and an hourly check
// emails them once a day when anything passes 80%, or when a request was stopped for using too much CPU (ADR 0059).
// The live hub's requests and time (ADR 0072) are Durable Objects' own allowance, shown and checked the same way.
// Cloudflare's analytics API is faked; everything else is real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mail } from "@cougars/shared/email";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { NOW, testWorld } from "../testing";
import { checkUsage } from "./usage";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
let asked: { url: string; auth: string | null; body: Json }[];

/** Cloudflare's analytics, answering with today's totals. CPU time is in microseconds, as Cloudflare gives it. */
function cloudflare({
  requests = [30_000, 10_000],
  rowsRead = 1_000_000,
  rowsWritten = 2_000,
  cpu = [
    { p50: 1_200, p99: 4_800 },
    { p50: 800, p99: 2_100 },
  ],
  stopped = [] as number[],
  liveRequests = 300,
  // Two hours' draft night, in microseconds as Cloudflare gives it
  liveActiveUs = 7_200_000_000,
  ok = true,
} = {}) {
  asked = [];
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    if (!ok) return new Response("nope", { status: 503 });
    return Response.json({
      data: {
        viewer: {
          accounts: [
            {
              workersInvocationsAdaptive: requests.map((r, i) => ({
                sum: { requests: r },
                quantiles: { cpuTimeP50: cpu[i]?.p50 ?? 0, cpuTimeP99: cpu[i]?.p99 ?? 0 },
                dimensions: { scriptName: `w${i}` },
              })),
              stopped: stopped.map((r, i) => ({ sum: { requests: r }, dimensions: { scriptName: `w${i}` } })),
              d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead, rowsWritten } }],
              durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: liveRequests } }],
              durableObjectsPeriodicGroups: [{ sum: { activeTime: liveActiveUs } }],
            },
          ],
        },
      },
    });
  });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  Object.assign(w.env, { CLOUDFLARE_ANALYTICS_TOKEN: "analytics-token", CLOUDFLARE_ACCOUNT_ID: "acct" });
});
afterEach(() => vi.unstubAllGlobals());

const usageAs = async (email: string) => (await w.signedIn(email)).call("GET", "/api/usage");

describe("an admin checks the club's free Cloudflare allowance", () => {
  it("sees today's Worker requests, database reads and writes, and the live hub's use against the free limits, and when they reset", async () => {
    cloudflare();
    const res = await usageAs("dana@example.com");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, day: "2026-10-06", resetsAt: "2026-10-07T00:00:00.000Z" });
    expect(res.body.metrics).toEqual([
      { id: "requests", label: "Worker requests", used: 40_000, limit: 100_000 },
      { id: "rowsRead", label: "Database rows read", used: 1_000_000, limit: 5_000_000 },
      { id: "rowsWritten", label: "Database rows written", used: 2_000, limit: 100_000 },
      { id: "liveRequests", label: "Live hub requests", used: 300, limit: 100_000 },
      // Two hours active at 128 MB
      { id: "liveTime", label: "Live hub time (GB-s)", used: 922, limit: 13_000 },
    ]);
    // Read with the read-only analytics token, for this account and today (UTC)
    expect(asked[0].auth).toBe("Bearer analytics-token");
    expect(asked[0].body.variables).toEqual({ account: "acct", day: "2026-10-06" });
  });

  it("sees each Worker's typical and slowest CPU time per request against the free plan's 10 ms, and any stopped", async () => {
    cloudflare({ stopped: [3] });
    const res = await usageAs("dana@example.com");
    expect(res.body.cpu).toEqual({
      limitMs: 10,
      workers: [
        { name: "w0", p50Ms: 1.2, p99Ms: 4.8, stopped: 3 },
        { name: "w1", p50Ms: 0.8, p99Ms: 2.1, stopped: 0 },
      ],
    });
  });

  it("says how to set it up when there's no analytics token", async () => {
    delete (w.env as Json).CLOUDFLARE_ANALYTICS_TOKEN;
    const res = await usageAs("dana@example.com");
    expect(res.body).toMatchObject({ configured: false });
    expect(res.body.metrics).toEqual([]);
  });

  it("sees when the club's database was last backed up, and why, even without the analytics token (ADR 0106)", async () => {
    delete (w.env as Json).CLOUDFLARE_ANALYTICS_TOKEN;
    expect((await usageAs("dana@example.com")).body.backup).toBeNull();
    w.db.raw.exec(`INSERT INTO backups (taken_at, why, bytes) VALUES
      ('2026-10-05T03:15:00.000Z', 'nightly', 40000), ('2026-10-06T03:15:00.000Z', 'nightly', 41000)`);
    expect((await usageAs("dana@example.com")).body.backup).toEqual({
      takenAt: "2026-10-06T03:15:00.000Z",
      why: "nightly",
      bytes: 41000,
    });
  });

  it("says Cloudflare can't be read right now, rather than failing", async () => {
    cloudflare({ ok: false });
    const res = await usageAs("dana@example.com");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, unavailable: true, metrics: [] });
  });
});

describe("the hourly check", () => {
  const run = async (now = NOW) => {
    const sent: Mail[] = [];
    await checkUsage(w.env, now, { send: async (m) => void sent.push(m) });
    return sent;
  };

  it("emails the admins once a day when something passes 80% of its free limit", async () => {
    cloudflare({ requests: [85_000] });
    const first = await run();
    expect(first).toHaveLength(1);
    expect(first[0].to).toEqual(["dana@example.com"]);
    expect(first[0].subject).toBe("Cougars app: Worker requests at 85% of today's free allowance");
    // An hour later, still over: no second email
    expect(await run(new Date(NOW.getTime() + 3_600_000))).toEqual([]);
    // The next day, over again: a new one
    expect(await run(new Date("2026-10-07T11:00:00Z"))).toHaveLength(1);
  });

  it("emails the admins when the live hub's time passes 80% of its free day", async () => {
    // 23 hours active: 10,598 GB-s of 13,000
    cloudflare({ liveActiveUs: 23 * 3_600_000_000 });
    const sent = await run();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Cougars app: Live hub time (GB-s) at 81% of today's free allowance");
  });

  it("stays quiet under 80%", async () => {
    cloudflare({ requests: [79_000], rowsRead: 3_000_000 });
    expect(await run()).toEqual([]);
  });

  it("emails the admins once a day when a request was stopped for using too much CPU", async () => {
    cloudflare({ stopped: [2, 1] });
    const first = await run();
    expect(first).toHaveLength(1);
    expect(first[0].subject).toBe("Cougars app: 3 requests stopped today for using too much CPU");
    expect(first[0].text).toContain("w0: 2");
    expect(await run(new Date(NOW.getTime() + 3_600_000))).toEqual([]);
  });

  it("does nothing without a token, or when Cloudflare can't be read", async () => {
    cloudflare({ ok: false });
    expect(await run()).toEqual([]);
    delete (w.env as Json).CLOUDFLARE_ANALYTICS_TOKEN;
    expect(await run()).toEqual([]);
  });

  it("tells the developer when Cloudflare can't be read, since nobody would be warned before the allowance ran out", async () => {
    const reported: string[] = [];
    captureLogs({ report: (_e, entry) => void reported.push(entry.msg) });
    cloudflare({ ok: false });
    await run();
    expect(reported).toEqual(["usage.unavailable"]);
  });
});

// Before any limit runs out, the admins see it on Home (#148): each hourly check keeps the limits at 70% or more, and
// they come with the club (the bootstrap's forAdmins) to whoever sees Usage, so Home's For admins says the nearest in
// one line from first paint (lib/usage-near.ts). Push and email at these levels are #157's.
describe("the admins' Home says when a free limit is getting close", () => {
  const check = (now = NOW) => checkUsage(w.env, now, { send: async () => {} });
  /** Home's For admins, as the app reads it when it opens. */
  const homeAs = async (email: string, now = NOW) =>
    (await w.signedIn(email)).call("GET", "/api/bootstrap", undefined, { now });
  const levelsAs = async (email: string, now = NOW) => (await homeAs(email, now)).body.forAdmins.usage;

  it("an admin sees a limit past 70%, with today's reset; a member sees none", async () => {
    cloudflare({ rowsRead: 3_700_000 });
    await check();
    expect(await levelsAs("dana@example.com")).toEqual([
      {
        id: "rowsRead",
        label: "Database rows read",
        percent: 74,
        period: "day",
        resetsAt: "2026-10-07T00:00:00.000Z",
      },
    ]);
    expect(await levelsAs("reg@example.com")).toEqual([]);
  });

  it("all fine, there's nothing to say", async () => {
    cloudflare({ requests: [69_000], rowsRead: 3_000_000 });
    await check();
    expect(await levelsAs("dana@example.com")).toEqual([]);
  });

  it("past 90% says so, nearest first, with Sanity's month and a request stopped for its CPU time", async () => {
    cloudflare({ requests: [93_000], rowsWritten: 71_000, stopped: [1] });
    w.db.raw.exec(
      `INSERT INTO sanity_requests (day, project, kind, count) VALUES ('2026-10-02', 'zmg6rbe3', 'cdn', 800000)`,
    );
    await check();
    const levels = await levelsAs("dana@example.com");
    expect(levels.map((l: Json) => [l.id, l.percent, l.period])).toEqual([
      ["cpu", 100, "day"],
      ["requests", 93, "day"],
      ["sanity-cdn", 80, "month"],
      ["rowsWritten", 71, "day"],
    ]);
    expect(levels[2]).toMatchObject({ label: "Sanity API CDN requests", resetsAt: "2026-11-01T00:00:00.000Z" });
  });

  it("an admin who opened the app before the check gets the new line on their next open, not an unchanged reply", async () => {
    const dana = await w.signedIn("dana@example.com");
    const before = await dana.call("GET", "/api/bootstrap");
    expect(before.body.forAdmins.usage).toEqual([]);
    cloudflare({ requests: [75_000] });
    await check();
    const again = await dana.call("GET", "/api/bootstrap", undefined, {
      headers: { "if-none-match": before.headers.get("etag") },
    });
    expect(again.status).toBe(200);
    expect(again.body.forAdmins.usage.map((l: Json) => l.id)).toEqual(["requests"]);
    // An hour later, the same: nothing new, so the app's copy stands
    const version = again.headers.get("etag");
    await check(new Date(NOW.getTime() + 3_600_000));
    const unchanged = await dana.call("GET", "/api/bootstrap", undefined, { headers: { "if-none-match": version } });
    expect(unchanged.status).toBe(304);
  });

  it("a limit back under 70% goes at the next check, and yesterday's isn't today's", async () => {
    cloudflare({ requests: [75_000] });
    await check();
    cloudflare({ requests: [40_000] });
    await check(new Date(NOW.getTime() + 3_600_000));
    expect(await levelsAs("dana@example.com")).toEqual([]);
    cloudflare({ requests: [75_000] });
    await check();
    expect(await levelsAs("dana@example.com", new Date("2026-10-07T00:30:00Z"))).toEqual([]);
  });

  it("when Cloudflare can't be read, keeps what the last check found rather than saying all's fine", async () => {
    cloudflare({ requests: [75_000] });
    await check();
    cloudflare({ ok: false });
    await check(new Date(NOW.getTime() + 3_600_000));
    expect((await levelsAs("dana@example.com")).map((l: Json) => l.id)).toEqual(["requests"]);
  });
});

// Sanity has no usage API, so the website and this app count their own requests to it (ADR 0059), a row per day,
// project and quota in sanity_requests. Admins see this month's against Sanity's free plan, and are emailed at 50%,
// 80% and when the month's pace would run out before the 1st.
describe("an admin checks the club's Sanity requests this month", () => {
  /** What the website and this app counted: [day, project, kind, count]. */
  const counted = (...rows: [string, string, "api" | "cdn", number][]) =>
    w.db.raw.exec(
      `DELETE FROM sanity_requests; INSERT INTO sanity_requests (day, project, kind, count) VALUES ` +
        rows.map(([d, p, k, n]) => `('${d}', '${p}', '${k}', ${n})`).join(", "),
    );
  const DEV = "zmg6rbe3";
  const PRODUCTION = "ah165efl";
  // 5 days and 11 hours into October's 31
  const pace = (used: number) => Math.round((used * 31) / (5 + 11 / 24));

  it("sees this environment's month so far, through the API and its CDN, against the free plan, and where it's heading", async () => {
    delete (w.env as Json).CLOUDFLARE_ANALYTICS_TOKEN;
    counted(
      ["2026-10-01", DEV, "api", 15_000],
      ["2026-10-06", DEV, "api", 5_000],
      ["2026-10-02", DEV, "cdn", 100_000],
      // Last month, and the other project: not this one's month
      ["2026-09-30", DEV, "api", 240_000],
      ["2026-10-03", PRODUCTION, "api", 1_000],
    );
    const res = await usageAs("dana@example.com");
    expect(res.body.sanity).toEqual({
      project: DEV,
      name: "Cougars Dev",
      month: "2026-10",
      resetsAt: "2026-11-01T00:00:00.000Z",
      quotas: [
        { id: "api", label: "API requests", used: 20_000, limit: 250_000, projected: pace(20_000) },
        { id: "cdn", label: "API CDN requests", used: 100_000, limit: 1_000_000, projected: pace(100_000) },
      ],
    });
  });

  it("on production, sees production's project", async () => {
    Object.assign(w.env, { SITE_ENV: "production" });
    counted(["2026-10-03", PRODUCTION, "cdn", 1_000]);
    const { sanity } = (await usageAs("dana@example.com")).body;
    expect(sanity).toMatchObject({ project: PRODUCTION, name: "Cougars" });
    expect(sanity.quotas.map((q: Json) => q.used)).toEqual([0, 1_000]);
  });

  describe("the hourly check", () => {
    const run = async (now = NOW) => {
      const sent: Mail[] = [];
      await checkUsage(w.env, now, { send: async (m) => void sent.push(m) });
      return sent;
    };
    beforeEach(() => delete (w.env as Json).CLOUDFLARE_ANALYTICS_TOKEN);

    it("emails the admins once a month when a Sanity quota passes 50%, and again at 80%", async () => {
      counted(["2026-10-02", DEV, "cdn", 520_000]);
      const first = await run();
      expect(first.map((m) => m.subject)).toEqual([
        "Cougars app: Sanity API CDN requests at 52% of this month's free allowance (Cougars Dev)",
      ]);
      expect(first[0].to).toEqual(["dana@example.com"]);
      expect(first[0].text).toContain("520,000 of 1,000,000");
      expect(await run(new Date(NOW.getTime() + 3_600_000))).toEqual([]);
      counted(["2026-10-02", DEV, "cdn", 810_000]);
      expect((await run(new Date(NOW.getTime() + 7_200_000))).map((m) => m.subject)).toEqual([
        "Cougars app: Sanity API CDN requests at 81% of this month's free allowance (Cougars Dev)",
      ]);
    });

    it("past 80% at once, sends the one email, not 50% as well", async () => {
      counted(["2026-10-02", DEV, "api", 210_000]);
      expect((await run()).map((m) => m.subject)).toEqual([
        "Cougars app: Sanity API requests at 84% of this month's free allowance (Cougars Dev)",
      ]);
    });

    it("emails the admins once when this month's pace would run out before the 1st", async () => {
      // 60,000 in 5½ days: about 11,000 a day, all 250,000 gone around the 23rd
      counted(["2026-10-03", DEV, "api", 60_000]);
      const sent = await run();
      expect(sent.map((m) => m.subject)).toEqual([
        "Cougars app: Sanity API requests on pace to run out before 1 November (Cougars Dev)",
      ]);
      expect(sent[0].text).toContain("around 23 October");
      expect(await run(new Date(NOW.getTime() + 3_600_000))).toEqual([]);
    });

    it("doesn't judge the pace in a month's first three days", async () => {
      // 30,000 by the first evening would be over a million by the 31st, but a first day says little
      counted(["2026-10-01", DEV, "api", 30_000]);
      expect(await run(new Date("2026-10-01T20:00:00Z"))).toEqual([]);
      expect(await run(new Date("2026-10-03T23:00:00Z"))).toEqual([]);
      expect(await run(new Date("2026-10-04T01:00:00Z"))).toHaveLength(1);
    });

    it("stays quiet when the month is on course", async () => {
      counted(["2026-10-03", DEV, "api", 30_000], ["2026-10-03", DEV, "cdn", 150_000]);
      expect(await run()).toEqual([]);
    });
  });
});
