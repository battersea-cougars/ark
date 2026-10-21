// A page's address from its name ("Sunday Skills" → /training/sunday-skills): always something a URL can carry, never
// empty, never one already taken.
import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("a page's address from its name", () => {
  it("is only lower-case letters, digits and single dashes, whatever the name", () => {
    for (const name of ["Zoë's Cup!!", "  Friday   Night  ", "Kumite: 2027 (Summer)", "🏒 Shinny 🏒", "a/b?c#d"])
      expect(slugify(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slugify("Kumite: 2027 (Summer)")).toBe("kumite-2027-summer");
  });

  it("drops a leading The, whatever its case, but not a name that's only The", () => {
    expect(slugify("THE  Kumite")).toBe("kumite");
    expect(slugify("Theatre Night")).toBe("theatre-night");
    expect(slugify("The")).toBe("the");
  });

  it("is never empty: a name of only emoji, punctuation or nothing is 'item'", () => {
    expect(slugify("🏒🏒")).toBe("item");
    expect(slugify("---")).toBe("item");
    expect(slugify("")).toBe("item");
    expect(slugify("The ")).toBe("item");
  });

  it("is made unique: the next free number, even when a name already ends in one", () => {
    expect(slugify("Cup", ["cup", "cup-2"])).toBe("cup-3");
    expect(slugify("Cup 2", ["cup-2"])).toBe("cup-2-2");
    expect(slugify("🏒", ["item"])).toBe("item-2");
  });
});
