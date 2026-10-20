import { describe, expect, it } from "vitest";
import { nextSession, scoreboard } from "./next-session";

const at = (iso: string) => Date.parse(iso);
const friday = (now: string) => nextSession("Friday", "19:30", "21:30", at(now));

describe("the next Friday session", () => {
  it("is this Friday, in London time, from earlier in the week", () => {
    // Tuesday 6 October 2026: British Summer Time, so 19:30 in London is 18:30 UTC
    expect(friday("2026-10-06T11:00:00Z")).toEqual({
      startsAt: "2026-10-09T18:30:00.000Z",
      endsAt: "2026-10-09T20:30:00.000Z",
    });
  });

  it("is the one being played until it's over, then next week's", () => {
    expect(friday("2026-10-09T19:00:00Z")?.startsAt).toBe("2026-10-09T18:30:00.000Z");
    expect(friday("2026-10-09T20:29:59Z")?.startsAt).toBe("2026-10-09T18:30:00.000Z");
    expect(friday("2026-10-09T20:30:00Z")?.startsAt).toBe("2026-10-16T18:30:00.000Z");
  });

  it("is next week's from a Saturday", () => {
    expect(friday("2026-10-10T10:00:00Z")?.startsAt).toBe("2026-10-16T18:30:00.000Z");
  });

  it("keeps London's 19:30 across the clocks going back and forward", () => {
    // Clocks go back on Sunday 25 October 2026: the next Friday is GMT, 19:30 is 19:30 UTC
    expect(friday("2026-10-24T12:00:00Z")?.startsAt).toBe("2026-10-30T19:30:00.000Z");
    // Clocks go forward on Sunday 29 March 2026: that Friday is BST again
    expect(friday("2026-03-28T12:00:00Z")?.startsAt).toBe("2026-04-03T18:30:00.000Z");
  });

  it("is nothing for a day that isn't one", () => {
    expect(nextSession("Fryday", "19:30", "21:30")).toBeNull();
  });
});

describe("the scoreboard", () => {
  const session = { startsAt: "2026-10-09T18:30:00.000Z", endsAt: "2026-10-09T20:30:00.000Z" };

  it("counts days and hours, then hours and minutes, then the last hour to the second", () => {
    expect(scoreboard(session, at("2026-10-06T11:00:00Z"))).toBe("Face-off in 3d 07h");
    expect(scoreboard(session, at("2026-10-09T14:05:00Z"))).toBe("Face-off in 4h 25m");
    expect(scoreboard(session, at("2026-10-09T18:29:01Z"))).toBe("Face-off in 00:59");
    expect(scoreboard(session, at("2026-10-09T17:48:00Z"))).toBe("Face-off in 42:00");
  });

  it("says it's on, and till when in London, once it's started", () => {
    expect(scoreboard(session, at("2026-10-09T18:30:00Z"))).toBe("Playing now · till 21:30");
  });
});
