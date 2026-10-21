import { describe, expect, it } from "vitest";
import { reachableStep } from "./wizard";

describe("how far a wizard goes", () => {
  it("goes on to the first step that still needs something, and no further", () => {
    expect(reachableStep([true, false, true, true])).toBe(1);
    expect(reachableStep([false, true, true])).toBe(0);
  });

  it("opens every step once each one has what it needs", () => {
    expect(reachableStep([true, true, true, true])).toBe(3);
    expect(reachableStep([])).toBe(0);
  });
});
