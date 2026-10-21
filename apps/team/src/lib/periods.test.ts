// Periods (ADR 0061): the box score's goals per period, the period's name, and game time across period breaks.
import { describe, expect, it } from "vitest";
import { boxScore, inGameTime, periodName } from "./periods";
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
