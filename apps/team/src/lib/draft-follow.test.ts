// Following the draft on a phone (ADR 0060): a captain (Team Cara, first in the order) picks and sees it burn into
// their team, watches the others' picks burn in one by one, and is brought back for their turn; never moved on while
// a pick's still burning in; takes over, and is brought back by their turn or Follow the draft.
import { describe, expect, it } from "vitest";
import { followDraft, following, type Follow, type FollowEvent } from "./draft-follow";

const MINE = 0;
const run = (s: Follow, ...events: FollowEvent[]) => events.reduce(followDraft, s);
const where = (s: Follow) => ({ view: s.view, focus: s.focus, follow: s.follow });

describe("following the draft on a phone", () => {
  it("my pick made: over to the teams, my team in front while it burns in, then the team on the clock", () => {
    const s = run(following(MINE), { kind: "picked", team: MINE }, { kind: "reveal", team: MINE });
    expect(where(s)).toEqual({ view: "teams", focus: MINE, follow: true });
    // The turn moves on while it's burning: it waits
    const waiting = followDraft(s, { kind: "advance", clock: 1, mine: MINE });
    expect(where(waiting)).toEqual({ view: "teams", focus: MINE, follow: true });
    // Burnt in, held: now on to the team on the clock
    expect(where(followDraft(waiting, { kind: "settled" }))).toEqual({ view: "teams", focus: 1, follow: true });
  });

  it("their pick burns into their card in front, then on to the next team", () => {
    const watching = run(following(MINE), { kind: "picked", team: MINE }, { kind: "settled" });
    const s = run(watching, { kind: "reveal", team: 1 }, { kind: "advance", clock: 2, mine: MINE });
    expect(where(s).focus).toBe(1);
    expect(where(followDraft(s, { kind: "settled" })).focus).toBe(2);
  });

  it("a burning pick blocks the move; another landing meanwhile waits its turn, the latest move winning", () => {
    const s = run(
      { ...following(MINE), view: "teams" },
      { kind: "reveal", team: 1 },
      { kind: "advance", clock: 2, mine: MINE },
      // Team 2 picks while team 1's is still burning: nothing moves yet
      { kind: "advance", clock: 3, mine: MINE },
    );
    expect(s.busy).toBe(true);
    expect(where(s).focus).toBe(1);
    // Team 1's settles; then team 2's reveal plays in front before the move to 3
    const next = run(s, { kind: "reveal", team: 2 });
    expect(where(next).focus).toBe(2);
    expect(where(followDraft(next, { kind: "settled" })).focus).toBe(3);
  });

  it("the turn reaching my team: back to the players, but only once the last pick's burnt in", () => {
    const s = run(
      { ...following(MINE), view: "teams", focus: 1 },
      { kind: "reveal", team: 1 },
      {
        kind: "advance",
        clock: MINE,
        mine: MINE,
      },
    );
    expect(where(s).view).toBe("teams");
    expect(where(followDraft(s, { kind: "settled" }))).toEqual({ view: "players", focus: MINE, follow: true });
  });

  it("on the players before my first pick, I'm left there to plan, not pulled to the teams", () => {
    const s = run(
      following(MINE),
      { kind: "reveal", team: 1 },
      { kind: "advance", clock: 2, mine: MINE },
      {
        kind: "settled",
      },
    );
    expect(where(s).view).toBe("players");
  });

  it("I take over (a tab, or moving the teams): it stops moving me with the draft", () => {
    const watching: Follow = { ...following(1), view: "teams" };
    const mine = followDraft(watching, { kind: "manual", view: "players" });
    expect(where(mine)).toEqual({ view: "players", focus: 1, follow: false });
    expect(followDraft(mine, { kind: "advance", clock: 2, mine: MINE })).toBe(mine);
    expect(where(followDraft(watching, { kind: "manual" }))).toEqual({ view: "teams", focus: 1, follow: false });
  });

  it("and picks it up again at my next turn, or my next pick", () => {
    const away: Follow = { ...following(1), view: "teams", follow: false };
    expect(where(followDraft(away, { kind: "advance", clock: MINE, mine: MINE }))).toEqual({
      view: "players",
      focus: MINE,
      follow: true,
    });
    expect(followDraft(away, { kind: "picked", team: MINE }).follow).toBe(true);
  });

  it("Follow the draft: back with it, wherever it's got to", () => {
    const away: Follow = { ...following(1), follow: false };
    expect(where(followDraft(away, { kind: "resume", clock: 3, mine: MINE }))).toEqual({
      view: "teams",
      focus: 3,
      follow: true,
    });
    expect(where(followDraft(away, { kind: "resume", clock: MINE, mine: MINE }))).toEqual({
      view: "players",
      focus: MINE,
      follow: true,
    });
  });
});
