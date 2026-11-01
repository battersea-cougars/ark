import { describe, expect, it } from "vitest";
import { datesToMake, describeRule, ruleDates, weekdayOf, type Rule } from "./recurrence";

const fridays: Rule = { repeatEvery: 1, weekdays: ["fri"], startsOn: "2026-10-02", endsOn: null };

describe("ruleDates", () => {
  it("makes every Friday from the first session", () => {
    expect(ruleDates(fridays, "2026-10-01", "2026-10-31")).toEqual([
      "2026-10-02",
      "2026-10-09",
      "2026-10-16",
      "2026-10-23",
      "2026-10-30",
    ]);
  });

  it("skips weeks when it repeats every 2 weeks, counted from the first session", () => {
    const fortnightly = { ...fridays, repeatEvery: 2 };
    expect(ruleDates(fortnightly, "2026-10-01", "2026-10-31")).toEqual(["2026-10-02", "2026-10-16", "2026-10-30"]);
  });

  it("handles several weekdays and stops at the last date", () => {
    const rule: Rule = { repeatEvery: 1, weekdays: ["tue", "thu"], startsOn: "2026-10-06", endsOn: "2026-10-13" };
    expect(ruleDates(rule, "2026-10-01", "2026-12-31")).toEqual(["2026-10-06", "2026-10-08", "2026-10-13"]);
  });

  it("knows its weekdays", () => {
    expect(weekdayOf("2026-10-09")).toBe("fri");
    expect(weekdayOf("2026-10-12")).toBe("mon");
  });
});

describe("datesToMake", () => {
  it("doesn't remake a date that has a session, a cancelled one, or a moved one's old date", () => {
    const existing = [
      { heldOn: "2026-10-02" },
      { heldOn: "2026-10-09" }, // cancelled: still a row
      { heldOn: "2026-10-17", movedFrom: "2026-10-16" },
    ];
    const made = datesToMake(fridays, existing, "2026-10-01");
    expect(made[0]).toBe("2026-10-23");
    expect(made).not.toContain("2026-10-16");
  });

  it("makes an ongoing series 12 weeks ahead", () => {
    expect(datesToMake(fridays, [], "2026-10-01")).toHaveLength(12); // 2 Oct to 18 Dec
  });
});

describe("describeRule", () => {
  it("reads like the Gwenda series cards", () => {
    expect(describeRule(fridays)).toBe("Every week on Fri");
    expect(describeRule({ ...fridays, repeatEvery: 2, weekdays: ["thu", "tue"] })).toBe("Every 2 weeks on Tue and Thu");
  });
});
