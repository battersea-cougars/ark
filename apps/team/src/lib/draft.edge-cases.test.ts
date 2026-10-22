// The draft's turn order at its edges (ADR 0060): two teams, the turnaround, the last pick, places in words past the
// teens, and where a draft stands when an admin put someone on by hand. Pure logic, shared by the Draft page and the
// Worker.
import { describe, expect, it } from "vitest";
import { draftTurn, nextSlots, nth, onTheClock, orderDrawn, picksUntil, playersNeeded } from "./draft";

describe("onTheClock at the edges", () => {
  it("two teams: A B, B A, A B — each captain picks twice running at every turnaround", () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => onTheClock(2, n))).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it("whatever the number of teams, each full round gives every team one pick", () => {
    for (const teams of [2, 3, 4, 7, 16])
      for (let round = 0; round < 4; round++) {
        const picks = Array.from({ length: teams }, (_, k) => onTheClock(teams, round * teams + k));
        expect([...picks].sort((a, b) => a - b)).toEqual(Array.from({ length: teams }, (_, i) => i));
      }
  });

  it("the last team in the order picks twice running at the turn, the first at the next", () => {
    expect([onTheClock(4, 3), onTheClock(4, 4)]).toEqual([3, 3]);
    expect([onTheClock(4, 7), onTheClock(4, 8)]).toEqual([0, 0]);
  });
});

describe("picksUntil at the edges", () => {
  /** The slots to come after `made` picks with no gaps, `left` of them. */
  const after = (made: number, left: number) =>
    nextSlots(
      Array.from({ length: made }, (_, i) => i + 1),
      left,
    );

  it("nothing left to pick: never, even for the team on the clock", () => {
    expect(picksUntil(2, after(0, 0), 0)).toBe(Infinity);
  });

  it("on the clock with one left: now; the other team with one left: never", () => {
    expect(picksUntil(2, after(3, 1), 0)).toBe(0);
    expect(picksUntil(2, after(3, 1), 1)).toBe(Infinity);
  });

  it("at the turnaround the last team is next straight after its own pick", () => {
    // Three teams, two picks made: the third is on now, and next too
    expect(picksUntil(3, after(2, 10), 2)).toBe(0);
    expect(picksUntil(3, after(3, 10), 2)).toBe(0);
    expect(picksUntil(3, after(4, 10), 2)).toBe(4);
  });
});

describe("nextSlots: the turn follows the pick numbers (#125)", () => {
  it("no gaps: on from how many there are", () => {
    expect(nextSlots([], 3)).toEqual([0, 1, 2]);
    expect(nextSlots([1, 2, 3], 2)).toEqual([3, 4]);
  });

  it("an earlier pick came off: its number is filled first, then on from the last", () => {
    expect(nextSlots([2, 3], 3)).toEqual([0, 3, 4]);
    expect(nextSlots([1, 3, 5], 3)).toEqual([1, 3, 5]);
  });

  it("the gap's pick is its own team's: two teams, A's pick 1 gone after A, B, B: A is on the clock", () => {
    expect(onTheClock(2, nextSlots([2, 3], 1)[0])).toBe(0);
  });

  it("nobody left to pick: no slots", () => {
    expect(nextSlots([2, 3], 0)).toEqual([]);
  });
});

describe("nth: a captain's place in words", () => {
  it("1st 2nd 3rd 4th, the teens all th, then 21st 22nd 23rd, and past a hundred the same", () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24].map(nth)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "10th",
      "11th",
      "12th",
      "13th",
      "14th",
      "20th",
      "21st",
      "22nd",
      "23rd",
      "24th",
    ]);
    expect([101, 111, 112, 113, 121].map(nth)).toEqual(["101st", "111th", "112th", "113th", "121st"]);
  });
});

describe("whether the order's drawn, and how many must sign up", () => {
  it("no teams isn't drawn; one captain still waiting isn't; every one numbered is, from 1", () => {
    expect(orderDrawn([])).toBe(false);
    expect(orderDrawn([{ pick: 1 }, { pick: null }])).toBe(false);
    expect(orderDrawn([{ pick: 1 }, {}])).toBe(false);
    expect(orderDrawn([{ pick: 2 }, { pick: 1 }])).toBe(true);
  });

  it("two more than each captain: 4 for two teams, 32 for sixteen", () => {
    expect(playersNeeded(2)).toBe(4);
    expect(playersNeeded(16)).toBe(32);
  });
});

describe("draftTurn: where the draft stands, as the server counts it", () => {
  const team = (captainMemberId: number, players: { memberId: number; pick?: number | null }[] = []) => ({
    captainMemberId,
    players,
  });

  it("before any pick: none made, everyone but the captains left, the first team on now", () => {
    const t = { teams: [team(1), team(2)], going: [1, 2, 10, 11, 12] };
    expect(draftTurn(t, 0)).toEqual({ picks: 0, left: 3, slots: [0, 1, 2], until: 0 });
    expect(draftTurn(t, 1)).toEqual({ picks: 0, left: 3, slots: [0, 1, 2], until: 1 });
  });

  it("someone an admin put on by hand isn't a pick and doesn't move the turn, but isn't left to pick either", () => {
    const t = {
      teams: [
        team(1, [
          { memberId: 10, pick: 1 },
          { memberId: 12, pick: null },
        ]),
        team(2),
      ],
      going: [1, 2, 10, 11, 12],
    };
    expect(draftTurn(t, 1)).toEqual({ picks: 1, left: 1, slots: [1], until: 0 });
  });

  it("everyone picked: nothing left, and no team's turn comes again", () => {
    const t = {
      teams: [team(1, [{ memberId: 10, pick: 1 }]), team(2, [{ memberId: 11, pick: 2 }])],
      going: [1, 2, 10, 11],
    };
    expect(draftTurn(t, 0)).toEqual({ picks: 2, left: 0, slots: [], until: Infinity });
    expect(draftTurn(t)).toEqual({ picks: 2, left: 0, slots: [], until: Infinity });
  });

  it("a first pick that came off: its captain, with nobody, is on the clock to fill it (#125)", () => {
    const t = {
      teams: [
        team(1),
        team(2, [
          { memberId: 11, pick: 2 },
          { memberId: 12, pick: 3 },
        ]),
      ],
      going: [1, 2, 11, 12, 13, 14],
    };
    expect(draftTurn(t, 0)).toEqual({ picks: 2, left: 2, slots: [0, 3], until: 0 });
    expect(draftTurn(t, 1)).toEqual({ picks: 2, left: 2, slots: [0, 3], until: Infinity });
  });
});
