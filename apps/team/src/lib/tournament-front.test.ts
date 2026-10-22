import { describe, expect, it } from "vitest";
import type { Tournament, TournamentType } from "../demo/model";
import {
  afterMomentOf,
  afterNoteWords,
  firstUpOf,
  frontOf,
  nextFightOf,
  nextOf,
  onTheDayOf,
  pageStepOf,
  stageBadge,
  trackLinksOf,
  stepsOf,
} from "./tournament-front";

const ME = 7;
const TODAY = "2026-10-21";
const kumite = { id: 1, slug: "kumite", shortName: "Kumite" } as TournamentType;
const cup = { id: 2, slug: "cup", shortName: "Cup" } as TournamentType;

const game = (
  position: number,
  home: number | null,
  away: number | null,
  status: "next" | "live" | "done" = "next",
) => ({
  id: 100 + position,
  stage: "group" as const,
  position,
  homeTeamId: home,
  awayTeamId: away,
  homeSeed: null,
  awaySeed: null,
  homeGoals: status === "next" ? null : 1,
  awayGoals: status === "next" ? null : 0,
  status,
});
const team = (id: number, captain: number, players: number[] = []) => ({
  id,
  name: "",
  logo: null,
  captainMemberId: captain,
  captainName: "",
  contact: "",
  players: players.map((memberId) => ({ memberId, name: "" })),
});
const draft = (o: Partial<Tournament> = {}) =>
  ({
    id: 10,
    typeId: 1,
    kind: "draft",
    status: "open",
    heldOn: "2026-11-14",
    season: null,
    signupOpensOn: null,
    signupClosesOn: null,
    going: [],
    waitlist: [],
    teams: [],
    games: [],
    draftState: "scheduled",
    ...o,
  }) as unknown as Tournament;
const teamsSet = (o: Partial<Tournament> = {}) =>
  draft({ draftState: "closed", teams: [team(1, 2, [3]), team(2, 4, [ME])], ...o });
const fixtures = (o: Partial<Tournament> = {}) =>
  teamsSet({
    teams: [team(1, 2, [3]), team(2, 4, [ME]), team(3, 5)],
    games: [game(1, 1, 3), game(2, 2, 3)] as never,
    ...o,
  });

describe("nextFightOf: your team's next game", () => {
  it("the first game in the day's order your team's in and hasn't finished", () => {
    expect(nextFightOf(fixtures(), ME)?.id).toBe(102);
    const played = fixtures({ games: [game(1, 2, 1, "done"), game(2, 1, 3), game(3, 3, 2)] as never });
    expect(nextFightOf(played, ME)?.id).toBe(103);
  });

  it("none when you're not on a team, or your games are over (a playoff waiting on seeds isn't yours yet)", () => {
    expect(nextFightOf(fixtures(), 99)).toBeUndefined();
    const over = fixtures({ games: [game(1, 2, 1, "done"), game(2, null, null)] as never });
    expect(nextFightOf(over, ME)).toBeUndefined();
  });

  it("a captain's team is theirs", () => {
    expect(nextFightOf(fixtures(), 2)?.id).toBe(101);
  });
});

describe("frontOf: the page follows the stage, each leading with one thing; the teams live on their tab", () => {
  it("sign-up: are you in (the draft's day is the track's Next, not a card)", () => {
    expect(frontOf(draft(), ME, TODAY)).toEqual(["signup"]);
    expect(frontOf(draft({ kind: "teams" }), ME, TODAY)).toEqual(["signup"]);
  });

  it("the draft on: the draft card leads, your sign-up a small line under it", () => {
    expect(frontOf(draft({ draftState: "open" }), ME, TODAY)).toEqual(["draft", "signup-line"]);
  });

  it("teams set: your team, the draft one line, the fight card to make; no list of the teams", () => {
    expect(frontOf(teamsSet(), ME, TODAY)).toEqual(["my-team", "draft-done", "make-fixtures"]);
    expect(frontOf(teamsSet(), 99, TODAY)).toEqual(["draft-done", "make-fixtures"]);
  });

  it("teams that entered: no draft line; still taking sign-ups, it says so", () => {
    const entered = draft({ kind: "teams", draftState: undefined, teams: [team(1, 2), team(2, ME)] });
    expect(frontOf(entered, ME, TODAY)).toEqual(["my-team", "signup", "make-fixtures"]);
    expect(frontOf({ ...entered, status: "planned" }, ME, TODAY)).toEqual(["my-team", "make-fixtures"]);
  });

  it("fixtures out: the first match, nothing else; sign-up, the draft and the teams go", () => {
    expect(frontOf(fixtures(), ME, TODAY)).toEqual(["first-up"]);
    expect(frontOf(fixtures(), 99, TODAY)).toEqual(["first-up"]);
  });
});

describe("stepsOf: the track says which stage it's at", () => {
  const now = (t: Tournament, today = TODAY) => stepsOf(t, kumite, today).find((s) => s.state === "now")?.step;

  it("a draft goes sign-up, draft, teams, fight card, the day; teams that enter skip the draft", () => {
    expect(stepsOf(draft(), kumite, TODAY).map((s) => s.label)).toEqual([
      "Sign-up",
      "Draft",
      "Teams",
      "Fight card",
      "Kumite!",
    ]);
    expect(stepsOf(draft({ kind: "teams" }), cup, TODAY).map((s) => s.step)).toEqual([
      "signup",
      "teams",
      "fixtures",
      "day",
    ]);
  });

  it("one step is now, those before it done, those after ahead", () => {
    expect(stepsOf(teamsSet(), kumite, TODAY).map((s) => s.state)).toEqual(["done", "done", "now", "ahead", "ahead"]);
    expect(now(draft())).toBe("signup");
    expect(now(draft({ draftState: "open" }))).toBe("draft");
    expect(now(fixtures())).toBe("fixtures");
  });

  it("the day: on its date before the first match, or once a match has started on any day", () => {
    expect(now(fixtures({ heldOn: TODAY }))).toBe("day");
    expect(now(fixtures({ games: [game(1, 1, 3, "live"), game(2, 2, 3)] as never }))).toBe("day");
    // Just a season: no date to be on, so only a started match makes it the day
    expect(now(fixtures({ heldOn: TODAY, season: "summer" as never }))).toBe("fixtures");
  });

  it("every match played: every step done", () => {
    const over = fixtures({ games: [game(1, 1, 3, "done"), game(2, 2, 3, "done")] as never });
    expect(stepsOf(over, kumite, TODAY).every((s) => s.state === "done")).toBe(true);
  });
});

describe("nextOf: what happens next, under the track", () => {
  it("sign-up: it opening, then it closing, then the draft's day (or the first match, for teams that enter)", () => {
    expect(nextOf(draft({ status: "planned", signupOpensOn: "2026-11-01" }), TODAY)).toEqual({
      label: "Sign-up opens",
      on: "2026-11-01",
    });
    expect(nextOf(draft({ signupClosesOn: "2026-11-07" }), TODAY)).toEqual({
      label: "Sign-up closes",
      on: "2026-11-07",
    });
    expect(nextOf(draft({ draftOn: "2026-11-08" }), TODAY)).toEqual({ label: "The draft", on: "2026-11-08" });
    expect(nextOf(draft({ draftOn: null }), TODAY)).toEqual({ label: "The draft", on: null, note: "date to be set" });
    expect(nextOf(draft({ kind: "teams", startTime: "19:00" }), TODAY)).toEqual({
      label: "First match",
      on: "2026-11-14",
      at: "19:00",
    });
  });

  it("past its closing day, sign-up's not next: the draft is", () => {
    expect(nextOf(draft({ signupClosesOn: "2026-10-01", draftOn: "2026-11-08" }), TODAY)?.label).toBe("The draft");
  });

  it("the teams set or the fixtures out: the first match, on the day at its start; just a season, no day yet", () => {
    expect(nextOf(teamsSet({ startTime: "19:00" }), TODAY)).toEqual({
      label: "First match",
      on: "2026-11-14",
      at: "19:00",
    });
    expect(nextOf(fixtures({ season: "summer" as never }), TODAY)).toEqual({
      label: "First match",
      on: null,
      note: "date to be set",
    });
  });

  it("the draft on: the teams, once it closes", () => {
    expect(nextOf(draft({ draftState: "open" }), TODAY)).toEqual({
      label: "The teams",
      on: null,
      note: "once the draft closes",
    });
  });

  it("under way: how far it's got", () => {
    const going = fixtures({ games: [game(1, 1, 3, "done"), game(2, 2, 3, "live"), game(3, 1, 2)] as never });
    expect(nextOf(going, TODAY)).toEqual({ label: "1 of 3 played", on: null });
  });
});

describe("firstUpOf: before the day, the first match and yours", () => {
  it("the first in order of play, marked up next; yours after it when it's a later one", () => {
    const card = firstUpOf(fixtures({ games: [game(2, 2, 3), game(1, 1, 3)] as never }), ME);
    expect(card.games.map((g) => g.position)).toEqual([1, 2]);
    expect(card.upNext?.position).toBe(1);
  });

  it("just the one when it's yours, or you're on no team", () => {
    expect(firstUpOf(fixtures({ games: [game(1, 2, 3), game(2, 1, 3)] as never }), ME).games).toHaveLength(1);
    expect(firstUpOf(fixtures(), 99).games.map((g) => g.position)).toEqual([1]);
  });
});

describe("onTheDayOf: the match on now and the next, nothing else", () => {
  const day = (statuses: ("next" | "live" | "done")[]) =>
    fixtures({
      games: [game(1, 1, 3), game(2, 1, 3), game(3, 3, 1), game(4, 2, 3)].map((g, i) =>
        game(g.position, g.homeTeamId, g.awayTeamId, statuses[i]),
      ) as never,
    });

  it("one on: it, and the first after it", () => {
    const d = onTheDayOf(day(["done", "live", "next", "next"]), ME);
    expect([d.now?.position, d.after?.position, d.live]).toEqual([2, 3, true]);
  });

  it("between matches: the next up, and the one after that", () => {
    const d = onTheDayOf(day(["done", "done", "next", "next"]), ME);
    expect([d.now?.position, d.after?.position, d.live]).toEqual([3, 4, false]);
  });

  it("your next, only when it's neither of those", () => {
    expect(onTheDayOf(day(["live", "next", "next", "next"]), ME).yours?.position).toBe(4);
    expect(onTheDayOf(day(["done", "done", "live", "next"]), ME).yours).toBeUndefined();
  });

  it("all played: nothing on, nothing next", () => {
    const d = onTheDayOf(day(["done", "done", "done", "done"]), ME);
    expect([d.now, d.after, d.yours]).toEqual([undefined, undefined, undefined]);
  });
});

describe("stageBadge: the stamp says where it is", () => {
  it("sign-up open (coming up before it opens), the draft live, the teams set", () => {
    expect(stageBadge(draft(), kumite, TODAY)).toEqual({ label: "Sign-up open", tone: "open" });
    expect(stageBadge(draft({ status: "planned", signupOpensOn: "2026-11-01" }), kumite, TODAY).label).toBe(
      "Coming up",
    );
    expect(stageBadge(draft({ draftState: "open" }), kumite, TODAY)).toEqual({ label: "Draft live", tone: "live" });
    expect(stageBadge(teamsSet(), kumite, TODAY)).toEqual({ label: "Teams set", tone: "set" });
  });

  it("fixtures out: Fixtures out before the day, for every type; on the day itself its own name shouted", () => {
    expect(stageBadge(fixtures(), kumite, TODAY)).toEqual({ label: "Fixtures out", tone: "set" });
    expect(stageBadge(fixtures(), cup, TODAY).label).toBe("Fixtures out");
    expect(stageBadge(fixtures({ heldOn: TODAY }), kumite, TODAY)).toEqual({ label: "Kumite!", tone: "live" });
    expect(stageBadge(fixtures({ heldOn: TODAY }), cup, TODAY).label).toBe("Cup!");
  });

  it("under way on another day: on now; every game played: done", () => {
    const going = fixtures({ games: [game(1, 1, 3, "done"), game(2, 2, 3)] as never });
    expect(stageBadge(going, kumite, TODAY)).toEqual({ label: "On now", tone: "live" });
    const over = fixtures({ games: [game(1, 1, 3, "done"), game(2, 2, 3, "done")] as never });
    expect(stageBadge(over, kumite, TODAY)).toEqual({ label: "Done", tone: "done" });
  });
});

describe("afterwards on the front page (ADR 0074)", () => {
  it("is a quiet line before the day, at every stage", () => {
    expect(afterMomentOf(draft(), TODAY)).toBe("before");
    expect(afterMomentOf(teamsSet(), TODAY)).toBe("before");
    expect(afterMomentOf(fixtures({ heldOn: TODAY }), TODAY)).toBe("before");
  });

  it("isn't shown on the day while more than one match is left: the matches are", () => {
    expect(
      afterMomentOf(fixtures({ heldOn: TODAY, games: [game(1, 1, 3, "live"), game(2, 2, 3)] as never }), TODAY),
    ).toBe(null);
  });

  it("is what's next once the last match is on", () => {
    const last = fixtures({ heldOn: TODAY, games: [game(1, 1, 3, "done"), game(2, 2, 3, "live")] as never });
    expect(afterMomentOf(last, TODAY)).toBe("next");
    const upNext = fixtures({ heldOn: TODAY, games: [game(1, 1, 3, "done"), game(2, 2, 3)] as never });
    expect(afterMomentOf(upNext, TODAY)).toBe("next");
  });

  it("is what's on now once every match is played, that day only", () => {
    const done = fixtures({ heldOn: TODAY, games: [game(1, 1, 3, "done"), game(2, 2, 3, "done")] as never });
    expect(afterMomentOf(done, TODAY)).toBe("now");
    expect(afterMomentOf(done, "2026-10-22")).toBe(null);
    // Marked finished by an admin before the day (or just a season): nothing to go to now
    expect(afterMomentOf(draft({ status: "finished", season: "autumn" }), TODAY)).toBe(null);
  });

  it("says what for in the flow of a line, lower case unless it's a name", () => {
    expect(afterNoteWords("Celebration and awards")).toBe("celebration and awards");
    expect(afterNoteWords("BBQ and awards")).toBe("BBQ and awards");
    expect(afterNoteWords("  ")).toBe("");
  });
});

describe("the track is the series' navigation (ADR 0074)", () => {
  it("at sign-up, only Sign-up opens a page (the front page); the draft only for its captains and whoever runs it", () => {
    expect(trackLinksOf(draft(), "kumite", false)).toEqual({
      signup: "/tournaments/kumite",
      draft: null,
      teams: null,
      fixtures: null,
      day: null,
    });
    expect(trackLinksOf(draft(), "kumite", true).draft).toBe("/tournaments/kumite/draft");
  });

  it("the teams open once there are some; teams that enter have no draft step to open", () => {
    expect(trackLinksOf(teamsSet(), "kumite", false).teams).toBe("/tournaments/kumite/teams");
    expect(trackLinksOf(draft({ draftState: "open" }), "kumite", false).teams).toBe("/tournaments/kumite/teams");
    expect(trackLinksOf(draft({ kind: "teams" }), "cup", true).draft).toBe(null);
  });

  it("the fight card out, the front page is the day's: Sign-up hands it to KUMITE!", () => {
    const links = trackLinksOf(fixtures(), "kumite", true);
    expect(links).toEqual({
      signup: null,
      draft: "/tournaments/kumite/draft",
      teams: "/tournaments/kumite/teams",
      fixtures: "/tournaments/kumite/schedule",
      day: "/tournaments/kumite",
    });
  });

  it("marks the page you're on as its step: the front page is Sign-up, then the day", () => {
    expect(pageStepOf("games", draft())).toBe("signup");
    expect(pageStepOf("games", fixtures())).toBe("day");
    expect(pageStepOf("draft", fixtures())).toBe("draft");
    expect(pageStepOf("tournament-teams", draft())).toBe("teams");
    expect(pageStepOf("schedule", fixtures())).toBe("fixtures");
    // The board isn't a step
    expect(pageStepOf("standings", fixtures())).toBe(null);
  });
});
