import { describe, expect, it } from "vitest";
import { photosForFullRows } from "./full-rows";

describe("a photo grid shows only full rows", () => {
  it("the home strip, its first photo four cells big: eight photos on five columns show seven, two full rows", () => {
    expect(photosForFullRows(8, 5, 3)).toBe(7);
  });

  it("twelve photos fill five, three and two columns as they are, but the last on two", () => {
    expect([5, 3, 2].map((cols) => photosForFullRows(12, cols, 3))).toEqual([12, 12, 11]);
  });

  it("the photos page, every photo one cell: 48 on five columns show 45", () => {
    expect(photosForFullRows(48, 5)).toBe(45);
  });

  it("too few to fill a row: all of them, rather than none", () => {
    expect(photosForFullRows(1, 5, 3)).toBe(1);
    expect(photosForFullRows(3, 4)).toBe(3);
  });
});
