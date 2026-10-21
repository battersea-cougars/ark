import { describe, expect, it } from "vitest";
import type { Tournament, TournamentType } from "../demo/model";
import { fightCardOf, frontOf, nextFightOf, stageBadge } from "./tournament-front";

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

describe("frontOf: the page follows the stage, each leading with one thing", () => {
  it("sign-up: are you in, then the draft (its day and captains); a team-entry one has no draft", () => {
    expect(frontOf(draft(), ME, TODAY)).toEqual(["signup", "draft"]);
    expect(frontOf(draft({ kind: "teams" }), ME, TODAY)).toEqual(["signup"]);
  });

  it("the draft on: the draft card leads, your sign-up a small line under it", () => {
    expect(frontOf(draft({ draftState: "open" }), ME, TODAY)).toEqual(["draft", "signup-line"]);
  });

  it("teams set: your team leads, then the others, the draft one line; off a team, the teams lead", () => {
    expect(frontOf(teamsSet(), ME, TODAY)).toEqual(["my-team", "teams", "draft-done", "make-fixtures"]);
    expect(frontOf(teamsSet(), 99, TODAY)).toEqual(["teams", "draft-done", "make-fixtures"]);
  });

  it("teams that entered: no draft line; still taking sign-ups, it says so under the teams", () => {
    const entered = draft({ kind: "teams", draftState: undefined, teams: [team(1, 2), team(2, ME)] });
    expect(frontOf(entered, ME, TODAY)).toEqual(["my-team", "teams", "signup", "make-fixtures"]);
    expect(frontOf({ ...entered, status: "planned" }, ME, TODAY)).toEqual(["my-team", "teams", "make-fixtures"]);
  });

  it("fixtures out: the fight card leads, every game in one list, then the teams; sign-up and the draft go", () => {
    expect(frontOf(fixtures(), ME, TODAY)).toEqual(["fight-card", "teams"]);
    expect(frontOf(fixtures(), 99, TODAY)).toEqual(["fight-card", "teams"]);
  });
});

describe("fightCardOf: the front page's fight card", () => {
  const eight = (statuses: ("next" | "live" | "done")[] = []) =>
    fixtures({
      games: [
        game(1, 1, 3),
        game(2, 2, 3),
        game(3, 1, 2),
        game(4, 3, 1),
        game(5, 3, 2),
        game(6, 2, 1),
        game(7, 1, 3),
        game(8, 2, 3),
      ].map((g, i) => ({
        ...g,
        ...(statuses[i] ? game(g.position, g.homeTeamId, g.awayTeamId, statuses[i]) : {}),
      })) as never,
    });

  it("a few games (six or fewer): all of them, in order of play, the first marked up next", () => {
    const card = fightCardOf(fixtures({ games: [game(2, 2, 3), game(1, 1, 3)] as never }), ME);
    expect(card.games.map((g) => g.position)).toEqual([1, 2]);
    expect(card.upNext?.position).toBe(1);
    expect(card.whole).toBe(true);
  });

  it("more: your games and the next one, the rest on the full fight card", () => {
    const card = fightCardOf(eight(), ME);
    expect(card.games.map((g) => g.position)).toEqual([1, 2, 3, 5, 6, 8]);
    expect(card.whole).toBe(false);
    // Not on a team: just the next one
    expect(fightCardOf(eight(), 99).games.map((g) => g.position)).toEqual([1]);
  });

  it("under way: the game on is shown, the next after it is up next, and your played games drop off a long card", () => {
    const card = fightCardOf(eight(["done", "done", "live"]), ME);
    expect(card.upNext?.position).toBe(4);
    expect(card.games.map((g) => g.position)).toEqual([3, 4, 5, 6, 8]);
    expect(fightCardOf(fixtures({ games: [game(1, 1, 3, "done"), game(2, 2, 3)] as never }), ME).upNext?.position).toBe(
      2,
    );
  });

  it("every game played: nothing's up next", () => {
    expect(fightCardOf(fixtures({ games: [game(1, 1, 3, "done")] as never }), ME).upNext).toBeUndefined();
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
