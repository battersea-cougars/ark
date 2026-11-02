// What the push drain reads on a quiet minute (ADR 0108). It runs every minute,
// 1,440 times a day, nearly always with nothing to send, and D1 bills every row a statement reads. The outbox keeps a
// week of notifications: a quiet minute must find there's nothing due or old enough to prune by index, never by
// walking the week's rows. Driven through the real handlers and the cron in the fake world (ADR 0031).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Member", position: "F", rating: 55, email: "mo@example.com" },
];
const HOUR = 3_600_000;

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(() => vi.restoreAllMocks());

/** Every statement the fake D1 prepares from here on, with the values it first ran with. */
function watchStatements() {
  const sent = new Map<string, unknown[]>();
  const raw = w.db.raw;
  const prepare = raw.prepare.bind(raw);
  vi.spyOn(raw, "prepare").mockImplementation(((sql: string) => {
    const st = prepare(sql);
    for (const m of ["all", "get", "run"] as const) {
      const f = st[m].bind(st) as (...p: unknown[]) => unknown;
      (st as unknown as Record<string, unknown>)[m] = (...params: unknown[]) => {
        if (!sent.has(sql)) sent.set(sql, params);
        return f(...params);
      };
    }
    return st;
  }) as typeof raw.prepare);
  return sent;
}

/** The tables a statement's plan walks whole (not by an index), json_each and constant rows aside. */
function walked(sent: Map<string, unknown[]>, tables: string[]) {
  const out: string[] = [];
  for (const [sql, params] of sent) {
    if (/^\s*(EXPLAIN|PRAGMA)/i.test(sql)) continue;
    const plan = w.db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
    for (const { detail } of plan) {
      const table = /^SCAN (\w+)(?! VIRTUAL)/.exec(detail)?.[1];
      if (table && tables.includes(table) && !/USING (COVERING )?INDEX/.test(detail)) out.push(`${detail}: ${sql}`);
    }
  }
  return out;
}

describe("the push drain on a quiet minute", () => {
  it("with a week of notifications sent, finds nothing to send or prune by index, not by reading the week", async () => {
    await w.firebase();
    for (const email of ["reg@example.com", "mo@example.com"])
      expect(
        (await (await w.signedIn(email)).call("PUT", "/api/auth/device", { token: `t-${email}`, platform: "ios" }))
          .status,
      ).toBe(200);
    const dana = await w.signedIn("dana@example.com");
    // A week of the club's news, each sent at once: every row stays in the outbox for the week
    const monday = new Date("2026-10-05T10:00:00Z");
    for (let i = 0; i < 30; i++) {
      const now = new Date(monday.getTime() + i * 5 * HOUR);
      const news = { title: `News ${i}`, body: "Read it.", link: "", endsOn: "2027-12-31" };
      expect((await dana.call("POST", "/api/announcements", news, { now })).status).toBe(201);
    }
    const sent = () =>
      (w.db.raw.prepare("SELECT count(*) n FROM push_outbox WHERE state = 'sent'").get() as { n: number }).n;
    expect(sent()).toBe(60);

    // A quiet minute the day after the last: nothing due, nothing a week old
    const statements = watchStatements();
    await w.scheduled("* * * * *", new Date("2026-10-12T09:01:00Z"));
    expect(statements.size).toBeGreaterThan(0);
    expect(walked(statements, ["push_outbox", "push_told", "push_devices"])).toEqual([]);
    expect(sent()).toBe(60);
  });
});
