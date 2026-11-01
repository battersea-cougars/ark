// Periods (ADR 0130): the box score's goals per period, the period's name, and game time across period breaks.
import { describe, expect, it } from "vitest";
import { boxScore, breakLeft, gameLength, inGameTime, periodName } from "./periods";
import { running } from "./penalties";

const MIN = 60_000;
const goal = (teamId: number, period: number | null, atMs: number | null = MIN) => ({ teamId, period, atMs });

describe("the box score", () => {
  it("totals each team's goals per period, and in all", () => {
    const goals = [goal(1, 1), goal(1, 1), goal(2, 2), goal(1, 3), goal(2, 3)];
    expect(boxScore(goals, [1, 2], 3)).toEqual({
      columns: ["1st", "2nd", "3rd"],
      rows: [
        { teamId: 1, byPeriod: [2, 0, 1], total: 3 },
        { teamId: 2, byPeriod: [0, 1, 1], total: 2 },
      ],
    });
  });

  it("a one-period game is only its total", () => {
    expect(boxScore([goal(1, 1), goal(2, 1)], [1, 2], 1)).toEqual({
      columns: [],
      rows: [
        { teamId: 1, byPeriod: [], total: 1 },
        { teamId: 2, byPeriod: [], total: 1 },
      ],
    });
  });

  it("a goal nobody timed (a result typed in) counts in the total only", () => {
    expect(boxScore([goal(1, null, null), goal(1, 2)], [1, 2], 2).rows[0]).toEqual({
      teamId: 1,
      byPeriod: [0, 1],
      total: 2,
    });
  });
});

describe("periods", () => {
  it("are called 1st, 2nd, 3rd", () => {
    expect([1, 2, 3].map(periodName)).toEqual(["1st", "2nd", "3rd"]);
  });

  it("game time runs on across a break: a penalty late in the 1st carries into the 2nd", () => {
    const periodMs = 12 * MIN;
    // Two minutes from 11:00 into the 1st
    const p = { id: 1, teamId: 1, memberId: 7, minutes: 2, period: 1, atMs: 11 * MIN };
    const onClock = { ...p, atMs: inGameTime(p.period, p.atMs, periodMs) };
    // 30 seconds into the 2nd: a minute and a half served, 30 seconds left
    const now = inGameTime(2, 30_000, periodMs)!;
    expect(running([onClock], [], now)[0].leftMs).toBe(30_000);
    expect(running([onClock], [], inGameTime(2, MIN, periodMs)!)).toEqual([]);
    // Not timed: no game time
    expect(inGameTime(1, null, periodMs)).toBeNull();
  });
});

describe("the break between periods", () => {
  const ended = "2026-11-14T10:12:00Z";
  const at = (s: number) => Date.parse(ended) + s * 1000;
  it("counts down from when the period ended, while the next hasn't started", () => {
    const g = { periodEndedAt: ended, clockStartedAt: null };
    expect(breakLeft(g, 2, at(18))).toBe(102_000);
    // Over: none left, still waiting on the scorekeeper's tap
    expect(breakLeft(g, 2, at(500))).toBe(0);
  });

  it("isn't on once the next period starts, before any period's ended, or with no break set", () => {
    expect(breakLeft({ periodEndedAt: ended, clockStartedAt: ended }, 2, at(18))).toBeNull();
    expect(breakLeft({ periodEndedAt: null, clockStartedAt: null }, 2, at(18))).toBeNull();
    expect(breakLeft({ periodEndedAt: ended, clockStartedAt: null }, 0, at(18))).toBeNull();
  });
});

describe("a game's length, in words", () => {
  it("says the periods and the breaks between them", () => {
    expect(gameLength({ gameMinutes: 12 })).toBe("12-minute games");
    expect(gameLength({ gameMinutes: 12, periods: 3, breakMinutes: 0 })).toBe("games of 3 × 12-minute periods");
    expect(gameLength({ gameMinutes: 12, periods: 3, breakMinutes: 2 })).toBe(
      "games of 3 × 12-minute periods, 2-minute breaks",
    );
    expect(gameLength({ gameMinutes: 12, periods: 1, breakMinutes: 2 })).toBe("12-minute games");
  });
});
