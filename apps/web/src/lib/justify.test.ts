import { describe, expect, it } from "vitest";
import { partition, rowCount, rowHeight } from "./justify";

describe("a justified photo strip", () => {
  it("keeps every photo, in order", () => {
    const ratios = [1, 0.8, 1.5, 1, 0.56, 1.78, 1, 0.8];
    expect(partition(ratios, 3).flat()).toEqual(ratios);
  });

  it("splits the photos into rows as even as their shapes allow", () => {
    // A wide photo and four squares: the wide one shares its row with one square, the other three make the second
    expect(partition([2, 1, 1, 1, 1], 2)).toEqual([
      [2, 1],
      [1, 1, 1],
    ]);
    // No tiny last row: nine squares in three rows of three, not four, four and one
    expect(partition([1, 1, 1, 1, 1, 1, 1, 1, 1], 3).map((row) => row.length)).toEqual([3, 3, 3]);
    expect(partition([1, 1, 1, 1, 1, 1], 2)).toEqual([
      [1, 1, 1],
      [1, 1, 1],
    ]);
  });

  it("never makes more rows than photos, nor an empty one", () => {
    expect(partition([1, 1], 5)).toEqual([[1], [1]]);
    expect(rowCount([1, 1], 1000, 900)).toBe(2);
    expect(rowCount([1], 1000, 10)).toBe(1);
  });

  it("makes each row exactly the strip's width, gaps and all", () => {
    const row = [1, 0.8, 1.5];
    const height = rowHeight(row, 1000, 8);
    expect(row.reduce((s, r) => s + r * height, 0) + 2 * 8).toBeCloseTo(1000);
  });

  it("picks as many rows as fill the strip at about the height wanted", () => {
    // Eight squares across 1200px at 300px tall: 2400px of photos, two rows
    expect(rowCount(Array(8).fill(1), 1200, 300)).toBe(2);
  });
});
