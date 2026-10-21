// A calendar file's text at its edges: what iCalendar escapes, and names that aren't plain ASCII.
import { describe, expect, it } from "vitest";
import type { Bookable } from "../demo/model";
import { icsFor } from "./ics";

const event = (over: Partial<Bookable>) =>
  ({
    key: "session:12",
    title: "Friday Training",
    startsAt: "2026-10-09T18:30:00.000Z",
    endsAt: "2026-10-09T20:30:00.000Z",
    venue: "",
    ...over,
  }) as Bookable;
const line = (ics: string, name: string) => ics.split("\r\n").find((l) => l.startsWith(`${name}:`));

describe("a calendar file's text", () => {
  it("escapes semicolons, commas, backslashes and newlines in the name, so the calendar reads it whole", () => {
    const ics = icsFor(event({ title: "Drinks; then, food\\more\nafter" }));
    expect(line(ics, "SUMMARY")).toBe("SUMMARY:Drinks\\; then\\, food\\\\more\\nafter");
    // Nothing breaks the file into extra lines
    expect(ics.split("\r\n")).toHaveLength(12);
  });

  it("keeps accents and emoji as they are", () => {
    expect(line(icsFor(event({ title: "Zoë's 🏒 night" })), "SUMMARY")).toBe("SUMMARY:Zoë's 🏒 night");
  });

  it("joins a venue and its address, escaping both", () => {
    const ics = icsFor(event({ venue: "Rink; Main", address: "1 Road, London" }));
    expect(line(ics, "LOCATION")).toBe("LOCATION:Rink\\; Main\\, 1 Road\\, London");
  });

  it("stamps the time it was made, in UTC, with no milliseconds", () => {
    const ics = icsFor(event({}), new Date("2026-10-25T01:30:45.678Z"));
    expect(line(ics, "DTSTAMP")).toBe("DTSTAMP:20261025T013045Z");
    expect(line(ics, "DTSTART")).toBe("DTSTART:20261009T183000Z");
  });

  it("ends every line with CRLF, the file too", () => {
    const ics = icsFor(event({}));
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
});
