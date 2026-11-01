import { describe, expect, it } from "vitest";
import type { Tournament } from "../demo/model";
import { countdownOf, editionState, editionWhen, stageOf } from "./edition";
import { game } from "./kumite.testing";

const cup = (o: Partial<Tournament> = {}) =>
  ({
    id: 1,
    status: "planned",
    heldOn: "2027-06-12",
    startTime: "11:00",
    endTime: "16:00",
    season: null,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    teams: [{ id: 1 }, { id: 2 }],
    games: [],
    ...o,
  }) as unknown as Tournament;

describe("editionState: by the games, not the settings", () => {
  it("coming up, or sign-up open, until a game's scored", () => {
    expect(editionState(cup({ games: [game(1, "next")] as never }))).toBe("planned");
    expect(editionState(cup({ status: "open" }))).toBe("open");
  });

  it("under way once a game's being scored or has a result, whatever the status says", () => {
    expect(editionState(cup({ games: [game(1, "live"), game(2, "next")] as never }))).toBe("live");
    expect(editionState(cup({ games: [game(1, "done"), game(2, "next")] as never }))).toBe("live");
  });

  it("done once every game's played", () => {
    expect(editionState(cup({ games: [game(1, "done"), game(2, "done")] as never }))).toBe("done");
  });
});

describe("editionWhen", () => {
  it("the day once there is one; just the season until then; the season always", () => {
    expect(editionWhen(cup({ heldOn: "2027-08-31", season: "summer" }))).toMatchObject({
      day: null,
      hours: null,
      season: "Summer 2027",
    });
    expect(editionWhen(cup())).toMatchObject({ hours: "11am to 4pm", season: "Summer 2027" });
    expect(editionWhen(cup()).day).toBeTruthy();
  });
});

describe("stageOf: which of its pages are tabs", () => {
  it("sign-up till teams enter; the teams once they have; the fixtures once there are games", () => {
    expect(stageOf(cup({ teams: [] }))).toBe("signup");
    expect(stageOf(cup())).toBe("teams");
    expect(stageOf(cup({ games: [game(1, "next")] as never }))).toBe("fixtures");
  });

  it("a draft: sign-up till it opens, the draft while it's open, the teams once it's closed", () => {
    expect(stageOf(cup({ kind: "draft", draftState: "none" }))).toBe("signup");
    expect(stageOf(cup({ kind: "draft", draftState: "scheduled" }))).toBe("signup");
    expect(stageOf(cup({ kind: "draft", draftState: "open" }))).toBe("draft");
    expect(stageOf(cup({ kind: "draft", draftState: "closed" }))).toBe("teams");
    expect(stageOf(cup({ kind: "draft", draftState: "closed", games: [game(1, "next")] as never }))).toBe("fixtures");
  });
});

describe("countdownOf: how far off the day is, in the header (ADR 0074)", () => {
  // Thursday 22 October 2026
  const TODAY = "2026-10-22";
  it("within a week it leads: today, tomorrow, this Saturday, in 7 days", () => {
    expect(countdownOf("2026-10-22", TODAY)).toEqual({ lead: "Today" });
    expect(countdownOf("2026-10-23", TODAY)).toEqual({ lead: "Tomorrow" });
    expect(countdownOf("2026-10-24", TODAY)).toEqual({ lead: "This Saturday" });
    expect(countdownOf("2026-10-28", TODAY)).toEqual({ lead: "This Wednesday" });
    expect(countdownOf("2026-10-29", TODAY)).toEqual({ lead: "In 7 days" });
  });
  it("further off, a quiet count after the date; across the clocks going back it still counts whole days", () => {
    expect(countdownOf("2026-11-13", TODAY)).toEqual({ quiet: "in 22 days" });
  });
  it("a day gone by: nothing", () => {
    expect(countdownOf("2026-10-21", TODAY)).toBeNull();
  });
});
