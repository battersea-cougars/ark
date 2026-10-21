// A training's rule at its edges: the clocks changing (none of it is in a time zone, so nothing should move), leap
// years, the year's end, every other week across a year, a rule of one day, and windows that hold nothing.
import { describe, expect, it } from "vitest";
import { addDays, datesToMake, describeRule, ruleDates, weekdayOf, type Rule } from "./recurrence";

const fridays: Rule = { repeatEvery: 1, weekdays: ["fri"], startsOn: "2026-01-02", endsOn: null };

describe("a training's dates where the calendar's awkward", () => {
  it("the clocks going forward (29 March) and back (25 October) don't move a Sunday training or skip a week", () => {
    const sundays: Rule = { repeatEvery: 1, weekdays: ["sun"], startsOn: "2026-03-22", endsOn: null };
    expect(ruleDates(sundays, "2026-03-22", "2026-04-05")).toEqual(["2026-03-22", "2026-03-29", "2026-04-05"]);
    expect(ruleDates(sundays, "2026-10-18", "2026-11-01")).toEqual(["2026-10-18", "2026-10-25", "2026-11-01"]);
  });

  it("every other week keeps its rhythm across the clocks going back", () => {
    const fortnightly: Rule = { repeatEvery: 2, weekdays: ["sun"], startsOn: "2026-10-11", endsOn: null };
    expect(ruleDates(fortnightly, "2026-10-01", "2026-11-30")).toEqual([
      "2026-10-11",
      "2026-10-25",
      "2026-11-08",
      "2026-11-22",
    ]);
  });

  it("adding days across a changeover is whole days", () => {
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
  });

  it("a leap year has 29 February: a Tuesday training in 2028 meets on it; 2027 has no 29th", () => {
    const tuesdays: Rule = { repeatEvery: 1, weekdays: ["tue"], startsOn: "2028-01-04", endsOn: null };
    expect(weekdayOf("2028-02-29")).toBe("tue");
    expect(ruleDates(tuesdays, "2028-02-20", "2028-03-08")).toEqual(["2028-02-22", "2028-02-29", "2028-03-07"]);
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("every other week counts on across the new year", () => {
    const fortnightly: Rule = { repeatEvery: 2, weekdays: ["fri"], startsOn: "2026-12-18", endsOn: null };
    expect(ruleDates(fortnightly, "2026-12-01", "2027-01-31")).toEqual([
      "2026-12-18",
      "2027-01-01",
      "2027-01-15",
      "2027-01-29",
    ]);
  });

  it("a rule that starts midweek counts its weeks from the Monday of its first week", () => {
    // Starts on a Wednesday, Mondays and Fridays every other week: that week's Monday is before it, so not made
    const rule: Rule = { repeatEvery: 2, weekdays: ["mon", "fri"], startsOn: "2026-10-07", endsOn: null };
    expect(ruleDates(rule, "2026-10-01", "2026-10-31")).toEqual(["2026-10-09", "2026-10-19", "2026-10-23"]);
  });

  it("first and last the same day: one session, if it's on the rule's day", () => {
    expect(ruleDates({ ...fridays, startsOn: "2026-10-09", endsOn: "2026-10-09" }, "2026-10-01", "2026-12-31")).toEqual(
      ["2026-10-09"],
    );
    expect(ruleDates({ ...fridays, startsOn: "2026-10-08", endsOn: "2026-10-08" }, "2026-10-01", "2026-12-31")).toEqual(
      [],
    );
  });

  it("a window that ends before it starts, or before the rule's first day, or after its last, holds nothing", () => {
    expect(ruleDates(fridays, "2026-10-31", "2026-10-01")).toEqual([]);
    expect(ruleDates({ ...fridays, startsOn: "2027-01-01" }, "2026-10-01", "2026-12-31")).toEqual([]);
    expect(ruleDates({ ...fridays, endsOn: "2026-09-25" }, "2026-10-01", "2026-12-31")).toEqual([]);
  });

  it("every day of the week, every week: seven a week", () => {
    const daily: Rule = {
      repeatEvery: 1,
      weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      startsOn: "2026-10-05",
      endsOn: null,
    };
    expect(ruleDates(daily, "2026-10-05", "2026-10-18")).toHaveLength(14);
  });
});

describe("what's still to make", () => {
  it("today is included when it's a session day", () => {
    expect(datesToMake(fridays, [], "2026-10-09", "2026-10-16")).toEqual(["2026-10-09", "2026-10-16"]);
  });

  it("the horizon is 12 weeks: the Friday 84 days on is made, the one after isn't", () => {
    const made = datesToMake(fridays, [], "2026-10-09");
    expect(made).toHaveLength(13);
    expect(made.at(-1)).toBe(addDays("2026-10-09", 84));
  });

  it("a session moved onto another rule date doesn't make that date twice", () => {
    // The 16th's moved to the 23rd: the 16th (moved from) and the 23rd (held on) are both taken
    const made = datesToMake(fridays, [{ heldOn: "2026-10-23", movedFrom: "2026-10-16" }], "2026-10-09", "2026-10-30");
    expect(made).toEqual(["2026-10-09", "2026-10-30"]);
  });
});

describe("how a rule reads", () => {
  it("one day, every week; several, every few weeks; no day at all", () => {
    expect(describeRule(fridays)).toBe("Every week on Fri");
    expect(describeRule({ ...fridays, repeatEvery: 3, weekdays: ["sun", "mon", "wed"] })).toBe(
      "Every 3 weeks on Mon, Wed and Sun",
    );
    expect(describeRule({ ...fridays, weekdays: [] })).toBe("Every week on no day");
  });
});
