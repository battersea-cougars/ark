import { describe, expect, it } from "vitest";
import { myTurnLine, nextSlots, onTheClock, picksUntil } from "./draft";

/** The slots to come after `made` picks with no gaps, `left` of them. */
const after = (made: number, left: number) =>
  nextSlots(
    Array.from({ length: made }, (_, i) => i + 1),
    left,
  );

describe("onTheClock", () => {
  it("snakes: 1 2 3 3 2 1 1 2", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => onTheClock(3, n))).toEqual([0, 1, 2, 2, 1, 0, 0, 1]);
  });
  it("a single team always picks", () => {
    expect([0, 1, 2].map((n) => onTheClock(1, n))).toEqual([0, 0, 0]);
  });
});

describe("picksUntil: how soon a captain picks again, through the snake's turn", () => {
  // Four teams: the 2nd (index 1) picks at picks 2, 7, 10 and 15
  const turns = [2, 7, 10, 15];
  it("counts down to each of the 2nd team's picks, round the turnaround", () => {
    for (let made = 0; made < 15; made++) {
      const next = turns.find((p) => p > made)!;
      expect(picksUntil(4, after(made, 100), 1)).toBe(next - 1 - made);
    }
  });
  it("is never when the pool runs out first", () => {
    expect(picksUntil(4, after(2, 3), 1)).toBe(Infinity);
    expect(picksUntil(4, after(2, 5), 1)).toBe(4);
  });
});

describe("myTurnLine", () => {
  it("says the place, then now, you're next, next in N, or nothing more", () => {
    expect(myTurnLine(2, 0)).toBe("You pick 2nd · now");
    expect(myTurnLine(2, 1)).toBe("You pick 2nd · you're next");
    expect(myTurnLine(2, 3)).toBe("You pick 2nd · next in 3");
    expect(myTurnLine(2, Infinity)).toBe("You pick 2nd");
  });
});
