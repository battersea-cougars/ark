import { describe, expect, it } from "vitest";
import type { Bookable } from "../demo/model";
import { icsFor } from "./ics";

const friday = {
  key: "session:12",
  title: "Friday Training",
  startsAt: "2026-10-09T18:30:00.000Z",
  endsAt: "2026-10-09T20:30:00.000Z",
  venue: "Battersea Sports Centre, Burns Road",
} as Bookable;

describe("a calendar file for a session", () => {
  it("has the session's times in UTC, its name and its place, with commas escaped", () => {
    const ics = icsFor(friday, new Date("2026-10-07T08:00:00Z"));
    expect(ics).toContain("DTSTART:20261009T183000Z\r\n");
    expect(ics).toContain("DTEND:20261009T203000Z\r\n");
    expect(ics).toContain("SUMMARY:Friday Training\r\n");
    expect(ics).toContain("LOCATION:Battersea Sports Centre\\, Burns Road\r\n");
    expect(ics).toContain("UID:session:12@team.batterseacougars\r\n");
  });

  it("leaves the place out when there isn't one", () => {
    expect(icsFor({ ...friday, venue: "" })).not.toContain("LOCATION");
  });
});
