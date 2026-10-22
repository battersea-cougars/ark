// Following the draft (ADR 0060). On a phone, where the players and the teams are a tab apart, a captain's view goes
// where the draft is: your pick made, the teams, your team in front for it to burn in; then the team on the clock;
// each pick that lands burns into its team in front, held a moment with the name cooled, and only then on to the next
// team; your turn, back to the players. Never on while a pick's still burning in: the move waits for it. Touch a tab
// or move the teams yourself and it leaves you be until your next pick or your next turn (or Follow the draft). The
// page does the burns' timing and the motion; this says where the view goes, and when.

export type FollowView = "players" | "teams";

export interface Follow {
  view: FollowView;
  /** Moving with the draft, or left alone (you took over). */
  follow: boolean;
  /** The team brought forward in the teams. */
  focus: number;
  /** A pick's burning in (and its moment after): the turn's move waits. */
  busy: boolean;
  /** The move waiting for it: the turn's at this team (and `mine` is yours). */
  queued: { clock: number; mine: number } | null;
}

export const following = (focus = -1): Follow => ({ view: "players", follow: true, focus, busy: false, queued: null });

export type FollowEvent =
  /** Your pick went in, onto your team (`team`). */
  | { kind: "picked"; team: number }
  /** A pick starts burning into its team: that team in front. */
  | { kind: "reveal"; team: number }
  /** The burn's done and its moment held: the waiting move goes now. */
  | { kind: "settled" }
  /** The turn's moved to `clock` (`mine` is your team's place): on to it, once nothing's burning. */
  | { kind: "advance"; clock: number; mine: number }
  /** You tapped a tab (`view`) or moved the teams yourself. */
  | { kind: "manual"; view?: FollowView }
  /** Follow the draft: back with it, wherever it's got to. */
  | { kind: "resume"; clock: number; mine: number };

/**
 * Where it goes for the turn at `clock`: your turn, the players to pick from; anyone else's, their team in front, if
 * you're watching the teams (on the players, planning your pick, you're left there).
 */
function moveTo(s: Follow, clock: number, mine: number): Follow {
  if (clock === mine) return { ...s, view: "players", follow: true, focus: clock };
  return s.follow && s.view === "teams" ? { ...s, focus: clock } : s;
}

export function followDraft(s: Follow, e: FollowEvent): Follow {
  switch (e.kind) {
    case "picked":
      return { ...s, view: "teams", follow: true, focus: e.team };
    case "reveal":
      return s.follow && s.view === "teams" ? { ...s, busy: true, focus: e.team } : { ...s, busy: true };
    case "settled": {
      const done = { ...s, busy: false, queued: null };
      return s.queued ? moveTo(done, s.queued.clock, s.queued.mine) : done;
    }
    case "advance":
      // Never while a pick's burning in: it waits, the latest turn replacing any before it
      if (s.busy) return { ...s, queued: { clock: e.clock, mine: e.mine } };
      return moveTo(s, e.clock, e.mine);
    case "manual":
      return { ...s, follow: false, view: e.view ?? s.view };
    case "resume":
      return e.clock === e.mine
        ? moveTo({ ...s, follow: true }, e.clock, e.mine)
        : { ...s, follow: true, view: "teams", focus: e.clock };
  }
}
