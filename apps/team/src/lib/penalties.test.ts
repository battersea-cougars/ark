// The penalty clock's maths (lib/penalties.ts): what's still being served at a moment of game time, how long is left,
// and a minor cut short by a power-play goal.
import { describe, expect, it } from "vitest";
import { gameTime, penaltyEnds, penaltyLine, penaltyMinutes, running } from "./penalties";

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

describe("the penalty clock", () => {
  it("counts down in game time: two minutes from when it was given", () => {
    const p = [pen(1, 1, 3 * MIN)];
    expect(running(p, [], 3 * MIN + 30_000)).toEqual([
      { penalty: p[0], leftMs: 90_000, double: false, waiting: false },
    ]);
  });

  it("runs with the game clock, and stands still while it's paused", () => {
    const p = [pen(1, 1, 3 * MIN)];
    const kickOff = Date.parse("2026-11-14T10:00:00Z");
    const startedAt = new Date(kickOff).toISOString();
    // 12 minutes a game; running since kick-off, a minute later 4 minutes are gone if it had 9 left
    const live = { clockLeftMs: 9 * MIN, clockStartedAt: startedAt };
    expect(gameTime(live, 12 * MIN, kickOff + MIN)).toBe(4 * MIN);
    expect(running(p, [], gameTime(live, 12 * MIN, kickOff + MIN))[0].leftMs).toBe(MIN);
    // Paused with 8 left: game time stands at 4 minutes, however long the pause
    const paused = { clockLeftMs: 8 * MIN, clockStartedAt: null };
    expect(gameTime(paused, 12 * MIN, kickOff + 10 * MIN)).toBe(4 * MIN);
    expect(gameTime(paused, 12 * MIN, kickOff + 60 * MIN)).toBe(4 * MIN);
    // Never past full time
    expect(gameTime(live, 12 * MIN, kickOff + 60 * MIN)).toBe(12 * MIN);
  });

  it("clears when it's served, and isn't on before it was given", () => {
    const p = [pen(1, 1, 3 * MIN)];
    expect(running(p, [], 5 * MIN)).toEqual([]);
    expect(running(p, [], 2 * MIN)).toEqual([]);
    // One added after the game without a time is never on the clock
    expect(running([pen(2, 1, null)], [], 3 * MIN)).toEqual([]);
  });

  it("a major runs five minutes", () => {
    expect(running([pen(1, 1, 0, 5)], [], 4 * MIN)[0].leftMs).toBe(MIN);
  });

  it("a power-play goal ends the penalised team's earliest minor", () => {
    const p = [pen(1, 1, 1 * MIN), pen(2, 1, 1.5 * MIN)];
    const g = [goal(2, 2 * MIN)];
    expect(penaltyEnds(p, g).get(1)).toBe(2 * MIN);
    expect(running(p, g, 2 * MIN + 1).map((r) => r.penalty.id)).toEqual([2]);
  });

  it("but not a major, a goal by the penalised team, or one with both sides a player down", () => {
    // A major is served in full
    expect(penaltyEnds([pen(1, 1, MIN, 5)], [goal(2, 2 * MIN)]).get(1)).toBe(6 * MIN);
    // Short-handed goal: their own penalty runs on
    expect(penaltyEnds([pen(1, 1, MIN)], [goal(1, 2 * MIN)]).get(1)).toBe(3 * MIN);
    // Four on four: no power play
    expect(penaltyEnds([pen(1, 1, MIN), pen(2, 2, MIN)], [goal(2, 2 * MIN)]).get(1)).toBe(3 * MIN);
    // A goal after it's served changes nothing
    expect(penaltyEnds([pen(1, 1, MIN)], [goal(2, 4 * MIN)]).get(1)).toBe(3 * MIN);
  });
});

describe("a double minor", () => {
  it("runs four minutes as one, marked 2+2", () => {
    const p = [pen(1, 1, MIN, 4)];
    expect(running(p, [], MIN)).toEqual([{ penalty: p[0], leftMs: 4 * MIN, double: true, waiting: false }]);
    expect(running(p, [], 4 * MIN)[0].leftMs).toBe(MIN);
    expect(running(p, [], 5 * MIN)).toEqual([]);
  });

  it("a power-play goal in the first two ends that half: the second two start fresh from the goal", () => {
    const p = [pen(1, 1, MIN, 4)];
    // 30 seconds in, a goal against: two minutes left from there, not three and a half
    expect(penaltyEnds(p, [goal(2, MIN + 30_000)]).get(1)).toBe(MIN + 30_000 + 2 * MIN);
    expect(running(p, [goal(2, MIN + 30_000)], 2 * MIN)[0].leftMs).toBe(90_000);
  });

  it("a power-play goal in the second two ends it", () => {
    expect(penaltyEnds([pen(1, 1, MIN, 4)], [goal(2, 4 * MIN)]).get(1)).toBe(4 * MIN);
    // Two goals: the first ends the first half, the second the rest
    expect(penaltyEnds([pen(1, 1, MIN, 4)], [goal(2, 2 * MIN), goal(2, 3 * MIN)]).get(1)).toBe(3 * MIN);
  });

  it("counts four penalty minutes", () => {
    expect(penaltyMinutes([{ penalties: [pen(1, 1, 0, 4, 7)] }]).byMember.get(7)).toBe(4);
  });
});

describe("one player, one penalty after another", () => {
  // Dan (7) on the Ants (1); Bo (8) on the Bees (2)
  it("a second on a player still serving one starts when the first ends, shown waiting", () => {
    const p = [pen(1, 1, MIN, 2, 7), pen(2, 1, 2 * MIN, 2, 7)];
    expect(penaltyEnds(p, []).get(1)).toBe(3 * MIN);
    expect(penaltyEnds(p, []).get(2)).toBe(5 * MIN);
    // 2:30 in: the first has 30 seconds left, the second its full two, waiting
    expect(running(p, [], 2.5 * MIN)).toEqual([
      { penalty: p[0], leftMs: 30_000, double: false, waiting: false },
      { penalty: p[1], leftMs: 2 * MIN, double: false, waiting: true },
    ]);
    expect(running(p, [], 4 * MIN)).toEqual([{ penalty: p[1], leftMs: MIN, double: false, waiting: false }]);
  });

  it("a minor then a major: the five start when the two end", () => {
    const p = [pen(1, 1, 0, 2, 7), pen(2, 1, 0, 5, 7)];
    expect(penaltyEnds(p, []).get(2)).toBe(7 * MIN);
  });

  it("the team's a player short, not two: one each in the box is four on four, and a goal ends nothing", () => {
    const p = [pen(1, 1, MIN, 2, 7), pen(2, 1, 1.5 * MIN, 2, 7), pen(3, 2, 1.25 * MIN, 2, 8)];
    const ends = penaltyEnds(p, [goal(2, 2 * MIN)]);
    expect([ends.get(1), ends.get(2), ends.get(3)]).toEqual([3 * MIN, 5 * MIN, 3.25 * MIN]);
  });

  it("a power-play goal ending the first starts the waiting one there", () => {
    const p = [pen(1, 1, MIN, 2, 7), pen(2, 1, 1.5 * MIN, 2, 7)];
    const ends = penaltyEnds(p, [goal(2, 2 * MIN)]);
    expect(ends.get(1)).toBe(2 * MIN);
    expect(ends.get(2)).toBe(4 * MIN);
  });

  it("sitting out, too: served one after the other", () => {
    const p = [pen(1, 1, MIN, 2, 7), pen(2, 1, 2 * MIN, 4, 7)];
    expect(penaltyEnds(p, [], "sit_out").get(2)).toBe(7 * MIN);
    expect(running(p, [], 2 * MIN, "sit_out").map((r) => r.waiting)).toEqual([false, true]);
  });

  it("bench penalties aren't anyone's: each starts when it's given", () => {
    const p = [pen(1, 1, MIN, 2, null), pen(2, 1, 2 * MIN, 2, null)];
    expect(penaltyEnds(p, []).get(2)).toBe(4 * MIN);
  });
});

describe("penalty shot, the player sits out (the Kumite's rule)", () => {
  it("a goal against doesn't end it: nobody's short-handed", () => {
    const p = [pen(1, 1, MIN, 2, 7), pen(2, 1, MIN, 4, 8)];
    const g = [goal(2, 2 * MIN)];
    expect(penaltyEnds(p, g, "sit_out").get(1)).toBe(3 * MIN);
    expect(penaltyEnds(p, g, "sit_out").get(2)).toBe(5 * MIN);
  });

  it("the sit-out counts in game time, and clears when served", () => {
    const p = [pen(1, 1, MIN, 2, 7)];
    const kickOff = Date.parse("2026-11-14T10:00:00Z");
    const paused = { clockLeftMs: 10 * MIN, clockStartedAt: null };
    expect(running(p, [], gameTime(paused, 12 * MIN, kickOff + 30 * MIN), "sit_out")[0].leftMs).toBe(MIN);
    expect(running(p, [], 3 * MIN, "sit_out")).toEqual([]);
  });

  it("a bench penalty has nobody sitting out: no clock", () => {
    expect(running([pen(1, 1, MIN, 2, null)], [], 2 * MIN, "sit_out")).toEqual([]);
    // In a power play, the bench penalty puts someone in the box
    expect(running([pen(1, 1, MIN, 2, null)], [], 2 * MIN)).toHaveLength(1);
  });
});

describe("who a penalty's on", () => {
  it("is Bench when nobody: what for, after", () => {
    expect(penaltyLine({ memberId: null, infraction: "too-many-players" }, () => "")).toBe("Bench · Too many players");
    expect(penaltyLine({ memberId: 7, infraction: "tripping" }, () => "Dan")).toBe("Dan · Tripping");
  });
});

describe("penalty minutes", () => {
  it("add up per player and per team, over every game", () => {
    const games = [
      { penalties: [pen(1, 1, 0, 2, 7), pen(2, 1, MIN, 5, 7), pen(3, 2, MIN, 2, 8)] },
      { penalties: [pen(4, 1, 0, 2, null)] },
      {},
    ];
    const { byMember, byTeam } = penaltyMinutes(games);
    expect(byMember.get(7)).toBe(7);
    expect(byMember.get(8)).toBe(2);
    expect(byTeam.get(1)).toBe(9);
    expect(byTeam.get(2)).toBe(2);
  });
});
