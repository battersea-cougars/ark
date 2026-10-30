import { describe, expect, it } from "vitest";
import { copyMutations } from "./sanity-copy.mjs";

describe("the website's words, sent to Sanity on a deploy before launch", () => {
  const mutations = copyMutations();

  it("sets the Kumite's intro as the repo has it", () => {
    const kumite = mutations.find((m) => m.patch?.id === "kumite");
    expect(kumite.patch.set.intro).toMatch(/^Our in-house tournament/);
  });

  it("makes each document if it isn't there, then sets only its words", () => {
    expect(mutations.filter((m) => m.createIfNotExists).map((m) => m.createIfNotExists._id)).toEqual([
      "kumite",
      "team",
      "pub",
      "fridays",
    ]);
    const fields = Object.fromEntries(
      mutations.filter((m) => m.patch).map((m) => [m.patch.id, Object.keys(m.patch.set)]),
    );
    expect(fields).toEqual({
      kumite: ["intro", "tagline", "posterStatement", "posterReveal", "format"],
      team: ["intro"],
      pub: ["about"],
      fridays: ["kitNotes"],
    });
  });

  it("never touches what the Studio owns: switches, the contact email, links, photos, awards", () => {
    const set = mutations.flatMap((m) => (m.patch ? Object.keys(m.patch.set) : []));
    for (const field of ["onWebsite", "contactEmail", "mapUrl", "photo", "awards", "socials", "heroImage"])
      expect(set).not.toContain(field);
  });
});
