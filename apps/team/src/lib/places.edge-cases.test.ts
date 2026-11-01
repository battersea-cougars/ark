// A training's places at their edges (ADR 0131): no limits, a limit of none for keepers, an empty night, nobody
// waiting, and someone leaving who wasn't in.
import { describe, expect, it } from "vitest";
import { limitFor, nextUp, onSide, placesLeft, roomFor } from "./places";

// Keepers are 10 and up; everyone else skates
const isKeeper = (id: number) => id >= 10;

describe("a training's places at the edges", () => {
  it("no limits set (null or left out): always room, and nothing counted as left", () => {
    for (const l of [{}, { capacity: null, goalieCapacity: null }]) {
      expect(roomFor(1, [2, 3, 4, 5], l, isKeeper)).toBe(true);
      expect(roomFor(10, [11, 12], l, isKeeper)).toBe(true);
      expect(placesLeft([1, 10], l, isKeeper)).toEqual({ skaters: null, keepers: null });
    }
  });

  it("no keepers' places (0) is a limit, not no limit: a keeper has no room", () => {
    expect(limitFor(true, { capacity: 20, goalieCapacity: 0 })).toBe(0);
    expect(roomFor(10, [], { capacity: 20, goalieCapacity: 0 }, isKeeper)).toBe(false);
    expect(placesLeft([], { capacity: 20, goalieCapacity: 0 }, isKeeper)).toEqual({ skaters: 20, keepers: 0 });
  });

  it("an empty night has every place; the last place is a place; one more is over", () => {
    expect(placesLeft([], { capacity: 2 }, isKeeper).skaters).toBe(2);
    expect(roomFor(2, [1], { capacity: 2 }, isKeeper)).toBe(true);
    expect(roomFor(3, [1, 2], { capacity: 2 }, isKeeper)).toBe(false);
  });

  it("let in past the limit, the places left go below nothing", () => {
    expect(placesLeft([1, 2, 3], { capacity: 2 }, isKeeper).skaters).toBe(-1);
  });

  it("nobody waiting: nobody moves up", () => {
    expect(nextUp(1, [2], [], { capacity: 2 }, isKeeper)).toBeUndefined();
  });

  it("only keepers waiting when a skater goes: none of them moves up", () => {
    expect(nextUp(1, [2], [10, 11], { capacity: 2, goalieCapacity: 0 }, isKeeper)).toBeUndefined();
  });

  it("a skater goes from a night with no limit: the first skater waiting (if any were) moves up", () => {
    expect(nextUp(1, [2], [3, 4], {}, isKeeper)).toBe(3);
  });

  it("splits a list into its sides, keeping its order", () => {
    expect(onSide([3, 10, 1, 11], false, isKeeper)).toEqual([3, 1]);
    expect(onSide([3, 10, 1, 11], true, isKeeper)).toEqual([10, 11]);
    expect(onSide([], true, isKeeper)).toEqual([]);
  });
});
