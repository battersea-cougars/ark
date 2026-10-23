// The draft room (ADR 0060): the draft as the whole screen, for its captains and whoever runs it, while it's open.
// Nothing of the app around it (no rail, dock, tabs, header or track); the browser's full screen is the room's own
// button. Who's let in, what the status shows where, what its bar says, and where it lives; the page is
// pages/DraftRoom.svelte.
import { draftTurn, onTheClock } from "./draft";

/** Enough of a tournament to say who the room is for. */
interface Drafting {
  kind: string;
  draftState?: string;
  teams: { captainMemberId: number | null; players: { memberId: number | null; pick?: number | null }[] }[];
  going: number[];
}

/** The room's address: under the draft's own, so Back leaves the room for the page. */
export const roomPath = (slug: string) => `/tournaments/${slug}/draft/room`;

/** In it: the draft's open, and you're one of its captains or you run it. Otherwise the room shows you out. */
export function canEnterRoom(t: Drafting | undefined, me: number, runs: boolean): boolean {
  if (!t || t.kind !== "draft" || t.draftState !== "open" || t.teams.length < 2) return false;
  return runs || t.teams.some((x) => x.captainMemberId === me);
}

/**
 * What the draft's status shows (ADR 0060): the steps before it opens (the draw, opening it); while it's picked, on
 * the Kumite's page a summary (who's picking, the last pick, the way into the room) and in the room the picking
 * itself; once everyone's picked, or it's closed, the teams (and the pick log). The picking's only ever in the room.
 */
export type DraftShows = "steps" | "summary" | "picking" | "done";
export function draftShows(t: Drafting, room: boolean): DraftShows {
  if (t.draftState === "closed") return "done";
  if (t.draftState !== "open") return "steps";
  if (!draftTurn(t).left) return "done";
  return room ? "picking" : "summary";
}

/**
 * The room's bar: whose turn, big (Your choice, Team Cal is choosing, Everyone's chosen), the team picking, and, for a
 * captain waiting, how long till theirs. `name` is a team's name by its place in the pick order.
 */
export function roomTurn(
  t: Drafting,
  me: number,
  name: (team: number) => string,
): { said: string; you: boolean; team: number | null; inPicks: number | null } {
  const mine = t.teams.findIndex((x) => x.captainMemberId === me);
  const { left, slots, picks, until } = draftTurn(t, mine);
  if (!left) return { said: "Everyone's chosen", you: false, team: null, inPicks: null };
  const clock = onTheClock(t.teams.length, slots[0] ?? picks);
  if (clock === mine) return { said: "Your choice", you: true, team: clock, inPicks: null };
  return {
    said: `${name(clock)} is choosing`,
    you: false,
    team: clock,
    inPicks: mine >= 0 && until !== Infinity ? until : null,
  };
}

/** The browser's full screen, on or off, from the room's own button (a tap, which lets a page ask). */
export function toggleFullScreen() {
  try {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  } catch {
    // Not here (an iPhone's Safari): the room's the whole page anyway
  }
}

/** Whether this browser lets a page go full screen (an iPhone's Safari doesn't). */
export const canFullScreen = () => typeof document !== "undefined" && !!document.documentElement.requestFullscreen;

/** Out of the browser's full screen, if the room took it. */
export function leaveFullScreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
