import { describe, expect, it } from "vitest";
import { clock, formatTime, londonTime } from "./dates";

describe("times to read (12-hour until #94)", () => {
  it("reads a stored time the 12-hour way, dropping :00", () => {
    expect(clock("19:30")).toBe("7:30pm");
    expect(clock("19:00")).toBe("7pm");
    expect(clock("00:15")).toBe("12:15am");
    expect(clock("12:05")).toBe("12:05pm");
  });
  it("formats an instant in London, while inputs keep 24-hour", () => {
    const iso = "2026-10-16T18:30:00Z"; // 19:30 BST
    expect(formatTime(iso)).toBe("7:30pm");
    expect(londonTime(iso)).toBe("19:30");
  });
});
