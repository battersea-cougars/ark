// Following the draft on a phone (ADR 0060). The teams are the page: no tabs. The room opens with the team on the clock
// in front, and a captain's view goes where the draft is: each pick that lands burns into its team in front, held a
// moment with the name cooled, and only then on to the next team. Your turn come round (once the last pick's burnt in):
// the Your pick button comes up at the foot of the screen, and opens the players in a drawer; you pick and confirm in
// it, it shuts, and your pick burns into your team in front. The turn passing while it's open to pick (an admin picked
// for you, or your other phone) shuts it and says so. Anyone can open the players to look. Move the teams yourself and
// it leaves you be until your next pick or your next turn (or Follow the draft). The page does the burns' timing and
// the motion; this says where the view goes, and when.

export type Drawer = "shut" | "look" | "pick";

export interface Follow {
  /** Moving with the draft, or left alone (you took over). */
  follow: boolean;
  /** The team brought forward in the teams. */
  focus: number;
  /** A pick's burning in (and its moment after): the turn's move waits. */
  busy: boolean;
  /** The move waiting for it: the turn's at this team (and `mine` is yours). */
  queued: { clock: number; mine: number } | null;
  /** Your turn, as shown: the Your pick button up (once the last pick's burnt in and the light's on your team). */
  yours: boolean;
  /** The players' drawer: shut, open to look, or open for your pick. */
  drawer: Drawer;
  /** It shut itself: the turn passed while it was open for your pick (the page says so). */
  passed: boolean;
}

/** Opening the room: following, the team on the clock in front; your pick's button up if it's your turn. */
export const following = (clock = -1, mine = -2): Follow => ({
  follow: true,
  focus: clock,
  busy: false,
  queued: null,
  yours: clock === mine,
  drawer: "shut",
  passed: false,
});

export type FollowEvent =
  /** Your pick went in, onto your team (`team`): the drawer shuts. */
  | { kind: "picked"; team: number }
  /** A pick starts burning into its team: that team in front. */
  | { kind: "reveal"; team: number }
  /** The burn's done and its moment held: the waiting move goes now. */
  | { kind: "settled" }
  /** The turn's moved to `clock` (`mine` is your team's place): on to it, once nothing's burning. */
  | { kind: "advance"; clock: number; mine: number }
  /** A pick landed that wasn't the one you just made (someone else's, or made for you): at once, burning or not. */
  | { kind: "taken" }
  /** You opened the players: for your pick (`pick`, it's your turn) or to look. */
  | { kind: "open"; pick: boolean }
  /** You shut the drawer. */
  | { kind: "shut" }
  /** You moved the teams yourself. */
  | { kind: "manual" }
  /** Follow the draft: back with it, wherever it's got to. */
  | { kind: "resume"; clock: number; mine: number };

/** Where it goes for the turn at `clock`: your turn, your team in front and your button up; anyone else's, their
 * team in front (if you're following). A drawer open to look becomes your pick's when your turn comes. */
function moveTo(s: Follow, clock: number, mine: number): Follow {
  if (clock === mine)
    return { ...s, follow: true, focus: clock, yours: true, drawer: s.drawer === "look" ? "pick" : s.drawer };
  return s.follow ? { ...s, focus: clock, yours: false } : { ...s, yours: false };
}

export function followDraft(s: Follow, e: FollowEvent): Follow {
  switch (e.kind) {
    case "picked":
      return { ...s, follow: true, focus: e.team, yours: false, drawer: "shut", passed: false };
    case "reveal":
      return s.follow ? { ...s, busy: true, focus: e.team } : { ...s, busy: true };
    case "settled": {
      const done = { ...s, busy: false, queued: null };
      return s.queued ? moveTo(done, s.queued.clock, s.queued.mine) : done;
    }
    case "advance":
      // Never while a pick's burning in: it waits, the latest turn replacing any before it
      if (s.busy) return { ...s, queued: { clock: e.clock, mine: e.mine } };
      return moveTo(s, e.clock, e.mine);
    case "taken":
      // Open for your pick and someone else's landed: your turn's gone, so the drawer shuts and the page says so
      return s.drawer === "pick" ? { ...s, drawer: "shut", yours: false, passed: true } : s;
    case "open":
      return { ...s, drawer: e.pick ? "pick" : "look", passed: false };
    case "shut":
      return { ...s, drawer: "shut", passed: false };
    case "manual":
      return { ...s, follow: false };
    case "resume":
      return moveTo({ ...s, follow: true }, e.clock, e.mine);
  }
}
