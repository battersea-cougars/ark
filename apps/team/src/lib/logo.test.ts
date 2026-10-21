import { describe, expect, it } from "vitest";
import { teamInitials } from "./logo";

describe("teamInitials: a crest without a logo", () => {
  it("skips a generic first word: Team Charlie is CH, Team Cal CA, The Dim Maks DM", () => {
    expect(teamInitials("Team Charlie")).toBe("CH");
    expect(teamInitials("Team Cal")).toBe("CA");
    expect(teamInitials("Team Dan")).toBe("DA");
    expect(teamInitials("The Dim Maks")).toBe("DM");
    expect(teamInitials("FC Kumite")).toBe("KU");
    expect(teamInitials("club bruisers")).toBe("BR");
  });

  it("otherwise the first letters of the first two words, or a single word's first two letters", () => {
    expect(teamInitials("Dim Maks")).toBe("DM");
    expect(teamInitials("Frank Dux Fan Club")).toBe("FD");
    expect(teamInitials("Cougars")).toBe("CO");
    expect(teamInitials("Team")).toBe("TE");
    expect(teamInitials("")).toBe("");
  });

  it("two teams in the same tournament never share a crest: the first keeps its own, the next takes more letters", () => {
    const among = ["Team Charlie", "Team Chris", "Team Cal"];
    expect(among.map((n) => teamInitials(n, among))).toEqual(["CH", "CR", "CA"]);
    const twins = ["Dim Maks", "Dark Mamba", "Dim Mak Two"];
    const crests = twins.map((n) => teamInitials(n, twins));
    expect(crests[0]).toBe("DM");
    expect(new Set(crests).size).toBe(3);
  });

  it("a fallback never takes another team's own initials", () => {
    // Charlie and Chris both make CH; Chris's next choice, CR, is Team Crow's, so Chris takes CI
    const among = ["Team Charlie", "Team Chris", "Team Crow"];
    expect(among.map((n) => teamInitials(n, among))).toEqual(["CH", "CI", "CR"]);
  });
});
