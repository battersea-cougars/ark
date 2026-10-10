// Dev's made-up players (ADR 0029): the swap is the same every time, never swaps twice, and keeps the admins.
import { describe, expect, it } from "vitest";
import { anonymizeRoster, fakeName, isFake } from "./anonymize.mjs";

const roster = [
  { name: "Pat Example", position: "D", rating: 75, email: "pat@example.com", roles: ["Admin"], cougar: false },
  { name: "Sam Example", position: "F", rating: 40, email: "sam@example.com", roles: [], cougar: true },
];

describe("dev's made-up players", () => {
  it("swaps a real name for the same made-up one every time, whatever its case or spacing", () => {
    expect(fakeName("Sam Example")).toBe(fakeName("  sam example "));
    expect(isFake(fakeName("Sam Example"))).toBe(true);
  });

  it("keeps the admins as they are and swaps everyone else, email and all, keeping what they play", () => {
    const [pat, sam] = anonymizeRoster(roster);
    expect(pat).toEqual(roster[0]);
    expect(sam).toEqual({ ...roster[1], name: fakeName("Sam Example"), email: null });
  });

  it("leaves a made-up name alone, so running it twice changes nothing", () => {
    const once = anonymizeRoster(roster);
    expect(anonymizeRoster(once)).toEqual(once);
  });

  it("stops when two people would come out as one", () => {
    const twin = { ...roster[1], name: fakeName("Sam Example") };
    expect(() => anonymizeRoster([roster[1], twin])).toThrow(/both come out as/);
  });
});
