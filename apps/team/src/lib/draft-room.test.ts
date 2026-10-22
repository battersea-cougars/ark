// The draft room's rules (ADR 0060): who's let in, when a captain's offered it, what its bar says, and when it shows
// everyone out (the draft closed, or stepped back to before it opened).
import { describe, expect, it } from "vitest";
import { canEnterRoom, draftShows, roomPath, roomTurn } from "./draft-room";

const CARA = 1;
const COLE = 2;
const REG = 3;
/** Two captains, Cara picking first, six signed up besides them; `picked` of them taken so far, in snake order. */
function draft(picked = 0, draftState = "open") {
  const pool = [10, 11, 12, 13, 14, 15];
  const teams = [
    { captainMemberId: CARA, players: [] as { memberId: number; pick: number }[] },
    { captainMemberId: COLE, players: [] as { memberId: number; pick: number }[] },
  ];
  // A B B A A B
  const order = [0, 1, 1, 0, 0, 1];
  for (let n = 0; n < picked; n++) teams[order[n]].players.push({ memberId: pool[n], pick: n + 1 });
  return { kind: "draft", draftState, teams, going: [CARA, COLE, ...pool] };
}
const name = (i: number) => ["Team Cara", "Team Cole"][i];

describe("who the draft room is for", () => {
  it("its captains and whoever runs the draft, while it's open; nobody else", () => {
    expect(canEnterRoom(draft(), CARA, false)).toBe(true);
    expect(canEnterRoom(draft(), REG, true)).toBe(true);
    expect(canEnterRoom(draft(), REG, false)).toBe(false);
  });

  it("shows everyone out once the draft closes, or before it opens (a step back to the drawn order)", () => {
    for (const state of ["closed", "none"]) {
      expect(canEnterRoom(draft(0, state), CARA, false)).toBe(false);
      expect(canEnterRoom(draft(0, state), REG, true)).toBe(false);
    }
  });

  it("isn't for a tournament whose teams enter, or with nothing loaded", () => {
    expect(canEnterRoom({ ...draft(), kind: "teams" }, REG, true)).toBe(false);
    expect(canEnterRoom(undefined, REG, true)).toBe(false);
  });

  it("lives under the draft's address, so Back leaves it for the page", () => {
    expect(roomPath("kumite")).toBe("/tournaments/kumite/draft/room");
  });
});

describe("where the picking is", () => {
  it("before it opens: the steps (the draw, opening it), on the page", () => {
    expect(draftShows(draft(0, "none"), false)).toBe("steps");
  });

  it("while it's picked: a summary on the Kumite's page, the picking itself only in the room", () => {
    expect(draftShows(draft(3), false)).toBe("summary");
    expect(draftShows(draft(3), true)).toBe("picking");
  });

  it("everyone picked, or closed: the teams, on the page and in the room alike", () => {
    expect(draftShows(draft(6), false)).toBe("done");
    expect(draftShows(draft(6), true)).toBe("done");
    expect(draftShows(draft(6, "closed"), false)).toBe("done");
  });
});

describe("the room's bar", () => {
  it("says it's your pick, or whose it is and how long till yours", () => {
    expect(roomTurn(draft(0), CARA, name)).toEqual({ said: "Your pick", you: true, team: 0, inPicks: null });
    expect(roomTurn(draft(0), COLE, name)).toEqual({
      said: "Team Cara is picking",
      you: false,
      team: 0,
      inPicks: 1,
    });
    // Whoever runs it waits for nobody
    expect(roomTurn(draft(1), REG, name)).toEqual({
      said: "Team Cole is picking",
      you: false,
      team: 1,
      inPicks: null,
    });
  });

  it("says everyone's picked once the pool's empty", () => {
    expect(roomTurn(draft(6), CARA, name)).toEqual({
      said: "Everyone's picked",
      you: false,
      team: null,
      inPicks: null,
    });
  });
});
