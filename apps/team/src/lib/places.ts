import { PLAYERS } from "../demo/data";

// A training's places (ADR 0030): the limit is the skaters'; keepers have places of their own if the series sets any
// (goalieCapacity), else no limit. So a keeper never takes a skater's place, nor a skater a keeper's: who's in, who
// waits and who moves up are counted a side at a time. The server decides (worker/entries); the app shows the same
// at once, until its reply puts the lists right.

/** A training's limits: the skaters' (`capacity`) and the keepers' (`goalieCapacity`); null or unset: no limit. */
export interface Limits {
  capacity?: number | null;
  goalieCapacity?: number | null;
}

/** Whether someone keeps goal (their places counted apart). */
export const keeps = (id: number) => PLAYERS.find((p) => p.id === id)?.position === "G";

/** The places that count for a keeper or a skater; null: no limit. */
export const limitFor = (keeper: boolean, l: Limits) => (keeper ? l.goalieCapacity : l.capacity) ?? null;

/** Who's in on one side: the keepers, or the skaters. */
export const onSide = (ids: number[], keeper: boolean, isKeeper = keeps) => ids.filter((id) => isKeeper(id) === keeper);

/** Whether there's a place for them now. */
export function roomFor(id: number, going: number[], l: Limits, isKeeper = keeps): boolean {
  const keeper = isKeeper(id);
  const limit = limitFor(keeper, l);
  return limit === null || onSide(going, keeper, isKeeper).length < limit;
}

/** Places left for skaters and for keepers (null: no limit); below nothing once someone's let in over it. */
export function placesLeft(going: number[], l: Limits, isKeeper = keeps) {
  const left = (keeper: boolean) => {
    const limit = limitFor(keeper, l);
    return limit === null ? null : limit - onSide(going, keeper, isKeeper).length;
  };
  return { skaters: left(false), keepers: left(true) };
}

/**
 * Someone who was in has gone: the first waiting on their side (keeper or skater) moves up, if there's room on it.
 * Says who, if anyone. The waiting list is in its order already (Quarterly skaters first).
 */
export function nextUp(gone: number, going: number[], waitlist: number[], l: Limits, isKeeper = keeps) {
  const keeper = isKeeper(gone);
  const up = waitlist.find((id) => isKeeper(id) === keeper);
  return up !== undefined && roomFor(up, going, l, isKeeper) ? up : undefined;
}
