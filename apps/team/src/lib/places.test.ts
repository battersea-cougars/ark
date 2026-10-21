import { describe, expect, it } from "vitest";
import { nextUp, placesLeft, roomFor } from "./places";

// Keepers are 10 and 11; everyone else skates
const isKeeper = (id: number) => id >= 10;

describe("a training's places: the skaters', and the keepers' apart", () => {
  it("a keeper has a place on a night full of skaters", () => {
    expect(roomFor(10, [1, 2], { capacity: 2 }, isKeeper)).toBe(true);
    expect(roomFor(3, [1, 2, 10], { capacity: 2 }, isKeeper)).toBe(false);
  });

  it("keepers keep to their own places when the series sets them", () => {
    expect(roomFor(11, [1, 10], { capacity: 2, goalieCapacity: 1 }, isKeeper)).toBe(false);
    expect(roomFor(2, [1, 10], { capacity: 2, goalieCapacity: 1 }, isKeeper)).toBe(true);
  });

  it("counts the places left a side at a time", () => {
    expect(placesLeft([1, 2, 10], { capacity: 3 }, isKeeper)).toEqual({ skaters: 1, keepers: null });
    expect(placesLeft([1, 2, 3, 10], { capacity: 2, goalieCapacity: 2 }, isKeeper)).toEqual({
      skaters: -1,
      keepers: 1,
    });
  });

  it("a skater going lets the first waiting skater in, not a keeper waiting ahead of them", () => {
    expect(nextUp(1, [2, 10], [11, 3], { capacity: 2, goalieCapacity: 1 }, isKeeper)).toBe(3);
  });

  it("a keeper going lets no skater in", () => {
    expect(nextUp(10, [1, 2], [3], { capacity: 2 }, isKeeper)).toBeUndefined();
    expect(nextUp(10, [1, 2], [3, 11], { capacity: 2, goalieCapacity: 1 }, isKeeper)).toBe(11);
  });

  it("nobody moves up while more are in than the limit (the team maker let someone in over it)", () => {
    expect(nextUp(1, [2, 3, 4], [5], { capacity: 2 }, isKeeper)).toBeUndefined();
  });
});
