import { describe, expect, it } from "vitest";
import { createTestD1 } from "./testing/d1-sqlite";
import { errorReportAllowed } from "./error-report-cap";

const at = (iso: string) => new Date(iso);

describe("the club's daily cap on browser error reports (#201)", () => {
  it("lets the day's first reports through, up to the cap, then none until London's next day", async () => {
    const db = createTestD1();
    const morning = at("2026-11-02T08:00:00Z");
    const passed = [];
    for (let i = 0; i < 4; i++) passed.push(await errorReportAllowed(db, morning, 3));
    expect(passed).toEqual([true, true, true, false]);
    expect(await errorReportAllowed(db, at("2026-11-02T23:59:00Z"), 3)).toBe(false);
    expect(await errorReportAllowed(db, at("2026-11-03T00:00:00Z"), 3)).toBe(true);
  });

  it("counts reports arriving at once, so a burst can't pass the cap", async () => {
    const db = createTestD1();
    db.interleave(7);
    const now = at("2026-11-02T08:00:00Z");
    const all = await Promise.all(Array.from({ length: 20 }, () => errorReportAllowed(db, now, 5)));
    expect(all.filter(Boolean)).toHaveLength(5);
  });

  it("goes by London's day: half past midnight in summer is the new day", async () => {
    const db = createTestD1();
    expect(await errorReportAllowed(db, at("2026-07-01T22:30:00Z"), 1)).toBe(true);
    expect(await errorReportAllowed(db, at("2026-07-01T23:30:00Z"), 1)).toBe(true);
  });
});
