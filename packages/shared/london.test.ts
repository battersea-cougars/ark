// London's dates and times as data, across the clock changes: forward on 29 March 2026 and 28 March 2027 (01:00 GMT
// becomes 02:00 BST), back on 25 October 2026 (02:00 BST becomes 01:00 GMT). The one copy both apps and the Worker use.
import { describe, expect, it } from "vitest";
import { londonDate, londonDay, londonEvening, londonISO, londonTime, londonToday } from "./london";

describe("the instant of a London wall-clock time (londonISO)", () => {
  it("is an hour behind UTC in summer and on UTC in winter", () => {
    expect(londonISO("2026-03-27", "19:30")).toBe("2026-03-27T19:30:00.000Z");
    expect(londonISO("2026-07-03", "19:30")).toBe("2026-07-03T18:30:00.000Z");
    expect(londonISO("2026-10-30", "19:30")).toBe("2026-10-30T19:30:00.000Z");
  });

  it("on the morning the clocks go forward: midnight is GMT, the hour after the jump BST", () => {
    expect(londonISO("2026-03-29", "00:30")).toBe("2026-03-29T00:30:00.000Z");
    expect(londonISO("2026-03-29", "03:00")).toBe("2026-03-29T02:00:00.000Z");
    expect(londonISO("2026-03-29", "19:30")).toBe("2026-03-29T18:30:00.000Z");
    expect(londonISO("2027-03-28", "19:30")).toBe("2027-03-28T18:30:00.000Z");
  });

  it("on the morning the clocks go back: just past midnight is still BST, the evening GMT", () => {
    expect(londonISO("2026-10-25", "00:30")).toBe("2026-10-24T23:30:00.000Z");
    expect(londonISO("2026-10-25", "06:00")).toBe("2026-10-25T06:00:00.000Z");
    expect(londonISO("2026-10-25", "19:30")).toBe("2026-10-25T19:30:00.000Z");
  });

  it("reads back as the day and time it was set, every hour either side of both changes", () => {
    for (const day of ["2026-03-28", "2026-03-29", "2026-03-30", "2026-10-24", "2026-10-25", "2026-10-26"])
      for (const time of ["00:00", "00:30", "03:00", "06:00", "12:00", "19:30", "23:59"]) {
        const at = londonISO(day, time);
        expect(londonDay(at)).toBe(day);
        expect(londonTime(at)).toBe(time);
      }
  });
});

describe("London's date of a moment (londonDate, londonDay, londonToday)", () => {
  it("is already tomorrow at 23:30 UTC in summer, still today in winter", () => {
    expect(londonDay("2026-07-03T23:30:00Z")).toBe("2026-07-04");
    expect(londonDay("2026-12-04T23:30:00Z")).toBe("2026-12-04");
  });

  it("turns over at London's midnight on both nights the clocks change", () => {
    expect(londonToday(new Date("2026-03-28T23:59:00Z"))).toBe("2026-03-28"); // GMT till the jump
    expect(londonToday(new Date("2026-03-29T00:00:00Z"))).toBe("2026-03-29");
    expect(londonToday(new Date("2026-10-24T22:59:00Z"))).toBe("2026-10-24"); // BST till the clocks go back
    expect(londonToday(new Date("2026-10-24T23:00:00Z"))).toBe("2026-10-25");
  });

  it("takes a Date or a number, and is built from its parts as YYYY-MM-DD", () => {
    const at = Date.parse("2026-01-05T09:00:00Z");
    expect(londonDate(at)).toBe("2026-01-05");
    expect(londonDate(new Date(at))).toBe("2026-01-05");
    expect(londonDate(Date.parse("2028-02-29T23:59:00Z"))).toBe("2028-02-29");
  });
});

describe("London's wall clock of an instant (londonTime)", () => {
  it("reads 24-hour, with midnight as 00:00", () => {
    expect(londonTime("2026-07-03T18:30:00Z")).toBe("19:30");
    expect(londonTime("2026-12-31T00:00:00Z")).toBe("00:00");
  });

  it("reads 01:30 twice the night the clocks go back, an hour apart", () => {
    expect(londonTime("2026-10-25T00:30:00Z")).toBe("01:30"); // BST
    expect(londonTime("2026-10-25T01:30:00Z")).toBe("01:30"); // GMT
  });
});

describe("the evening a moment belongs to (londonEvening)", () => {
  it("is the night before's till 06:00 London, that day's from then", () => {
    expect(londonEvening(new Date("2026-07-04T04:59:00Z"))).toBe("2026-07-03"); // 05:59 BST
    expect(londonEvening(new Date("2026-07-04T05:00:00Z"))).toBe("2026-07-04"); // 06:00 BST
    expect(londonEvening(new Date("2026-12-05T05:59:00Z"))).toBe("2026-12-04"); // 05:59 GMT
    expect(londonEvening(new Date("2026-12-05T06:00:00Z"))).toBe("2026-12-05");
  });

  it("runs an hour longer by UTC the night the clocks go back, an hour shorter the night they go forward", () => {
    expect(londonEvening(new Date("2026-10-25T05:59:00Z"))).toBe("2026-10-24"); // 05:59 GMT
    expect(londonEvening(new Date("2026-10-25T06:00:00Z"))).toBe("2026-10-25");
    expect(londonEvening(new Date("2026-03-29T04:59:00Z"))).toBe("2026-03-28"); // 05:59 BST
    expect(londonEvening(new Date("2026-03-29T05:00:00Z"))).toBe("2026-03-29");
  });

  it("goes back across a month and a year", () => {
    expect(londonEvening(new Date("2027-01-01T02:00:00Z"))).toBe("2026-12-31");
    expect(londonEvening(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10-31");
  });
});
