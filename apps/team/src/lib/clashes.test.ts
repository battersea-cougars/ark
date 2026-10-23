// When an editor asks what's on (ADR 0122): only a new or moved time, never a season, past midnight the next day.
import { describe, expect, it } from "vitest";
import {
  answerAll,
  answerOfAll,
  choiceOf,
  eventWindow,
  nightsToSkip,
  skipLabel,
  tournamentWindow,
  trainingQuestion,
} from "./clashes";

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

  it("a training asks with its rule and hours, unless they haven't moved or it's paused", () => {
    const friday = {
      id: 1,
      active: true,
      repeatEvery: 1,
      weekdays: ["fri", "sat"] as ("fri" | "sat")[],
      startsOn: "2026-01-02",
      endsOn: null,
      startTime: "19:30",
      endTime: "21:30",
    };
    expect(trainingQuestion({ ...friday, id: 0 })).toMatchObject({ seriesId: undefined, weekdays: ["fri", "sat"] });
    expect(trainingQuestion(friday, friday)).toBeNull();
    expect(trainingQuestion({ ...friday, weekdays: ["sat", "fri"] }, friday)).toBeNull();
    expect(trainingQuestion({ ...friday, startTime: "19:00" }, friday)).toMatchObject({
      seriesId: 1,
      startTime: "19:00",
    });
    expect(trainingQuestion({ ...friday, active: false })).toBeNull();
    // Back on after a pause: every night is new again
    expect(trainingQuestion(friday, { ...friday, active: false })).toMatchObject({ seriesId: 1 });
  });
});

describe("answering the clash sheet", () => {
  const night = (n: number) => ({ key: `session:${n}`, canCancel: true, nights: ["2026-10-16"] });
  const kumite = { key: "tournament:5", canCancel: false, nights: ["2026-10-16", "2026-10-17"] };
  const rows = [night(1), night(2), kumite];

  it("a row the admin can call off is cancelled or kept; one that stays on can skip the training, if it's one", () => {
    expect(choiceOf(night(1), true)).toBe("cancel");
    expect(choiceOf(kumite, true)).toBe("skip");
    // A tournament's or a one-off's editor has no nights of its own to skip
    expect(choiceOf({ ...kumite, nights: undefined }, false)).toBeNull();
    expect(choiceOf(kumite, false)).toBeNull();
  });

  it("one answer for all sets every row that can be called off, and leaves the skip alone", () => {
    const picks = answerAll(rows, { "session:1": "", "session:2": "keep", "tournament:5": "skip" }, "cancel");
    expect(picks).toEqual({ "session:1": "cancel", "session:2": "cancel", "tournament:5": "skip" });
    expect(answerOfAll(rows, picks)).toBe("cancel");
  });

  // Keep both, for all of these, is all of them: the tournament's row that stays on too, or Save waits for it (#171)
  it("Keep both for all keeps every row, the one that stays on too", () => {
    const picks = answerAll(rows, { "session:1": "", "session:2": "cancel", "tournament:5": "" }, "keep");
    expect(picks).toEqual({ "session:1": "keep", "session:2": "keep", "tournament:5": "keep" });
    expect(answerOfAll(rows, picks)).toBe("keep");
  });

  it("the answer for all is the rows' own when they agree, and none once one is changed", () => {
    expect(answerOfAll(rows, { "session:1": "", "session:2": "" })).toBe("");
    expect(answerOfAll(rows, { "session:1": "keep", "session:2": "keep" })).toBe("keep");
    expect(answerOfAll(rows, { "session:1": "keep", "session:2": "cancel" })).toBe("");
  });

  it("the training's nights to skip, each once", () => {
    const quiz = { key: "club_event:3", canCancel: false, nights: ["2026-10-16"] };
    expect(
      nightsToSkip([...rows, quiz], { "tournament:5": "skip", "club_event:3": "skip", "session:1": "cancel" }),
    ).toEqual(["2026-10-16", "2026-10-17"]);
    expect(nightsToSkip(rows, { "tournament:5": "keep" })).toEqual([]);
  });

  it("skipping says which training, short enough to sit beside Keep both", () => {
    expect(skipLabel("Juniors")).toBe("Skip Juniors that night");
    expect(skipLabel("Wednesday Development Session")).toBe("Skip training that night");
  });
});
