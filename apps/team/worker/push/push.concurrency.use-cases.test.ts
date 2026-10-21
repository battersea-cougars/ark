// The push outbox when sends overlap (docs/load-testing.md, ADR 0108): a club-wide announcement's first batch, the
// cron's drains, and another announcement, all at once. A real D1 runs each statement atomically but interleaves two
// invocations' statements between their awaits; the fake D1 does the same (`interleave`, a seed each run). Rows are
// claimed before they're sent, so no phone hears a notice twice, and no invocation goes past the free plan's 50
// subrequests. Driven through the real handlers in the fake world (ADR 0031).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { minutes, testWorld } from "../testing";

const PHONES = 120;
const SEEDS = [1, 2, 3, 4, 5];
const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...Array.from({ length: PHONES - 1 }, (_, i) => ({
    name: `Member ${i + 1}`,
    position: "F",
    rating: 50,
    email: `m${i + 1}@example.com`,
  })),
];
const news = (title: string) => ({ title, body: "Read it.", link: "", endsOn: "2026-10-24" });

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function clubWithPhones() {
  const fcm = await w.firebase();
  const emails = ["dana@example.com", ...ROSTER.slice(1).map((r) => r.email)];
  let dana: Awaited<ReturnType<typeof w.signedIn>> | null = null;
  for (const email of emails) {
    const b = await w.signedIn(email);
    expect((await b.call("PUT", "/api/auth/device", { token: `token-${email}`, platform: "ios" })).status).toBe(200);
    dana ??= b;
  }
  fcm.invocations.length = 0;
  return { dana: dana!, fcm };
}

describe("the push outbox, sends at once", () => {
  it.each(SEEDS)(
    "two announcements and three cron drains at once, then the rest: every phone hears each once, no invocation past 50 (seed %i)",
    async (seed) => {
      const { dana, fcm } = await clubWithPhones();
      expect((await dana.call("POST", "/api/announcements", news("First"))).status).toBe(201);
      w.db.interleave(seed);
      await Promise.all([
        w.cron(minutes(5)),
        dana.call("POST", "/api/announcements", news("Second"), { now: minutes(5) }),
        w.cron(minutes(5)),
        w.scheduled("*/5 * * * *", minutes(5)),
      ]);
      w.db.interleave(null);
      for (let run = 2; run <= 12; run++) await w.cron(minutes(5 * run));
      const heard = fcm.asked.map((a) => `${a.token} ${a.title}`);
      expect(heard).toHaveLength(2 * PHONES);
      expect(new Set(heard).size).toBe(2 * PHONES);
      expect(fcm.invocations.filter((n) => n > 50)).toEqual([]);
    },
  );
});
