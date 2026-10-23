// The evening a tournament ends (ADR 0074): its last match played, it's at its afterwards (The Anchor) till 06:00
// London the next morning, then it's history. The status's rule, its place on the track, and the awards revealed one
// at a time.
import { describe, expect, it } from "vitest";
import type { Tournament, TournamentType } from "../demo/model";
import { londonEvening } from "./dates";
import { atAfters, currentOf } from "./edition";
import { ballotOf, beatOf, cueOf, drumOf, finalOrder, isFinale, revealOf, toConfirmOf } from "./afters";
import { statusesOf, statusOf } from "./tournament-front";
import type { Award } from "./awards";

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
      { name: "Best keeper", about: "" },
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
    expect(r.next?.name).toBe("Best keeper");
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

describe("drumOf: the after-party's one card, a drum", () => {
  it("sealed on the first; face up once revealed; rolled on to the next, sealed; after the last it stays there", () => {
    expect(drumOf(4, 0, false)).toEqual({ at: 0, face: "sealed" });
    expect(drumOf(4, 1, false)).toEqual({ at: 0, face: "up" });
    expect(drumOf(4, 1, true)).toEqual({ at: 1, face: "sealed" });
    expect(drumOf(4, 2, false)).toEqual({ at: 1, face: "up" });
    expect(drumOf(4, 4, false)).toEqual({ at: 3, face: "up" });
    // Rolled on past the last is nowhere to go: still the last, face up
    expect(drumOf(4, 4, true)).toEqual({ at: 3, face: "up" });
  });
});

describe("cueOf: what's under the awards page's card", () => {
  const awards = [
    { name: "The Judges' Call", about: "", decidedBy: { kind: "live", options: [] } },
    { name: "Top scorer", about: "", decidedBy: { kind: "stat", stat: "goals" } },
    { name: "Champions", about: "", decidedBy: { kind: "stat", stat: "table" } },
  ] as Award[];
  const at = (o: Partial<Tournament>) => revealOf(kumiteOn(["done", "done"], { awards: [...awards], ...o }));
  // Confirmed, the judges' call given (everyone's sent which were, never who to)
  const confirmed = {
    awardsConfirmedAt: "2026-10-23T21:40:00Z",
    titles: [{ award: "The Judges' Call", title: "Best Celly" }],
  };

  it("before they're confirmed: Confirm the awards for whoever runs it; everyone else waits", () => {
    expect(cueOf(at({}), true)).toBe("confirm");
    expect(cueOf(at({}), false)).toBe("waiting");
  });

  it("sealed: Reveal for whoever runs it, everyone else waiting; face up, Next award", () => {
    expect(cueOf(at(confirmed), true)).toBe("reveal");
    expect(cueOf(at(confirmed), false)).toBe("waiting");
    expect(cueOf(at({ ...confirmed, awardsRevealed: 1 }), true)).toBe("next");
    expect(cueOf(at({ ...confirmed, awardsRevealed: 1 }), false)).toBe(null);
    expect(cueOf(at({ ...confirmed, awardsRevealed: 1, awardsNext: true }), true)).toBe("reveal");
  });

  it("the champions sealed: The champions, wherever they're listed; after the last, nothing", () => {
    expect(cueOf(at({ ...confirmed, awardsRevealed: 2, awardsNext: true }), true)).toBe("champions");
    expect(cueOf(at({ ...confirmed, awardsRevealed: 3 }), true)).toBe(null);
    const first = revealOf(kumiteOn(["done", "done"], { awards: [awards[2], awards[0]], ...confirmed }));
    expect(cueOf(first, true)).toBe("champions");
  });

  it("no awards: nothing", () => {
    expect(cueOf(at({ awards: [] }), true)).toBe(null);
  });
});

describe("revealOf: a judges' call left out isn't revealed", () => {
  it("once confirmed without it, the reveal is the rest, in order", () => {
    const awards = [
      { name: "The Judges' Call", about: "", decidedBy: { kind: "live", options: [] } },
      { name: "Champions", about: "", decidedBy: { kind: "stat", stat: "table" } },
    ] as Award[];
    const before = revealOf(kumiteOn(["done"], { awards }));
    expect(before.awards.map((a) => a.name)).toEqual(["The Judges' Call", "Champions"]);
    const after = revealOf(kumiteOn(["done"], { awards, awardsConfirmedAt: "2026-10-23T21:40:00Z", titles: [] }));
    expect(after.awards.map((a) => a.name)).toEqual(["Champions"]);
    expect(after.drum).toEqual({ at: 0, face: "sealed" });
  });
});

describe("toConfirmOf: where confirming the awards stands, for whoever runs it", () => {
  it("each voted award's count so far (never who for), and the judges' call yours to call", () => {
    const t = kumiteOn(["done", "done"], {
      teams: [
        { id: 1, name: "", captainMemberId: 1, players: [{ memberId: 2 }] },
        { id: 2, name: "", captainMemberId: 3, players: [{ memberId: 4 }] },
      ],
      awards: [
        { name: "The Judges' Call", about: "", decidedBy: { kind: "live", options: [] } },
        { name: "Best keeper", about: "", decidedBy: { kind: "vote", voters: "skaters" } },
        { name: "Champions", about: "", decidedBy: { kind: "stat", stat: "table" } },
      ],
      votes: [{ award: "Best keeper", cast: 1, mine: null }],
    } as never);
    const positionOf = (id: number) => (id === 2 || id === 3 ? "G" : "F");
    expect(toConfirmOf(t, { positionOf })).toBe(
      "Best keeper: 1 of 2 voted · Yours to call (or leave out): The Judges' Call",
    );
  });

  it("nothing voted or to choose: nothing to say", () => {
    expect(
      toConfirmOf(kumiteOn(["done"], { awards: [{ name: "Champions", about: "" }] }), { positionOf: () => "F" }),
    ).toBe("");
  });
});

describe("beatOf: each change of card plays its beat, so every phone sees the same moments", () => {
  it("sealed to face up is the reveal; face up to the next one sealed is the next card coming in", () => {
    expect(beatOf({ at: 0, face: "sealed" }, { at: 0, face: "up" })).toBe("reveal");
    expect(beatOf({ at: 0, face: "up" }, { at: 1, face: "sealed" })).toBe("next");
  });

  it("anything else (opened late, a reload, a step back, a step missed) plays nothing", () => {
    expect(beatOf({ at: 0, face: "sealed" }, { at: 0, face: "sealed" })).toBe(null);
    expect(beatOf({ at: 0, face: "sealed" }, { at: 1, face: "sealed" })).toBe(null);
    expect(beatOf({ at: 0, face: "up" }, { at: 2, face: "sealed" })).toBe(null);
    expect(beatOf({ at: 2, face: "up" }, { at: 0, face: "sealed" })).toBe(null);
    expect(beatOf({ at: 1, face: "sealed" }, { at: 2, face: "up" })).toBe(null);
  });
});

describe("isFinale: the champions' card is the big one, by how it's decided, not by its name", () => {
  it("the table decides it, whatever it's called and wherever it's listed", () => {
    expect(isFinale({ name: "Kings of the Kumite", decidedBy: { kind: "stat", stat: "table" } })).toBe(true);
    expect(isFinale({ name: "Champions", decidedBy: { kind: "stat", stat: "goals" } })).toBe(false);
    // Saved before it said how: Champions was the table
    expect(isFinale({ name: "Champions" })).toBe(true);
  });

  it("the Kumite's order builds to it: the joke, Top scorer, Best keeper, then the champions", () => {
    const t = kumiteOn(["done", "done"], {
      awards: [
        { name: "The Judges' Call", about: "", decidedBy: { kind: "live", options: [] } },
        { name: "Top scorer", about: "", decidedBy: { kind: "stat", stat: "goals" } },
        { name: "Best keeper", about: "", decidedBy: { kind: "vote", voters: "skaters" } },
        { name: "Champions", about: "", decidedBy: { kind: "stat", stat: "table" } },
      ],
    });
    expect(revealOf(t).awards.map((a) => isFinale(a))).toEqual([false, false, false, true]);
  });
});

describe("ballotOf: your votes, from the last match till the awards are confirmed", () => {
  const voted = (o: Partial<Tournament>) =>
    kumiteOn(["done", "done"], {
      teams: [
        { id: 1, captainMemberId: 10, players: [{ memberId: 11 }] },
        { id: 2, captainMemberId: 20, players: [{ memberId: 21 }] },
      ] as Tournament["teams"],
      awards: [
        { name: "Top scorer", about: "", decidedBy: { kind: "stat", stat: "goals" } },
        { name: "Best keeper", about: "", decidedBy: { kind: "vote", voters: "skaters" } },
      ],
      ...o,
    });
  const positionOf = (id: number) => ({ 10: "F", 11: "G", 20: "D", 21: "G" })[id];

  it("a skater: Best keeper, for the goalies who played", () => {
    expect(ballotOf(voted({}), 10, { positionOf })).toEqual([
      { award: expect.objectContaining({ name: "Best keeper" }), candidates: [11, 21], mine: null },
    ]);
  });

  it("nothing for a goalie, for someone who didn't play, before the last match, or once confirmed", () => {
    expect(ballotOf(voted({}), 11, { positionOf })).toEqual([]);
    expect(ballotOf(voted({}), 99, { positionOf })).toEqual([]);
    expect(ballotOf(voted({ games: [] }), 10, { positionOf })).toEqual([]);
    expect(ballotOf(voted({ awardsConfirmedAt: "2026-10-23T21:00:00Z" }), 10, { positionOf })).toEqual([]);
  });

  it("the vote you cast is yours to see", () => {
    expect(ballotOf(voted({ votes: [{ award: "Best keeper", cast: 3, mine: 21 }] }), 10, { positionOf })[0].mine).toBe(
      21,
    );
  });
});
