// When an editor asks what's on (ADR 0122): only a new or moved time, never a season, past midnight the next day.
import { describe, expect, it } from "vitest";
import { eventWindow, tournamentWindow } from "./clashes";

const kumite = { id: 5, heldOn: "2026-11-13", season: null, startTime: "18:00", endTime: "23:00" };

describe("when a save asks what's on", () => {
  it("a new tournament's day and hours, in London", () => {
    expect(tournamentWindow({ ...kumite, id: 0 })).toEqual({
      startsAt: "2026-11-13T18:00:00.000Z",
      endsAt: "2026-11-13T23:00:00.000Z",
      except: undefined,
    });
  });

  it("an edit asks only when the day or hours moved, and never about itself", () => {
    expect(tournamentWindow(kumite, kumite)).toBeNull();
    expect(tournamentWindow({ ...kumite, startTime: "17:00" }, kumite)?.except).toBe("tournament:5");
  });

  it("just a season isn't a time to ask about", () => {
    expect(tournamentWindow({ ...kumite, season: "summer" })).toBeNull();
  });

  it("hours past midnight end the next day", () => {
    expect(tournamentWindow({ ...kumite, id: 0, endTime: "01:00" })?.endsAt).toBe("2026-11-14T01:00:00.000Z");
  });

  it("a one-off's times, unless they haven't moved", () => {
    const quiz = { id: 3, startsAt: "2026-11-13T19:00:00.000Z", endsAt: "2026-11-13T22:00:00.000Z" };
    expect(eventWindow(quiz, quiz)).toBeNull();
    expect(eventWindow({ startsAt: quiz.startsAt, endsAt: quiz.endsAt })).toMatchObject({
      startsAt: quiz.startsAt,
      endsAt: quiz.endsAt,
    });
  });
});
