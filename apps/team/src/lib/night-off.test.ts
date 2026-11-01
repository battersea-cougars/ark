import { describe, expect, it } from "vitest";
import { nightOn, nightPath, trainingNights } from "./night-off";

const night = (heldOn: string, cancelledAt?: string) => ({ seriesId: 1, heldOn, cancelledAt, going: [], waitlist: [] });
const nights = [night("2026-10-16"), night("2026-10-23", "2026-10-20"), night("2026-10-30"), night("2026-11-06")];

describe("a training night's own page", () => {
  it("is at its date, under its series", () => {
    expect(nightPath("friday", "2026-10-30")).toBe("/training/friday/2026-10-30");
    expect(nightOn("/training/friday/2026-10-30", "friday")).toBe("2026-10-30");
    expect(nightOn("/training/friday", "friday")).toBeUndefined();
    expect(nightOn("/training/friday/next", "friday")).toBeUndefined();
    expect(nightOn("/training/sunday/2026-10-30", "friday")).toBeUndefined();
  });

  it("shows the next night that's on, with the ones off before it, at the series' address", () => {
    const { shown, off } = trainingNights(nights, 1, "2026-10-21");
    expect(shown?.heldOn).toBe("2026-10-30");
    expect(off.map((n) => n.heldOn)).toEqual(["2026-10-23"]);
  });

  it("shows the night at its date alone: a later one, a past one, one that's off", () => {
    expect(trainingNights(nights, 1, "2026-10-21", "2026-11-06")).toEqual({ shown: nights[3], off: [] });
    expect(trainingNights(nights, 1, "2026-10-21", "2026-10-16")).toEqual({ shown: nights[0], off: [] });
    expect(trainingNights(nights, 1, "2026-10-21", "2026-10-23")).toEqual({ shown: nights[1], off: [nights[1]] });
  });

  it("falls back to the next night for a date with none", () => {
    expect(trainingNights(nights, 1, "2026-10-21", "2026-10-31").shown?.heldOn).toBe("2026-10-30");
  });
});
