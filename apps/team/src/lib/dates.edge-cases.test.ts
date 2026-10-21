// London dates and times at their edges: the nights the clocks change (29 March and 25 October 2026), London's
// midnight against UTC's, the end of the year and a leap day; and money, as members read it.
import { describe, expect, it } from "vitest";
import { londonISO as sharedLondonISO } from "@cougars/shared/london";
import { clock, clockRange, dateBadge, formatDayDate, formatTime, londonISO, londonToday, pounds } from "./dates";

describe("a session's time, stored as London's wall clock", () => {
  it("is the same instant either side of the clocks changing: 7:30pm is 18:30 UTC in summer, 19:30 in winter", () => {
    expect(londonISO("2026-03-27", "19:30")).toBe("2026-03-27T19:30:00.000Z"); // the Friday before: GMT
    expect(londonISO("2026-04-03", "19:30")).toBe("2026-04-03T18:30:00.000Z"); // the Friday after: BST
    expect(londonISO("2026-10-23", "19:30")).toBe("2026-10-23T18:30:00.000Z"); // BST
    expect(londonISO("2026-10-30", "19:30")).toBe("2026-10-30T19:30:00.000Z"); // GMT again
  });

  it("on the day the clocks change, an evening session is on that day's clock, not the night before's", () => {
    expect(londonISO("2026-03-29", "19:30")).toBe("2026-03-29T18:30:00.000Z");
    expect(londonISO("2026-10-25", "19:30")).toBe("2026-10-25T19:30:00.000Z");
    // Just past midnight on the night they go back is still summer time
    expect(londonISO("2026-10-25", "00:30")).toBe("2026-10-24T23:30:00.000Z");
    // The hour after they go forward
    expect(londonISO("2026-03-29", "02:30")).toBe("2026-03-29T01:30:00.000Z");
  });

  it("reads back as the time it was set: what the editor saves is what everyone sees", () => {
    for (const day of ["2026-03-28", "2026-03-29", "2026-03-30", "2026-10-24", "2026-10-25", "2026-10-26"])
      for (const t of ["06:00", "12:00", "19:30", "23:59"]) {
        const at = londonISO(day, t);
        expect(londonToday(new Date(at))).toBe(day);
        expect(formatTime(at)).toBe(clock(t));
      }
  });

  it("a late session, at 23:59, is still that day, and the end of the year is still the year", () => {
    expect(londonISO("2026-12-31", "23:59")).toBe("2026-12-31T23:59:00.000Z");
    expect(londonToday(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
    expect(londonToday(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01-01");
    // In summer, 23:30 UTC is already tomorrow in London
    expect(londonISO("2026-07-31", "23:59")).toBe("2026-07-31T22:59:00.000Z");
    expect(londonToday(new Date("2026-07-31T23:30:00Z"))).toBe("2026-08-01");
  });

  it("a leap day is a day like any other", () => {
    expect(londonISO("2028-02-29", "19:30")).toBe("2028-02-29T19:30:00.000Z");
    expect(londonToday(new Date("2028-02-29T23:59:00Z"))).toBe("2028-02-29");
    expect(londonToday(new Date("2028-03-01T00:00:00Z"))).toBe("2028-03-01");
    expect(formatDayDate("2028-02-29T19:30:00Z")).toBe("Tue 29 Feb");
  });

  it("is worked out the same way on the website's side of the agenda (shared/london.ts)", () => {
    for (const [day, t] of [
      ["2026-03-29", "00:30"],
      ["2026-03-29", "02:30"],
      ["2026-10-25", "00:30"],
      ["2026-10-25", "01:30"],
      ["2026-10-25", "19:30"],
      ["2028-02-29", "19:30"],
    ])
      expect(londonISO(day, t)).toBe(sharedLondonISO(day, t));
  });
});

describe("a date, as London reads it", () => {
  it("an instant late on a summer Saturday in UTC is Sunday's date badge in London", () => {
    expect(formatDayDate("2026-10-24T23:30:00Z")).toBe("Sun 25 Oct");
    expect(dateBadge("2026-08-01T23:30:00Z")).toEqual({ weekday: "Sun", day: "2", month: "Aug" });
  });

  it("in winter, London and UTC share the date until midnight", () => {
    expect(dateBadge("2026-03-28T23:30:00Z")).toEqual({ weekday: "Sat", day: "28", month: "Mar" });
    expect(formatDayDate("2026-12-31T23:59:00Z")).toBe("Thu 31 Dec");
  });
});

describe("times to read", () => {
  it("midnight and noon are 12am and 12pm, and a minute before midnight 11:59pm", () => {
    expect(clock("00:00")).toBe("12am");
    expect(clock("12:00")).toBe("12pm");
    expect(clock("23:59")).toBe("11:59pm");
    expect(clock("11:59")).toBe("11:59am");
  });

  it("a span says am or pm once when both share it, and both when it crosses noon or midnight", () => {
    expect(clockRange("19:30", "21:00")).toBe("7:30 to 9pm");
    expect(clockRange("11:00", "13:00")).toBe("11am to 1pm");
    expect(clockRange("23:00", "00:30")).toBe("11pm to 12:30am");
    // A session with no length is just its time
    expect(clockRange("19:30", "19:30")).toBe("7:30pm");
  });

  it("a time that isn't one is shown as it came, rather than as NaN", () => {
    expect(clock("tbc")).toBe("tbc");
  });
});

describe("money", () => {
  it("whole pounds read short, and pence when there are some", () => {
    expect(pounds(1000)).toBe("£10");
    expect(pounds(0)).toBe("£0");
    expect(pounds(1999)).toBe("£19.99");
    expect(pounds(5)).toBe("£0.05");
    expect(pounds(1)).toBe("£0.01");
    expect(pounds(123456)).toBe("£1,234.56");
  });

  // #117: minimumFractionDigits 0 drops a trailing zero, so a £7.50 night reads "£7.5" on My tab and Home
  it.fails("an amount with pence shows both digits of them: £10.50, never £10.5 (known bug #117)", () => {
    expect(pounds(1050)).toBe("£10.50");
    expect(pounds(750)).toBe("£7.50");
    expect(pounds(-250)).toBe("-£2.50");
  });
});
