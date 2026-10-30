import { describe, expect, it } from "vitest";
import { rowSpan } from "./masonry";

describe("a masonry photo grid", () => {
  it("a square photo spans the rows its width needs, gaps and all", () => {
    // 4px rows with 8px gaps: a 300px-wide square needs 300px, 25 rows of 12px (one gap less)
    expect(rowSpan(300, 1, 4, 8)).toBe(26);
  });

  it("a portrait photo (4:5) spans more rows than a square, a landscape one fewer", () => {
    const square = rowSpan(300, 1, 4, 8);
    expect(rowSpan(300, 1.25, 4, 8)).toBeGreaterThan(square);
    expect(rowSpan(300, 0.52, 4, 8)).toBeLessThan(square);
  });

  it("a photo not loaded yet is taken as square, so its place is kept", () => {
    expect(rowSpan(300, 0, 4, 8)).toBe(rowSpan(300, 1, 4, 8));
  });
});
