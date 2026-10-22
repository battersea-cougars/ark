// The evening a tournament ends (ADR 0074): its last match played, it's at its afterwards (The Anchor) till 06:00
// London the next morning, then it's history. The status's rule, its place on the track, and the awards revealed one
// at a time.
import { describe, expect, it } from "vitest";
import type { Tournament, TournamentType } from "../demo/model";
import { londonEvening } from "./dates";
import { atAfters, currentOf } from "./edition";
import { finalOrder, revealOf } from "./afters";
import { statusesOf, statusOf } from "./tournament-front";

const kumite = { id: 1, slug: "kumite", shortName: "Kumite" } as TournamentType;
const game = (position: number, status: "next" | "live" | "done") => ({
  id: position,
  stage: "group",
  position,
  homeTeamId: 1,
  awayTeamId: 2,
  homeGoals: status === "next" ? null : 2,
  awayGoals: status === "next" ? null : 1,
  status,
});
/** The Kumite on Friday 23 October 2026, its two matches as given. */
const kumiteOn = (statuses: ("next" | "live" | "done")[], o: Partial<Tournament> = {}) =>
  ({
    id: 10,
    typeId: 1,
    kind: "draft",
    status: "open",
    heldOn: "2026-10-23",
    startTime: "19:30",
    endTime: "21:30",
    season: null,
    draftState: "closed",
    teams: [],
    going: [],
    waitlist: [],
    awards: [
      { name: "Champions", about: "" },
      { name: "Top scorer", about: "" },
      { name: "Best goalie", about: "" },
      { name: "The Dim Mak", about: "" },
    ],
    games: statuses.map((s, i) => game(i + 1, s)),
    ...o,
  }) as unknown as Tournament;

describe("londonEvening: the evening a moment belongs to", () => {
  it("is London's date from 06:00; before 06:00 it's still the night before's", () => {
    expect(londonEvening(new Date("2026-10-23T18:00:00Z"))).toBe("2026-10-23");
    // 23:59 BST, then 01:30 and 05:59 BST the next morning: still Friday night
    expect(londonEvening(new Date("2026-10-23T22:59:00Z"))).toBe("2026-10-23");
    expect(londonEvening(new Date("2026-10-24T00:30:00Z"))).toBe("2026-10-23");
    expect(londonEvening(new Date("2026-10-24T04:59:00Z"))).toBe("2026-10-23");
    // 06:00 BST: Saturday
    expect(londonEvening(new Date("2026-10-24T05:00:00Z"))).toBe("2026-10-24");
  });

  it("by London's clock across the clocks going back (25 October 2026: 06:00 is GMT)", () => {
    expect(londonEvening(new Date("2026-10-25T05:30:00Z"))).toBe("2026-10-24");
    expect(londonEvening(new Date("2026-10-25T06:00:00Z"))).toBe("2026-10-25");
  });
});

describe("atAfters: the after-party, from the last match played till 06:00 the next morning", () => {
  it("not while a match is still to play, even on its evening", () => {
    expect(atAfters(kumiteOn(["done", "live"]), "2026-10-23")).toBe(false);
    expect(atAfters(kumiteOn(["done", "next"]), "2026-10-23")).toBe(false);
  });

  it("the last match played: on its evening, through midnight, till 06:00", () => {
    const over = kumiteOn(["done", "done"]);
    expect(atAfters(over, londonEvening(new Date("2026-10-23T21:40:00Z")))).toBe(true);
    expect(atAfters(over, londonEvening(new Date("2026-10-24T01:00:00Z")))).toBe(true);
    expect(atAfters(over, londonEvening(new Date("2026-10-24T05:00:00Z")))).toBe(false);
  });

  it("an admin marking it finished counts as the last match played", () => {
    expect(atAfters(kumiteOn(["done", "next"], { status: "finished" }), "2026-10-23")).toBe(true);
  });

  it("results typed in on another day: no after-party, straight to history; nor one with only a season", () => {
    expect(atAfters(kumiteOn(["done", "done"]), "2026-10-27")).toBe(false);
    expect(atAfters(kumiteOn(["done", "done"], { season: "autumn" as never }), "2026-10-23")).toBe(false);
  });
});

describe("currentOf: the series' page holds the after-party, then moves on", () => {
  const next = kumiteOn([], { id: 11, heldOn: "2027-01-15", draftState: "none" });
  const tonight = kumiteOn(["done", "done"]);

  it("the evening it ends, the one just played is still the page's, even with the next one scheduled", () => {
    expect(currentOf([tonight, next], "2026-10-23", "2026-10-23")?.id).toBe(10);
    expect(currentOf([tonight], "2026-10-24", "2026-10-23")?.id).toBe(10);
  });

  it("from 06:00 the next morning: the next one, or nothing on", () => {
    expect(currentOf([tonight, next], "2026-10-24", "2026-10-24")?.id).toBe(11);
    expect(currentOf([tonight], "2026-10-24", "2026-10-24")).toBeUndefined();
  });
});

describe("the track over the evening", () => {
  it("a sixth status after KUMITE!, named after the afterwards; AFTERS when there's none", () => {
    const steps = statusesOf(kumiteOn([]), kumite, "2026-10-23", "The Anchor");
    expect(steps.map((s) => s.label)).toEqual([
      "Sign-up open",
      "Draft open",
      "Teams set",
      "Fixtures set",
      "Kumite!",
      "The Anchor",
    ]);
    expect(steps.map((s) => s.short)).toEqual(["Sign-up", "Draft", "Teams", "Fixtures", "Kumite!", "Anchor"]);
    expect(statusesOf(kumiteOn([]), kumite, "2026-10-23").at(-1)).toMatchObject({ label: "Afters", short: "Afters" });
  });

  it("KUMITE! while a match is to play; the last one played, the after-party is where it is", () => {
    expect(statusOf(kumiteOn(["done", "live"]), "2026-10-23")).toBe("day");
    expect(statusOf(kumiteOn(["done", "done"]), "2026-10-23")).toBe("afters");
    const steps = statusesOf(kumiteOn(["done", "done"]), kumite, "2026-10-23", "The Anchor");
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "done", "now"]);
  });
});

describe("revealOf: the awards, revealed in the order listed", () => {
  const winners = [{ award: "Champions", teamId: 1, memberId: null }];

  it("not confirmed: nothing to reveal yet, every award face down", () => {
    const r = revealOf(kumiteOn(["done", "done"]));
    expect(r).toMatchObject({ confirmed: false, revealed: 0, all: false });
    expect(r.next?.name).toBe("Champions");
    expect(r.awards.every((a) => !a.revealed)).toBe(true);
  });

  it("two out: the first two face up, the next is the third", () => {
    const r = revealOf(kumiteOn(["done", "done"], { winners, awardsRevealed: 2 }));
    expect(r.awards.map((a) => a.revealed)).toEqual([true, true, false, false]);
    expect(r.next?.name).toBe("Best goalie");
  });

  it("every one out: none next", () => {
    const r = revealOf(kumiteOn(["done", "done"], { winners, awardsRevealed: 4 }));
    expect(r).toMatchObject({ all: true, next: null, revealed: 4 });
  });
});

describe("finalOrder: the final table, the champions first", () => {
  const teams = [1, 2, 3].map((id) => ({ id, name: "", players: [] }));
  const g = (position: number, stage: string, home: number, away: number, hg: number, ag: number) => ({
    id: position,
    stage,
    position,
    homeTeamId: home,
    awayTeamId: away,
    homeGoals: hg,
    awayGoals: ag,
    status: "done",
  });
  const points = { pointsWin: 3, pointsDraw: 1, pointsLoss: 0 };

  it("with a final: its winner, then its loser, then the rest by the table", () => {
    // The table: 1 (6 pts), 2 (3), 3 (0); 2 beat 1 in the final
    const games = [
      g(1, "group", 1, 2, 2, 0),
      g(2, "group", 1, 3, 1, 0),
      g(3, "group", 2, 3, 4, 1),
      g(4, "playoff", 1, 2, 0, 1),
    ];
    const order = finalOrder({ teams, games, ...points } as never);
    expect(order.map((r) => r.teamId)).toEqual([2, 1, 3]);
    expect(order.map((r) => r.champions)).toEqual([true, false, false]);
  });

  it("without playoffs: the table, its top the champions", () => {
    const games = [g(1, "group", 1, 2, 0, 2), g(2, "group", 1, 3, 1, 0), g(3, "group", 2, 3, 4, 1)];
    expect(finalOrder({ teams, games, ...points } as never).map((r) => r.teamId)).toEqual([2, 1, 3]);
  });
});
