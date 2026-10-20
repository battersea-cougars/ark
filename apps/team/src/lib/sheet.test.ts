import { describe, expect, it } from "vitest";
import { drawnAsSheet, swipeCloses, swipeDistance } from "./sheet";

describe("a drawer or panel on a phone", () => {
  it("opens as the bottom sheet on a phone and as itself on a desktop", () => {
    expect(drawnAsSheet(false, false, true)).toBe(true);
    expect(drawnAsSheet(false, true, false)).toBe(false);
  });

  it("stays what it opened as while it's open, however the window is resized", () => {
    expect(drawnAsSheet(true, true, false)).toBe(true);
    expect(drawnAsSheet(true, false, true)).toBe(false);
  });
});

describe("pulling a sheet down by its handle", () => {
  it("closes it once pulled a quarter of the way, at most 120px", () => {
    expect(swipeDistance(300)).toBe(75);
    expect(swipeDistance(800)).toBe(120);
    expect(swipeCloses(74, 1000, 300)).toBe(false);
    expect(swipeCloses(75, 1000, 300)).toBe(true);
    expect(swipeCloses(120, 1000, 800)).toBe(true);
  });

  it("closes it on a quick flick down, but not a nudge", () => {
    expect(swipeCloses(40, 50, 800)).toBe(true);
    expect(swipeCloses(20, 10, 800)).toBe(false);
  });

  it("leaves it open when pushed up or let go where it was", () => {
    expect(swipeCloses(0, 100, 800)).toBe(false);
    expect(swipeCloses(-50, 50, 800)).toBe(false);
  });
});
