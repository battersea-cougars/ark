import { describe, expect, it } from "vitest";
import { dateBadge, formatRange, formatShortDay, formatTime, londonDay } from "./dates";

describe("dates (Europe/London)", () => {
  it("formats in London time across BST", () => {
    expect(formatTime("2026-07-03T18:30:00Z")).toBe("19:30"); // BST
    expect(formatTime("2026-12-04T19:30:00Z")).toBe("19:30"); // GMT
  });

  it("collapses same-day ranges", () => {
    expect(formatRange("2026-12-04T19:30:00Z", "2026-12-04T21:30:00Z")).toBe("Fri 4 Dec 2026 · 19:30 to 21:30");
  });

  it("gives a short day without the year, in London", () => {
    expect(formatShortDay("2026-10-09T23:30:00Z")).toBe("Sat 10 Oct"); // BST: already Saturday
  });

  it("builds a date badge", () => {
    expect(dateBadge("2026-11-14T10:00:00Z")).toEqual({ day: "14", month: "Nov" });
  });

  it("gives the London calendar day", () => {
    expect(londonDay("2026-07-03T23:30:00Z")).toBe("2026-07-04"); // BST: already Saturday
    expect(londonDay("2026-12-04T23:30:00Z")).toBe("2026-12-04"); // GMT
  });
});
