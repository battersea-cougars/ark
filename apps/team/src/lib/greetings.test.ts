import { describe, expect, it } from "vitest";
import { ordinal } from "./dates";
import { fill, NAG_FROM, slot } from "./greetings";

describe("Home's greeting", () => {
  it("goes by the hour in London, not the device", () => {
    // 9 October 2026 is in British Summer Time (UTC+1)
    expect(slot(new Date("2026-10-09T08:00:00Z"), false)).toBe("morning");
    expect(slot(new Date("2026-10-09T13:00:00Z"), false)).toBe("afternoon");
    expect(slot(new Date("2026-10-09T18:00:00Z"), false)).toBe("evening");
    expect(slot(new Date("2026-10-09T22:30:00Z"), false)).toBe("late");
  });

  it("has its own set on a training night, until it's late", () => {
    expect(slot(new Date("2026-10-09T13:00:00Z"), true)).toBe("training");
    expect(slot(new Date("2026-10-09T22:30:00Z"), true)).toBe("late");
  });

  it("nags once you've looked too often today", () => {
    expect(slot(new Date("2026-10-09T13:00:00Z"), true, NAG_FROM - 1)).toBe("training");
    expect(slot(new Date("2026-10-09T13:00:00Z"), true, NAG_FROM)).toBe("nag");
  });

  it("fills in the name, the visit and the day", () => {
    const line = fill("{nth} look today, {name}. Not {day} yet.", { name: "Sam", visits: 45, day: "Friday" });
    expect(line).toBe("45th look today, Sam. Not Friday yet.");
  });

  it("counts like people do", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 45, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "45th",
      "101st",
      "111th",
    ]);
  });
});
