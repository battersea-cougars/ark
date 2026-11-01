// The hourly run, caught up (ADR 0110): Cloudflare's hourly trigger at :07 doesn't retry, so when it's missed (a deploy,
// a blip) or a job in it fails, the run every minute tries the hour again from 12, 17, 27, 37 and 47 past, one try each,
// until it's done. Sentry's cron monitor hears once an hour: ok when the hour's done, however late; an error when the
// last try fails too; nothing in between. Driven through the real Worker in the fake world (ADR 0031): the crons as
// Cloudflare runs them, D1 failing as it can, and Sentry's ingest taking the check-ins.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { testWorld } from "../testing";
import { HOURLY_MONITOR } from "./hourly";

const ROSTER = [{ name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] }];

let w: ReturnType<typeof testWorld>;
let sentry: ReturnType<typeof w.sentryIngest>;
let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  sentry = w.sentryIngest();
  logs = captureLogs();
});

/** A moment on Tuesday 6 October 2026, UTC: "11:07". */
const at = (time: string, day = "2026-10-06") => new Date(`${day}T${time}:00Z`);
/** Cloudflare's hourly trigger, at :07. */
const hourly = (time: string, day?: string) => w.scheduled("7 * * * *", at(time, day));
/** Cloudflare's trigger every minute, from one minute to another of the same hour (both included). */
async function everyMinute(hour: string, from: number, to: number, day?: string) {
  for (let m = from; m <= to; m++) await w.scheduled("* * * * *", at(`${hour}:${String(m).padStart(2, "0")}`, day));
}

/**
 * The hour's work, seen: a sign-in code from two months ago, which the hourly run forgets (retention.forget, #30). How
 * many such codes are left says whether a run did the hour since one was put there.
 */
const oldCode = () =>
  w.db.raw
    .prepare(
      `INSERT INTO login_challenges (member_id, code_hash, nonce_hash, expires_at, created_at)
       SELECT id, 'h', 'n', '2026-08-06T11:10:00Z', '2026-08-06T11:00:00Z' FROM members LIMIT 1`,
    )
    .run();
const oldCodes = () => (w.db.raw.prepare("SELECT COUNT(*) n FROM login_challenges").get() as { n: number }).n;
/** D1 failing for the hour's forgetting, so that job fails (and only that one). */
const forgettingFails = (fails = true) => void (w.db.failing = fails ? /DELETE FROM login_challenges/ : null);
/** What the cron monitor heard: each check-in's status. */
const heard = () => sentry.checkIns.map((c) => (c.monitor === HOURLY_MONITOR ? c.status : `${c.monitor}:${c.status}`));
const tries = () => logs.entries.filter((e) => e.msg === "cron.failed" && e.fields.task === "retention.forget").length;

describe("an hour that's missed or fails is caught up", () => {
  it("the :07 run never came (a deploy): the run at 12 past does the hour, once, and the monitor hears ok", async () => {
    oldCode();
    await everyMinute("11", 0, 11);
    expect(oldCodes()).toBe(1);
    expect(heard()).toEqual([]);
    await everyMinute("11", 12, 12);
    expect(oldCodes()).toBe(0);
    expect(heard()).toEqual(["ok"]);
    // The hour's done: nothing later in it does it again
    oldCode();
    await everyMinute("11", 13, 59);
    expect(oldCodes()).toBe(1);
    expect(heard()).toEqual(["ok"]);
  });

  it("the :07 run done: the runs every minute leave the hour alone, and the monitor hears ok once", async () => {
    oldCode();
    await hourly("11:07");
    expect(oldCodes()).toBe(0);
    oldCode();
    await everyMinute("11", 8, 59);
    expect(oldCodes()).toBe(1);
    expect(heard()).toEqual(["ok"]);
  });

  it.each(seeds(5))("two runs at 12 past at once do the hour once (seed %i)", async (seed) => {
    w.db.interleave(seed);
    await Promise.all([w.scheduled("* * * * *", at("11:12")), w.scheduled("* * * * *", at("11:12"))]);
    w.db.interleave(null);
    expect(logs.messages().filter((m) => m === "hourly.done")).toHaveLength(1);
    expect(heard()).toEqual(["ok"]);
  });

  it("a job fails at :07 (D1 blips): the monitor hears nothing yet, and at 12 past it's done and heard ok", async () => {
    oldCode();
    forgettingFails();
    await hourly("11:07");
    expect(oldCodes()).toBe(1);
    // The job's failure is logged (and reported) as ever; the hour waits for its next try
    expect(tries()).toBe(1);
    expect(logs.entries.find((e) => e.msg === "hourly.retry")?.fields).toMatchObject({
      failed: ["retention.forget"],
      next: 12,
    });
    expect(heard()).toEqual([]);
    forgettingFails(false);
    await everyMinute("11", 8, 11);
    expect(oldCodes()).toBe(1);
    await everyMinute("11", 12, 59);
    expect(oldCodes()).toBe(0);
    expect(heard()).toEqual(["ok"]);
  });

  it("a job failing every try, to 47 past: tried at 7, 12, 17, 27, 37 and 47, then the hour's failed and heard as an error", async () => {
    oldCode();
    forgettingFails();
    await hourly("11:07");
    await everyMinute("11", 8, 46);
    expect(tries()).toBe(5);
    expect(heard()).toEqual([]);
    await everyMinute("11", 47, 47);
    expect(tries()).toBe(6);
    expect(heard()).toEqual(["error"]);
    // Failed: no more tries this hour
    await everyMinute("11", 48, 59);
    expect(tries()).toBe(6);
    expect(heard()).toEqual(["error"]);
    expect(oldCodes()).toBe(1);
  });

  it("the next hour starts clean: after a failed hour, its :07 run does it and the monitor hears ok", async () => {
    oldCode();
    forgettingFails();
    await hourly("11:07");
    await everyMinute("11", 8, 59);
    expect(heard()).toEqual(["error"]);
    forgettingFails(false);
    await hourly("12:07");
    expect(oldCodes()).toBe(0);
    expect(heard()).toEqual(["error", "ok"]);
  });

  it("a try missed too: the next minute after its time takes it", async () => {
    oldCode();
    forgettingFails();
    await hourly("11:07");
    forgettingFails(false);
    // Nothing ran from 12 to 15 past (Cloudflare's crons stopped a while): 16 past takes the try
    await everyMinute("11", 16, 16);
    expect(oldCodes()).toBe(0);
    expect(heard()).toEqual(["ok"]);
  });
});

describe("the clocks go back", () => {
  it("London's 01:00 to 02:00 comes twice on 25 October: two UTC hours, each run once and heard once", async () => {
    // 01:07 BST is 00:07 UTC
    oldCode();
    await hourly("00:07", "2026-10-25");
    expect(oldCodes()).toBe(0);
    oldCode();
    await everyMinute("00", 8, 59, "2026-10-25");
    expect(oldCodes()).toBe(1);
    // 01:07 GMT, an hour later, is 01:07 UTC: London's clock says the same, but it's a new hour
    await hourly("01:07", "2026-10-25");
    expect(oldCodes()).toBe(0);
    expect(heard()).toEqual(["ok", "ok"]);
  });
});

describe("the nightly backup's export (ADR 0106, #197)", () => {
  /** D1 busy exporting: it refuses every statement, as it does for the half minute a backup takes. */
  const exporting = (busy = true) => {
    w.db.failure = "D1_ERROR: Currently processing a long-running export.";
    w.db.failing = busy ? /./ : null;
  };
  const errors = () => logs.entries.filter((e) => e.level === "error" || e.level === "fatal");

  it("a backup at 28 past, the hour done: the minute does nothing, and it's a warning, not an error", async () => {
    await hourly("11:07");
    exporting();
    await everyMinute("11", 28, 28);
    expect(logs.messages()).toContain("cron.exporting");
    expect(errors()).toEqual([]);
    exporting(false);
    await everyMinute("11", 29, 59);
    expect(errors()).toEqual([]);
    expect(heard()).toEqual(["ok"]);
  });

  it("a backup over the :07 run: nothing's reported, and at 12 past the hour's done and heard ok", async () => {
    oldCode();
    exporting();
    await hourly("11:07");
    expect(logs.messages()).toContain("cron.exporting");
    expect(errors()).toEqual([]);
    exporting(false);
    await everyMinute("11", 8, 12);
    expect(oldCodes()).toBe(0);
    expect(heard()).toEqual(["ok"]);
  });

  it("a backup starting mid-try: the jobs it refuses are warnings, and the next try does the hour", async () => {
    oldCode();
    // Only the forgetting meets the export: the claim before it went through
    w.db.failure = "D1_ERROR: Currently processing a long-running export.";
    w.db.failing = /DELETE FROM login_challenges/;
    await hourly("11:07");
    expect(oldCodes()).toBe(1);
    expect(logs.entries.find((e) => e.msg === "cron.exporting")?.fields).toMatchObject({ task: "retention.forget" });
    expect(errors()).toEqual([]);
    exporting(false);
    await everyMinute("11", 8, 12);
    expect(oldCodes()).toBe(0);
    expect(heard()).toEqual(["ok"]);
  });
});
