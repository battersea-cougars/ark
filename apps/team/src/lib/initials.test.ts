// A member's initials, on their avatar when there's no picture (Profile, the player card, the draft's captains).
import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("a member's initials", () => {
  it("are the first letters of their first two names", () => {
    expect(initials("Sam Jones")).toBe("SJ");
    expect(initials("Mary Ann Smith")).toBe("MA");
    expect(initials("Cher")).toBe("C");
    expect(initials("Mary-Jane Watson")).toBe("MW");
  });

  it("keep accented letters, and don't mind extra spaces", () => {
    expect(initials("Åsa Öberg")).toBe("ÅÖ");
    expect(initials("Jo  Smith")).toBe("JS");
    expect(initials(" Jo Smith")).toBe("JS");
  });

  it("are empty for an empty name, rather than failing", () => {
    expect(initials("")).toBe("");
  });

  // #140: w[0] is half of an emoji's surrogate pair, a broken glyph on the avatar
  it.fails("a name that starts with an emoji keeps the whole emoji (known bug #140)", () => {
    expect(initials("🏒 Jo")).toBe("🏒J");
  });
});
