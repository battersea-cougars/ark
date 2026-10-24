// Dues reminders when runs overlap (docs/load-testing.md): an admin's Send while the five-minute cron is sending what's
// queued, or two runs at once. A real D1 runs each statement atomically but interleaves two invocations' statements
// between their awaits; the fake D1 does the same (`interleave`, a seed each run). And a cron run is one Worker
// invocation, held to 50 subrequests on the free plan (ADR 0003): every email, every phone, every call to the live hub.
// Driven through the real handlers in the fake world (ADR 0031), the cron as Cloudflare runs it (`scheduled`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { sendQueued } from "./reminders";

const OWERS = 30;
const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...Array.from({ length: OWERS }, (_, i) => ({
    name: `Ower ${i + 1}`,
    position: "F",
    rating: 50,
    email: `o${i + 1}@example.com`,
  })),
];
const BANK = { name: "Battersea Cougars", sortCode: "12-34-56", account: "12345678" };
const SEEDS = seeds(5);
/** The free plan's subrequests an invocation (ADR 0003). */
const SUBREQUESTS = 50;

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
let dana: Browser;
beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  dana = await w.signedIn("dana@example.com");
  expect((await dana.call("PUT", "/api/settings/bank", BANK)).status).toBe(200);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Everyone owes a kit fee from a month ago; each has the app on this many phones (a phone and a tablet…). */
async function everyoneOwes({ phones = 0 } = {}) {
  const boot = (await dana.club()).body;
  for (let i = 1; i <= OWERS; i++) {
    const id = boot.members.find((m: { name: string }) => m.name === `Ower ${i}`).id;
    const r = await dana.call("POST", `/api/members/${id}/adjustments`, {
      pence: 1500,
      reason: "Kit",
      on: "2026-09-01",
    });
    expect(r.status).toBe(201);
    for (let p = 1; p <= phones; p++) {
      const b = await w.signedIn(`o${i}@example.com`);
      const r = await b.call("PUT", "/api/auth/device", { token: `phone-${i}-${p}`, platform: "ios" });
      expect(r.status).toBe(200);
    }
  }
}
/** Who's been emailed a reminder, and how many times each. */
const reminded = () => {
  const n = new Map<string, number>();
  for (const m of w.mails.filter((x) => /owe|£/i.test(x.subject))) {
    const who = m.subject.match(/for ([^\]]+)\]/)?.[1] ?? m.to.join(", ");
    n.set(who, (n.get(who) ?? 0) + 1);
  }
  return n;
};
const queued = () =>
  (w.db.raw.prepare("SELECT COUNT(*) n FROM dues_reminders WHERE status <> 'sent'").get() as { n: number }).n;

describe("dues reminders when runs overlap", () => {
  it.each(SEEDS)(
    "an admin's Send while the cron sends what's queued: each member emailed once (seed %i)",
    async (seed) => {
      await everyoneOwes();
      w.db.interleave(seed);
      const [sent] = await Promise.all([
        dana.call("POST", "/api/dues/reminders", {}),
        sendQueued(w.env, NOW),
        sendQueued(w.env, NOW),
      ]);
      w.db.interleave(null);
      expect(sent.body.queued).toBe(OWERS);
      // The rest go a few each run, as the five-minute cron would
      for (let run = 1; queued() && run < 10; run++) await sendQueued(w.env, NOW);
      const counts = reminded();
      expect(counts.size).toBe(OWERS);
      expect([...counts.values()].every((n) => n === 1)).toBe(true);
    },
  );

  it.each(SEEDS)("two runs sending what's queued at once: each member emailed once (seed %i)", async (seed) => {
    await everyoneOwes();
    expect((await dana.call("POST", "/api/dues/reminders", {})).status).toBe(200);
    w.db.interleave(seed);
    await Promise.all([sendQueued(w.env, NOW), sendQueued(w.env, NOW)]);
    await Promise.all([sendQueued(w.env, NOW), sendQueued(w.env, NOW)]);
    w.db.interleave(null);
    for (let run = 1; queued() && run < 10; run++) await sendQueued(w.env, NOW);
    expect([...reminded().values()].every((n) => n === 1)).toBe(true);
    expect(reminded().size).toBe(OWERS);
  });

  it("a club-wide send and reminders for everyone: no request or five-minute cron run makes more than 50 subrequests", async () => {
    await everyoneOwes({ phones: 4 });
    const fcm = await w.firebase();
    // A club-wide announcement: the first batch goes with it, the rest wait in the push outbox for the cron
    for (let i = 0; i < 3; i++) {
      const r = await dana.call("POST", "/api/announcements", {
        title: `News ${i}`,
        body: "Read it.",
        link: "",
        endsOn: "2026-10-24",
      });
      expect(r.status).toBe(201);
    }
    // Reminders queued for everyone: the admin's Send (its first few go with it)
    expect((await dana.call("POST", "/api/dues/reminders", {})).status).toBe(200);
    // Then the cron runs, a while apart, until it's all gone
    for (let run = 1; run <= 20; run++) await w.scheduled("*/5 * * * *", new Date(NOW.getTime() + run * 5 * 60_000));
    expect(queued()).toBe(0);
    expect(reminded().size).toBe(OWERS);
    // Every phone heard each announcement and its reminder once
    expect(fcm.asked).toHaveLength(OWERS * 4 * 4);
    expect(new Set(fcm.asked.map((a) => `${a.token} ${a.title}`)).size).toBe(OWERS * 4 * 4);
    expect(fcm.invocations.filter((n) => n > SUBREQUESTS)).toEqual([]);
  });
});
