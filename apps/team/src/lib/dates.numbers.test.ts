import { describe, expect, it } from "vitest";
import { ordinal, plural } from "./dates";

describe("ordinal", () => {
  it("says the place the way people do, the teens included", () => {
    const said = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal);
    expect(said).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "101st",
      "111th",
      "112th",
    ]);
  });
});

describe("plural", () => {
  it("counts with the noun's singular for one, its plural otherwise", () => {
    expect([plural(1, "goal"), plural(0, "goal"), plural(2, "match", "matches")]).toEqual([
      "1 goal",
      "0 goals",
      "2 matches",
    ]);
  });
});
