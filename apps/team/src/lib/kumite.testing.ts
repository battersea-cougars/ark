// The Kumite as the unit tests build it: a tournament, its teams, its games and a snake draft, in the shape the app's
// model has them, so each test passes in only what its story changes. Use cases build theirs through the API instead
// (worker/tournaments/awards.testing.ts). For Vitest only.
import type { Tournament } from "../demo/model";

export type GameStatus = "next" | "live" | "done";

/** A team as bootstrap sends it: its captain, and the members picked for it. */
export const team = (id: number, captain: number, players: number[] = []) => ({
  id,
  name: "",
  logo: null,
  captainMemberId: captain,
  captainName: "",
  contact: "",
  players: players.map((memberId) => ({ memberId, name: "" })),
});

/** A group game, number `position` in the day's order (its id 100 + position): 1–0 once it's under way. */
export const game = (
  position: number,
  status: GameStatus = "next",
  home: number | null = 1,
  away: number | null = 2,
) => ({
  id: 100 + position,
  stage: "group" as const,
  position,
  homeTeamId: home,
  awayTeamId: away,
  homeSeed: null,
  awaySeed: null,
  homeGoals: status === "next" ? null : 1,
  awayGoals: status === "next" ? null : 0,
  status,
});

/** A Kumite on 14 November 2026, sign-up open, the draft still to come, nobody in yet; the rest is the test's. */
export const kumite = (o: Partial<Tournament> = {}) =>
  ({
    id: 10,
    typeId: 1,
    kind: "draft",
    status: "open",
    heldOn: "2026-11-14",
    season: null,
    signupOpensOn: null,
    signupClosesOn: null,
    going: [],
    waitlist: [],
    teams: [],
    games: [],
    draftState: "scheduled",
    ...o,
  }) as unknown as Tournament;

export const CARA = 1;
export const COLE = 2;

/** Two captains (Cara picking first, then Cole), six signed up besides them; `picked` of them taken so far, in snake
 * order: A B B A A B. */
export function snakeDraft(picked = 0, draftState = "open") {
  const pool = [10, 11, 12, 13, 14, 15];
  const teams = [
    { captainMemberId: CARA, players: [] as { memberId: number; pick: number }[] },
    { captainMemberId: COLE, players: [] as { memberId: number; pick: number }[] },
  ];
  const order = [0, 1, 1, 0, 0, 1];
  for (let n = 0; n < picked; n++) teams[order[n]].players.push({ memberId: pool[n], pick: n + 1 });
  return { kind: "draft", draftState, teams, going: [CARA, COLE, ...pool] };
}

/** A minute of game time, in the milliseconds the clock counts. */
export const MIN = 60_000;

/** A penalty on the game's clock: called at `atMs` (null: no time kept), a minor unless it says otherwise. */
export const penalty = (
  id: number,
  teamId: number,
  atMs: number | null,
  minutes: 2 | 4 | 5 = 2,
  memberId: number | null = null,
) => ({ id, teamId, memberId, minutes, atMs });

/** A goal on the game's clock, for the penalty maths: whose, and when. */
export const goalAt = (teamId: number, atMs: number | null) => ({ teamId, atMs });
