import { describe, expect, it } from "vitest";
import type { Tournament, TournamentType } from "../demo/model";
import {
  afterMomentOf,
  afterNoteWords,
  currentMatchOf,
  nextFightOf,
  nextOf,
  onTheDayOf,
  reached,
  stageBadge,
  statusesOf,
  statusHref,
  statusOf,
  viewOf,
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

  it("the draft open: the teams, once it closes", () => {
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

  it("fixtures out: Fixtures set before the day, for every type; on the day itself its own name shouted", () => {
    expect(stageBadge(fixtures(), kumite, TODAY)).toEqual({ label: "Fixtures set", tone: "set" });
    expect(stageBadge(fixtures(), cup, TODAY).label).toBe("Fixtures set");
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

describe("statusesOf: one page, by status (ADR 0074)", () => {
  // "Fight Card is confusing if we think of the kumite in stages. It should really be a status: Draft Open, Draft
  // Completed, Fixtures Created, Kumite!" (the user, 2026-10-22)
  const now = (t: Tournament, today = TODAY) => statusesOf(t, kumite, today).find((s) => s.state === "now")?.status;

  it("a draft: Sign-up open, Draft open, Teams set, Fixtures set, KUMITE!, the afterwards; teams that enter skip the draft", () => {
    expect(statusesOf(draft(), kumite, TODAY, "The Anchor").map((s) => s.label)).toEqual([
      "Sign-up open",
      "Draft open",
      "Teams set",
      "Fixtures set",
      "Kumite!",
      "The Anchor",
    ]);
    expect(statusesOf(draft({ kind: "teams" }), cup, TODAY).map((s) => s.label)).toEqual([
      "Sign-up open",
      "Teams set",
      "Fixtures set",
      "Cup!",
      "Afters",
    ]);
  });

  it("is at sign-up till the draft opens; then open, the teams set once it's closed, the fixtures out, the day", () => {
    expect(now(draft())).toBe("signup");
    expect(now(draft({ draftState: "open" }))).toBe("draft");
    expect(now(teamsSet())).toBe("teams");
    expect(now(fixtures())).toBe("fixtures");
    expect(now(fixtures({ heldOn: TODAY }))).toBe("day");
    expect(now(fixtures({ games: [game(1, 1, 3, "live"), game(2, 2, 3)] as never }))).toBe("day");
    // Just a season: no date to be on, so only a started match makes it the day
    expect(now(fixtures({ heldOn: TODAY, season: "summer" as never }))).toBe("fixtures");
    // Teams that enter: in once a team has entered
    expect(statusOf(draft({ kind: "teams", teams: [team(1, 2)] }), TODAY)).toBe("teams");
  });

  it("those before it done, those after ahead; every match played, the after-party's where it is", () => {
    expect(statusesOf(teamsSet(), kumite, TODAY).map((s) => s.state)).toEqual([
      "done",
      "done",
      "now",
      "ahead",
      "ahead",
      "ahead",
    ]);
    const over = fixtures({ games: [game(1, 1, 3, "done"), game(2, 2, 3, "done")] as never });
    expect(statusesOf(over, kumite, TODAY).map((s) => s.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "now",
    ]);
  });

  it("short names for a phone's track", () => {
    expect(statusesOf(draft(), kumite, TODAY, "The Anchor").map((s) => s.short)).toEqual([
      "Sign-up",
      "Draft",
      "Teams",
      "Fixtures",
      "Kumite!",
      "Anchor",
    ]);
  });
});

describe("reached: only a status it's been through (or is at) can be looked at", () => {
  it("up to the one it's at, not past it", () => {
    const t = teamsSet();
    expect(["signup", "draft", "teams", "fixtures", "day"].map((s) => reached(t, TODAY, s as never))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("teams that enter never reach a draft", () => {
    expect(reached(fixtures({ kind: "teams" }), TODAY, "draft")).toBe(false);
  });
});

describe("viewOf: which status the page shows for its address", () => {
  it("the page's own address: the status it's at", () => {
    expect(viewOf(fixtures(), TODAY, "")).toBe("fixtures");
    expect(viewOf(draft({ draftState: "open" }), TODAY, "")).toBe("draft");
  });

  it("a status's own address, once it's reached: that status (the old pages' addresses keep working)", () => {
    expect(viewOf(fixtures(), TODAY, "draft")).toBe("draft");
    expect(viewOf(fixtures(), TODAY, "teams")).toBe("teams");
    expect(viewOf(fixtures(), TODAY, "sign-up")).toBe("signup");
    expect(viewOf(fixtures(), TODAY, "schedule")).toBe("fixtures");
  });

  it("one not reached yet, or an address that isn't one: the status it's at", () => {
    // A push about the draft opening, tapped before it has: sign-up, where it is
    expect(viewOf(draft(), TODAY, "draft")).toBe("signup");
    expect(viewOf(teamsSet(), TODAY, "schedule")).toBe("teams");
    expect(viewOf(teamsSet(), TODAY, "nonsense")).toBe("teams");
  });

  it("the track's links: the status it's at is the page itself; one gone by, its own address", () => {
    expect(statusHref("kumite", fixtures(), TODAY, "fixtures")).toBe("/tournaments/kumite");
    expect(statusHref("kumite", fixtures(), TODAY, "draft")).toBe("/tournaments/kumite/draft");
    expect(statusHref("kumite", fixtures(), TODAY, "signup")).toBe("/tournaments/kumite/sign-up");
  });
});

describe("currentMatchOf: the match the carousel brings forward", () => {
  it("the one on now, whatever's before it", () => {
    expect(currentMatchOf([game(1, 1, 2, "done"), game(3, 1, 3), game(2, 2, 3, "live")])?.position).toBe(2);
  });
  it("between matches, the next in the day's order", () => {
    expect(currentMatchOf([game(2, 2, 3), game(1, 1, 2, "done"), game(3, 1, 3)])?.position).toBe(2);
  });
  it("before the first, the first; every one played, the last (the final)", () => {
    expect(currentMatchOf([game(2, 2, 3), game(1, 1, 2)])?.position).toBe(1);
    expect(currentMatchOf([game(1, 1, 2, "done"), game(2, 2, 3, "done")])?.position).toBe(2);
    expect(currentMatchOf([])).toBeUndefined();
  });
});
