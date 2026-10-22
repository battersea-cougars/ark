// The draft room (ADR 0060): the draft as the whole screen, for its captains and whoever runs it, while it's open.
// Nothing of the app around it (no rail, dock, tabs, header or track), the browser's full screen where it has one.
// Who's let in, when it's offered, what its bar says, and where it lives; the page is pages/DraftRoom.svelte.
import { draftTurn, onTheClock } from "./draft";

/** A captain whose pick is this close (0: now) is offered the room. */
export const ROOM_SOON = 2;

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

/** Offered, lit: a captain with players still to pick, their pick now or in ROOM_SOON. */
export function roomOffered(t: Drafting | undefined, me: number): boolean {
  if (!t || !canEnterRoom(t, me, false)) return false;
  const { left, until } = draftTurn(
    t,
    t.teams.findIndex((x) => x.captainMemberId === me),
  );
  return left > 0 && until <= ROOM_SOON;
}

/**
 * The room's bar: whose turn, big (Your pick, Team Cal is picking, Everyone's picked), the team picking, and, for a
 * captain waiting, how long till theirs. `name` is a team's name by its place in the pick order.
 */
export function roomTurn(
  t: Drafting,
  me: number,
  name: (team: number) => string,
): { said: string; you: boolean; team: number | null; inPicks: number | null } {
  const mine = t.teams.findIndex((x) => x.captainMemberId === me);
  const { left, slots, picks, until } = draftTurn(t, mine);
  if (!left) return { said: "Everyone's picked", you: false, team: null, inPicks: null };
  const clock = onTheClock(t.teams.length, slots[0] ?? picks);
  if (clock === mine) return { said: "Your pick", you: true, team: clock, inPicks: null };
  return {
    said: `${name(clock)} is picking`,
    you: false,
    team: clock,
    inPicks: mine >= 0 && until !== Infinity ? until : null,
  };
}

/**
 * Into the room from a tap (the tap lets a page ask): the browser's full screen where it has one for a page (not an
 * iPhone's Safari, which keeps it for video: the room is still the whole page there), then the room's address.
 */
export function enterRoom(slug: string, go: (path: string) => void) {
  const root = document.documentElement;
  if (root.requestFullscreen && !document.fullscreenElement)
    root.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  go(roomPath(slug));
}

/** Out of the browser's full screen, if the room took it. */
export function leaveFullScreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
