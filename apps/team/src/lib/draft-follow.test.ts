// Following the draft on a phone (ADR 0060): a captain (Team Cara, first in the order) sees the teams, never a tab;
// their turn brings up the Your pick button, which opens the players in a drawer; they pick and confirm there, it
// shuts and the pick burns into their team; they watch the others' picks burn in one by one; never moved on while a
// pick's still burning in; the turn passing while the drawer's open for their pick shuts it; they take over, and are
// brought back by their turn or Follow the draft.
import { describe, expect, it } from "vitest";
import { followDraft, following, type Follow, type FollowEvent } from "./draft-follow";

const MINE = 0;
/** In the room, my turn just come round. */
const myTurn = () => following(MINE, MINE);
const run = (s: Follow, ...events: FollowEvent[]) => events.reduce(followDraft, s);
const where = (s: Follow) => ({ focus: s.focus, follow: s.follow, yours: s.yours });

describe("following the draft on a phone", () => {
  it("the room opens on the teams, the team on the clock in front; my button up if it's my turn", () => {
    expect(where(following(2, MINE))).toEqual({ focus: 2, follow: true, yours: false });
    expect(where(following(MINE, MINE))).toEqual({ focus: MINE, follow: true, yours: true });
    expect(following(MINE, MINE).drawer).toBe("shut");
  });

  it("my turn: Your pick opens the players for my pick; confirmed, it shuts and my team's in front", () => {
    const open = followDraft(myTurn(), { kind: "open", pick: true });
    expect(open.drawer).toBe("pick");
    const picked = followDraft(open, { kind: "picked", team: MINE });
    expect(picked.drawer).toBe("shut");
    expect(picked.passed).toBe(false);
    expect(where(picked)).toEqual({ focus: MINE, follow: true, yours: false });
  });

  it("my pick made: my team in front while it burns in, then the team on the clock", () => {
    const s = run(myTurn(), { kind: "picked", team: MINE }, { kind: "reveal", team: MINE });
    expect(where(s)).toEqual({ focus: MINE, follow: true, yours: false });
    // The turn moves on while it's burning: it waits
    const waiting = followDraft(s, { kind: "advance", clock: 1, mine: MINE });
    expect(where(waiting).focus).toBe(MINE);
    // Burnt in, held: now on to the team on the clock
    expect(where(followDraft(waiting, { kind: "settled" }))).toEqual({ focus: 1, follow: true, yours: false });
  });

  it("their pick burns into their card in front, then on to the next team", () => {
    const watching = run(myTurn(), { kind: "picked", team: MINE }, { kind: "settled" });
    const s = run(watching, { kind: "reveal", team: 1 }, { kind: "advance", clock: 2, mine: MINE });
    expect(where(s).focus).toBe(1);
    expect(where(followDraft(s, { kind: "settled" })).focus).toBe(2);
  });

  it("a burning pick blocks the move; another landing meanwhile waits its turn, the latest move winning", () => {
    const s = run(
      following(-1, MINE),
      { kind: "reveal", team: 1 },
      { kind: "advance", clock: 2, mine: MINE },
      // Team 2 picks while team 1's is still burning: nothing moves yet
      { kind: "advance", clock: 3, mine: MINE },
    );
    expect(s.busy).toBe(true);
    expect(where(s).focus).toBe(1);
    const next = run(s, { kind: "reveal", team: 2 });
    expect(where(next).focus).toBe(2);
    expect(where(followDraft(next, { kind: "settled" })).focus).toBe(3);
  });

  it("the turn reaching my team: my button comes up, but only once the last pick's burnt in; no drawer opens", () => {
    const s = run(following(1, MINE), { kind: "reveal", team: 1 }, { kind: "advance", clock: MINE, mine: MINE });
    expect(where(s).yours).toBe(false);
    const mine = followDraft(s, { kind: "settled" });
    expect(where(mine)).toEqual({ focus: MINE, follow: true, yours: true });
    expect(mine.drawer).toBe("shut");
  });

  it("the turn passing while the drawer's open for my pick (an admin picked for me): it shuts, and says so", () => {
    const open = followDraft(myTurn(), { kind: "open", pick: true });
    const gone = followDraft(open, { kind: "taken" });
    expect(gone.drawer).toBe("shut");
    expect(gone.passed).toBe(true);
    expect(gone.yours).toBe(false);
    // Opening it again is a fresh look: nothing to say
    expect(followDraft(gone, { kind: "open", pick: false }).passed).toBe(false);
  });

  it("just looking: a pick landing leaves the drawer open; my turn coming makes it my pick's", () => {
    const looking = followDraft(following(1, MINE), { kind: "open", pick: false });
    expect(followDraft(looking, { kind: "taken" })).toBe(looking);
    const turn = followDraft(looking, { kind: "advance", clock: MINE, mine: MINE });
    expect(turn.drawer).toBe("pick");
    expect(followDraft(turn, { kind: "shut" }).drawer).toBe("shut");
  });

  it("I take over (moving the teams): it stops moving me with the draft", () => {
    const mine = followDraft(following(1, MINE), { kind: "manual" });
    expect(where(mine)).toEqual({ focus: 1, follow: false, yours: false });
    expect(followDraft(mine, { kind: "advance", clock: 2, mine: MINE })).toEqual(mine);
  });

  it("and picks it up again at my next turn, or my next pick", () => {
    const away: Follow = { ...following(1, MINE), follow: false };
    expect(where(followDraft(away, { kind: "advance", clock: MINE, mine: MINE }))).toEqual({
      focus: MINE,
      follow: true,
      yours: true,
    });
    expect(followDraft(away, { kind: "picked", team: MINE }).follow).toBe(true);
  });

  it("Follow the draft: back with it, wherever it's got to", () => {
    const away: Follow = { ...following(1, MINE), follow: false };
    expect(where(followDraft(away, { kind: "resume", clock: 3, mine: MINE }))).toEqual({
      focus: 3,
      follow: true,
      yours: false,
    });
    expect(where(followDraft(away, { kind: "resume", clock: MINE, mine: MINE })).yours).toBe(true);
  });
});
