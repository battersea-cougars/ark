import { describe, expect, it } from "vitest";
import type { Tournament } from "../demo/model";
import { editionState, editionWhen, stageOf } from "./edition";

const game = (position: number, status: "next" | "live" | "done", home = 1, away = 2) => ({
  id: position,
  stage: "group" as const,
  position,
  homeTeamId: home,
  awayTeamId: away,
  homeGoals: status === "next" ? null : 1,
  awayGoals: status === "next" ? null : 0,
  status,
});
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
