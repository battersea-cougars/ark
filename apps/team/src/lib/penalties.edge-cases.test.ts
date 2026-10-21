// The penalty clock at its boundaries (lib/penalties.ts): the very moment a penalty's called or ends, a goal at the
// same moment, a double minor's halfway mark, a penalty in the last second of a period carried into the next, and a
// penalty with no time beside timed ones.
import { describe, expect, it } from "vitest";
import { penaltyEnds, playersShort, running } from "./penalties";
import { inGameTime } from "./periods";

const MIN = 60_000;
const pen = (
  id: number,
  teamId: number,
  atMs: number | null,
  minutes: 2 | 4 | 5 = 2,
  memberId: number | null = null,
) => ({
  id,
  teamId,
  memberId,
  minutes,
  atMs,
});
const goal = (teamId: number, atMs: number | null) => ({ teamId, atMs });

describe("the penalty clock at its edges", () => {
  it("is on from the moment it's called, and off the moment its two minutes are up", () => {
    const p = [pen(1, 1, 3 * MIN)];
    expect(running(p, [], 3 * MIN)).toEqual([expect.objectContaining({ leftMs: 2 * MIN })]);
    expect(running(p, [], 5 * MIN - 1)).toEqual([expect.objectContaining({ leftMs: 1 })]);
    expect(running(p, [], 5 * MIN)).toEqual([]);
    expect(playersShort(p, [], 5 * MIN).size).toBe(0);
  });

  it("a penalty called at the very start of the game runs from 0:00", () => {
    expect(penaltyEnds([pen(1, 1, 0)], []).get(1)).toBe(2 * MIN);
  });

  it("a goal at the moment a penalty's called doesn't end it: the penalty starts after the goal", () => {
    expect(penaltyEnds([pen(1, 1, 3 * MIN)], [goal(2, 3 * MIN)]).get(1)).toBe(5 * MIN);
  });

  it("a goal at the moment a minor's served ends nothing: they're back to full strength", () => {
    const p = [pen(1, 1, 3 * MIN), pen(2, 1, 4 * MIN, 2, 8)];
    // At 5:00 the first is over; the second (4:00 to 6:00) is the one a goal ends
    expect(penaltyEnds(p, [goal(2, 5 * MIN)])).toEqual(
      new Map([
        [1, 5 * MIN],
        [2, 5 * MIN],
      ]),
    );
  });

  it("a power-play goal at exactly halfway through a double minor ends it: the first two were served", () => {
    expect(penaltyEnds([pen(1, 1, 3 * MIN, 4)], [goal(2, 5 * MIN)]).get(1)).toBe(5 * MIN);
    // A second before halfway, the second two start fresh from the goal
    expect(penaltyEnds([pen(1, 1, 3 * MIN, 4)], [goal(2, 5 * MIN - 1000)]).get(1)).toBe(7 * MIN - 1000);
  });

  it("only one minor ends per goal: two on the same team, the earliest goes", () => {
    const p = [pen(1, 1, 3 * MIN, 2, 7), pen(2, 1, 3 * MIN + 10_000, 2, 8)];
    const ends = penaltyEnds(p, [goal(2, 4 * MIN)]);
    expect(ends.get(1)).toBe(4 * MIN);
    expect(ends.get(2)).toBe(5 * MIN + 10_000);
  });

  it("a penalty with no time (added after the game) is never on the clock, and doesn't hold up a timed one", () => {
    const p = [pen(1, 1, null, 2, 7), pen(2, 1, 3 * MIN, 2, 7)];
    expect(penaltyEnds(p, []).has(1)).toBe(false);
    expect(penaltyEnds(p, []).get(2)).toBe(5 * MIN);
    expect(running(p, [], 4 * MIN).map((r) => r.penalty.id)).toEqual([2]);
  });

  it("one in the last second of the 1st carries into the 2nd, and a power-play goal early in the 2nd ends it", () => {
    const periodMs = 12 * MIN;
    const onClock = [pen(1, 1, inGameTime(1, periodMs - 1000, periodMs))];
    const g = [goal(2, inGameTime(2, 30_000, periodMs))];
    // A second of the 1st served, the clock off for the break; 1:59 left at the start of the 2nd
    expect(running(onClock, [], inGameTime(2, 0, periodMs)!)[0].leftMs).toBe(2 * MIN - 1000);
    expect(penaltyEnds(onClock, g).get(1)).toBe(periodMs + 30_000);
  });
});
