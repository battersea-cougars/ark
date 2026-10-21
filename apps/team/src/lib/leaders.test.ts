// The leaderboards (#47, lib/leaders.ts): goals, assists, points and penalty minutes per player, over one tournament's
// games or every edition's, each board in its own order.
import { describe, expect, it } from "vitest";
import { leaders } from "./leaders";

const goal = (scorerId: number | null, assistId: number | null = null) => ({ teamId: 1, scorerId, assistId });
const pen = (memberId: number | null, minutes: number) => ({ id: 0, teamId: 1, memberId, minutes, atMs: 0 });

describe("the leaderboards", () => {
  const games = [
    { status: "done", goals: [goal(7, 8), goal(7), goal(8, 7)], penalties: [pen(9, 5), pen(7, 2)] },
    { status: "live", goals: [goal(9, 8)], penalties: [pen(9, 2), pen(null, 2)] },
    // Not kicked off: nothing on it counts
    { status: "next", goals: [goal(10)], penalties: [] },
  ];

  it("adds up each player's goals, assists, points (the two together) and penalty minutes", () => {
    expect(leaders(games, "points")).toEqual([
      { memberId: 7, goals: 2, assists: 1, points: 3, pim: 2 },
      { memberId: 8, goals: 1, assists: 2, points: 3, pim: 0 },
      { memberId: 9, goals: 1, assists: 0, points: 1, pim: 7 },
    ]);
  });

  it("each board in its own order, then points, then goals; nobody with none on that board", () => {
    expect(leaders(games, "goals").map((r) => r.memberId)).toEqual([7, 8, 9]);
    expect(leaders(games, "assists").map((r) => r.memberId)).toEqual([8, 7]);
    // A bench penalty is nobody's
    expect(leaders(games, "pim").map((r) => [r.memberId, r.pim])).toEqual([
      [9, 7],
      [7, 2],
    ]);
  });

  it("level on points, more goals goes first", () => {
    const level = [{ status: "done", goals: [goal(3, 2), goal(2, 3), goal(1), goal(1)] }];
    // 3 and 2 level on everything: in the order they first appear
    expect(leaders(level, "points").map((r) => r.memberId)).toEqual([1, 3, 2]);
  });

  it("is empty with nothing played", () => {
    expect(leaders([], "points")).toEqual([]);
  });
});
