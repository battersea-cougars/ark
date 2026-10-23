import { describe, expect, it } from "vitest";
import { editionPath, editionRest, frontDoorTo, historyMovedTo, statusHref } from "./edition-address";
import { game, kumite, team } from "./kumite.testing";

const TODAY = "2026-10-21";

// "I should always be able to enter prior kumite and see that timeline", "this page is the layout for that specific
// kumite — the url should reflect that" (the user, 2026-10-23): every edition has its own address (ADR 0074)
describe("an edition's own address", () => {
  it("is the series' address and its id; its statuses under it", () => {
    expect(editionPath("kumite", 12)).toBe("/tournaments/kumite/12");
    expect(editionPath("kumite", 12, "draft")).toBe("/tournaments/kumite/12/draft");
  });

  it("the track's links: the status it's at is the edition's page itself; one gone by, its own address", () => {
    const fixtures = kumite({
      id: 12,
      draftState: "closed",
      teams: [team(1, 2, [3]), team(2, 4, [7]), team(3, 5)],
      games: [game(1, "next", 1, 3), game(2, "next", 2, 3)] as never,
    });
    expect(statusHref("kumite", fixtures, TODAY, "fixtures")).toBe("/tournaments/kumite/12");
    expect(statusHref("kumite", fixtures, TODAY, "draft")).toBe("/tournaments/kumite/12/draft");
    expect(statusHref("kumite", fixtures, TODAY, "signup")).toBe("/tournaments/kumite/12/sign-up");
  });

  it("says what's after it: the status asked for, or nothing for the edition's own page", () => {
    expect(editionRest("/tournaments/kumite/12", "/tournaments/kumite/12")).toBe("");
    expect(editionRest("/tournaments/kumite/12/teams", "/tournaments/kumite/12")).toBe("teams");
    expect(editionRest("/tournaments/kumite/120", "/tournaments/kumite/12")).toBe("");
  });
});

describe("the series' front door, once one's on, opens that one's address", () => {
  const editions = [5, 12];

  it("the front page and its old status addresses (a push, Home, an email) go to the one on, the same status", () => {
    for (const rest of ["", "/sign-up", "/draft", "/teams", "/schedule", "/day", "/afters", "/standings"])
      expect(frontDoorTo(`/tournaments/kumite${rest}`, "kumite", 12, editions)).toBe(`/tournaments/kumite/12${rest}`);
  });

  it("with nothing on, it stays the series' page (No Kumite yet)", () => {
    expect(frontDoorTo("/tournaments/kumite", "kumite", undefined, editions)).toBeNull();
    expect(frontDoorTo("/tournaments/kumite/draft", "kumite", undefined, editions)).toBeNull();
  });

  it("leaves the series' other pages and every edition's own address alone", () => {
    for (const rest of ["/12", "/5/draft", "/history", "/awards", "/my-team", "/teams/71", "/games/9", "/draft/room"])
      expect(frontDoorTo(`/tournaments/kumite${rest}`, "kumite", 12, editions)).toBeNull();
    expect(frontDoorTo("/tournaments/cup", "kumite", 12, editions)).toBeNull();
    expect(frontDoorTo("/tournaments/kumite-two", "kumite", 12, editions)).toBeNull();
  });

  it("an edition that's gone (deleted) goes back to the series' page", () => {
    expect(frontDoorTo("/tournaments/kumite/99", "kumite", 12, editions)).toBe("/tournaments/kumite");
    expect(frontDoorTo("/tournaments/kumite/99/teams", "kumite", undefined, editions)).toBe("/tournaments/kumite");
  });
});

describe("History's old address for a past one", () => {
  it("goes to the edition's own page", () => {
    expect(historyMovedTo("/tournaments/kumite/history/5")).toBe("/tournaments/kumite/5");
    expect(historyMovedTo("/tournaments/kumite/history")).toBeNull();
    expect(historyMovedTo("/tournaments/kumite/5")).toBeNull();
  });
});
