import { describe, expect, it } from "vitest";
import { byMonth } from "./months";

const on = (startsAt: string) => ({ startsAt });

describe("the calendar's months", () => {
  it("the same month in two years is two months, the later named with its year (#165)", () => {
    const months = byMonth(
      [on("2026-10-16T18:30:00Z"), on("2027-03-05T19:30:00Z"), on("2027-10-15T18:30:00Z")],
      "2026-10-23",
    );
    expect(months.map((m) => [m.key, m.label])).toEqual([
      ["2026-10", "October"],
      ["2027-03", "March 2027"],
      ["2027-10", "October 2027"],
    ]);
  });

  it("goes by London's month: just after midnight on 1 November in London is November", () => {
    const months = byMonth([on("2026-10-31T23:30:00Z"), on("2026-11-01T00:30:00Z")], "2026-10-23");
    expect(months.map((m) => [m.label, m.events.length])).toEqual([
      ["October", 1],
      ["November", 1],
    ]);
  });
});
