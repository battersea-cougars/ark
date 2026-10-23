// Home's greeting at the edges of its hours, in London's time either side of the clocks changing, and filled in with
// whatever a member is called.
import { describe, expect, it } from "vitest";
import { fill, NAG_FROM, ordinal, slot } from "./greetings";

describe("which greeting, at the edge of each hour", () => {
  // 1 December 2026 is GMT: London's clock is UTC's
  const at = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00Z`);

  it("late runs from 23:00 to 04:59, then it's morning", () => {
    expect(slot(at("22:59"), false)).toBe("evening");
    expect(slot(at("23:00"), false)).toBe("late");
    expect(slot(at("00:00"), false)).toBe("late");
    expect(slot(at("04:59"), false)).toBe("late");
    expect(slot(at("05:00"), false)).toBe("morning");
  });

  it("morning until noon, afternoon until six", () => {
    expect(slot(at("11:59"), false)).toBe("morning");
    expect(slot(at("12:00"), false)).toBe("afternoon");
    expect(slot(at("17:59"), false)).toBe("afternoon");
    expect(slot(at("18:00"), false)).toBe("evening");
  });

  it("goes by London's clock the day the clocks go back and the day they go forward", () => {
    // 25 October 2026: 22:30 UTC is 22:30 GMT, evening; the night before, 22:30 UTC was 23:30 BST, late
    expect(slot(new Date("2026-10-25T22:30:00Z"), false)).toBe("evening");
    expect(slot(new Date("2026-10-24T22:30:00Z"), false)).toBe("late");
    // 29 March 2026: 04:30 UTC is 05:30 BST, morning
    expect(slot(new Date("2026-03-29T04:30:00Z"), false)).toBe("morning");
    expect(slot(new Date("2026-03-28T04:30:00Z"), false)).toBe("late");
  });

  it("too many looks wins even late at night", () => {
    expect(slot(at("02:00"), false, NAG_FROM)).toBe("nag");
    expect(slot(at("02:00"), true, NAG_FROM - 1)).toBe("late");
  });
});

describe("filling a greeting in", () => {
  it("counts the teens and hundreds as people say them", () => {
    expect([0, 11, 12, 13, 111, 112, 113, 121, 1001, 1011].map(ordinal)).toEqual([
      "0th",
      "11th",
      "12th",
      "13th",
      "111th",
      "112th",
      "113th",
      "121st",
      "1001st",
      "1011th",
    ]);
  });

  it("fills every place a value is asked for, and leaves a line without any as it is", () => {
    const v = { name: "Zoë", visits: 2, day: "Friday" };
    expect(fill("{name}, {name}! {nth} time.", v)).toBe("Zoë, Zoë! 2nd time.");
    expect(fill("Skates on.", v)).toBe("Skates on.");
    expect(fill("{unknown} {name}", v)).toBe("{unknown} Zoë");
  });

  // #118: replaceAll read $& and $$ in the name as patterns
  it("a name with a dollar sign in it is greeted as written (#118)", () => {
    expect(fill("Hi {name}!", { name: "Ca$$h", visits: 1, day: "" })).toBe("Hi Ca$$h!");
    expect(fill("Hi {name}!", { name: "Jo $& Co", visits: 1, day: "" })).toBe("Hi Jo $& Co!");
  });
});
