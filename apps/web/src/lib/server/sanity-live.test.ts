import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pausedUntil, resetBreakers } from "@cougars/shared/breaker";
import { flushSanityRequests, resetSanityRequests } from "@cougars/shared/sanity-requests";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { sanityQuery, type SanityConfig } from "./sanity-live";

const config: SanityConfig = { projectId: "abc123", dataset: "production" };

beforeEach(() => resetBreakers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reading Sanity from the Worker", () => {
  it("asks the API CDN for published content, with a token only when there is one", async () => {
    const fetch = vi.fn(async (_url: URL, _init?: RequestInit) => Response.json({ result: [] }));
    vi.stubGlobal("fetch", fetch);
    await sanityQuery(config, "*[_type == $t]", { t: "video" });
    const [url, init] = fetch.mock.calls[0];
    expect(url.hostname).toBe("abc123.apicdn.sanity.io");
    expect(url.searchParams.get("perspective")).toBe("published");
    expect(url.searchParams.get("$t")).toBe('"video"');
    expect(init?.headers).toEqual({});
    await sanityQuery({ ...config, token: "viewer" }, "*");
    expect(fetch.mock.calls[1][1]?.headers).toEqual({ Authorization: "Bearer viewer" });
  });

  it("stops asking for an hour once Sanity's quota is spent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const spent = vi.fn(async () => Response.json({ error: "plan_limit_reached" }, { status: 402 }));
    vi.stubGlobal("fetch", spent);
    await expect(sanityQuery(config, "*")).rejects.toThrow();
    await expect(sanityQuery(config, "*")).rejects.toThrow();
    expect(spent).toHaveBeenCalledTimes(1);
  });

  it("drops a link that would run a script", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ result: { url: "javascript:alert(1)", title: "x" } }));
    expect(await sanityQuery(config, "*")).toEqual({ url: null, title: "x" });
  });
});

// Sanity has no usage API, so we count our own requests (ADR 0116): per project, UTC day and quota (the API or its
// CDN), only the answers Sanity counts (not a 4xx or 5xx), and into the database in one round trip after the request.
describe("the website counts what it asks Sanity", () => {
  const DAY = new Date("2026-10-20T09:30:00Z");
  let db: ReturnType<typeof createTestD1>;
  const counted = () => db.raw.prepare("SELECT day, project, kind, count FROM sanity_requests ORDER BY kind").all();
  beforeEach(() => {
    vi.useFakeTimers({ now: DAY, toFake: ["Date"] });
    db = createTestD1();
    resetSanityRequests();
  });
  afterEach(() => vi.useRealTimers());

  it("counts each read through the CDN for its project and day, and adds them to the day's in one round trip", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ result: [] }));
    await sanityQuery(config, "*");
    await sanityQuery(config, "*");
    await flushSanityRequests(db);
    expect(counted()).toEqual([{ day: "2026-10-20", project: "abc123", kind: "cdn", count: 2 }]);
    await sanityQuery(config, "*");
    const before = db.roundTrips;
    await flushSanityRequests(db);
    expect(db.roundTrips - before).toBe(1);
    expect(counted()).toEqual([{ day: "2026-10-20", project: "abc123", kind: "cdn", count: 3 }]);
    // Nothing new: no round trip at all
    await flushSanityRequests(db);
    expect(db.roundTrips - before).toBe(1);
  });

  it("doesn't count an answer Sanity doesn't count: a spent quota or its own failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    await expect(sanityQuery(config, "*")).rejects.toThrow();
    await flushSanityRequests(db);
    expect(counted()).toEqual([]);
  });

  it("says where it's from in Sanity's own request log, as a tag", async () => {
    const fetch = vi.fn(async (_url: URL) => Response.json({ result: [] }));
    vi.stubGlobal("fetch", fetch);
    await sanityQuery({ ...config, tag: "web.worker" }, "*");
    expect(fetch.mock.calls[0][0].searchParams.get("tag")).toBe("web.worker");
  });

  it("stops live reads at 90% of the month's CDN requests, until the quota resets on the 1st, so builds keep their share", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.raw.exec(`INSERT INTO sanity_requests (day, project, kind, count) VALUES
      ('2026-10-01', 'abc123', 'cdn', 500000), ('2026-10-19', 'abc123', 'cdn', 399999),
      ('2026-09-30', 'abc123', 'cdn', 900000), ('2026-10-19', 'other', 'cdn', 900000)`);
    const fetch = vi.fn(async () => Response.json({ result: [] }));
    vi.stubGlobal("fetch", fetch);
    // 899,999 this month: still reading, and the flush learns the month's total (900,000)
    await sanityQuery(config, "*");
    await flushSanityRequests(db);
    await expect(sanityQuery(config, "*")).rejects.toThrow(/90%/);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Paused until 00:00 UTC on 1 November
    expect(await pausedUntil("sanity", { edge: null })).toBe(Date.parse("2026-11-01T00:00:00Z"));
  });
});
