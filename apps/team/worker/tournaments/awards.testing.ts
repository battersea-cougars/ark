// The Kumite's evening, for the awards' use cases (ADR 0044, 0074): two teams, their one match played, everyone at
// The Anchor. The series' awards as the club seed has them: the judges' call, Top scorer, Best keeper (the skaters
// vote), Champions. For Vitest only.
import { expect } from "vitest";
import type { testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Gus Goalie", position: "G", rating: 60, email: "gus@example.com" },
  { name: "Cole Captain", position: "G", rating: 68, email: "cole@example.com" },
  { name: "Sam Skater", position: "D", rating: 58, email: "sam@example.com" },
  { name: "Mo Member", position: "D", rating: 55, email: "mo@example.com" },
];
/** The Kumite series, as the club's seed has it. */
export const KUMITE = 1;
/** Friday 13 November 2026, 21:45 GMT: the last match just played. */
export const EVENING = { now: new Date("2026-11-13T21:45:00Z") };
/** Saturday, 06:30: the evening's over. */
export const MORNING = { now: new Date("2026-11-14T06:30:00Z") };

/**
 * A Kumite on Friday 13 November: Ants (Cara, captain, and Gus in goal) beat Bees (Cole, captain, in goal, and Sam)
 * 3–1, its one match, that evening. Mo didn't play; Dana runs it.
 */
export async function kumiteNight(w: ReturnType<typeof testWorld>) {
  const dana = await w.signedIn("dana@example.com");
  const club = (await dana.call("GET", "/api/bootstrap", undefined, EVENING)).body as Json;
  const idOf = (name: string) => club.members.find((m: Json) => m.name === name).id as number;
  const made = await dana.call("POST", "/api/tournaments", {
    typeId: KUMITE,
    name: "Kumite Autumn 2026",
    heldOn: "2026-11-13",
    startTime: "19:30",
    endTime: "21:30",
    kind: "teams",
    playoffs: [],
    teams: [
      { name: "Ants", logo: null, captainMemberId: idOf("Cara Captain"), players: [{ memberId: idOf("Gus Goalie") }] },
      { name: "Bees", logo: null, captainMemberId: idOf("Cole Captain"), players: [{ memberId: idOf("Sam Skater") }] },
    ],
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`, undefined, EVENING)).status).toBe(200);
  const tournament = async (as = dana, at = EVENING) =>
    ((await as.call("GET", "/api/bootstrap", undefined, at)).body as Json).tournaments.find((t: Json) => t.id === id);
  const t = await tournament();
  const [ants, bees] = t.teams.map((x: Json) => x.id as number);
  /** Every match played: Ants 3, Bees 1. */
  const play = async () => {
    for (const g of (await tournament()).games)
      expect(
        (await dana.call("PUT", `/api/tournaments/${id}/games/${g.id}`, { homeGoals: 3, awayGoals: 1 }, EVENING))
          .status,
      ).toBe(200);
  };
  await play();
  /** Confirming the awards, as the drawer sends them: the stats checked, the judges' call made, any tie settled. */
  /** Confirm, as the drawer sends it; `keeper: false` leaves out the admin's keeper (to see a vote come back level). */
  const confirm = (extra: object[] = [], as = dana, { keeper = true } = {}) =>
    as.call(
      "PUT",
      `/api/tournaments/${id}/winners`,
      {
        winners: [
          { award: "The Judges' Call", memberId: idOf("Sam Skater"), title: "Most Dramatic Fall" },
          { award: "Top scorer", memberId: idOf("Cara Captain") },
          { award: "Champions", teamId: ants },
          // The admin's keeper, as the drawer sends it: counted only when nobody voted (or it's level)
          ...(keeper ? [{ award: "Best keeper", memberId: idOf("Gus Goalie") }] : []),
          ...extra,
        ],
      },
      EVENING,
    );
  /** A member's votes, as the sheet sends them. */
  const vote = (as: Json, votes: { award: string; memberId: number }[]) =>
    as.call("POST", `/api/tournaments/${id}/votes`, { votes }, EVENING);
  /** The card showing sealed: reveal it. `next` is how many are out, as the tap saw it. */
  const reveal = (next: number, as = dana) =>
    as.call("POST", `/api/tournaments/${id}/awards/reveal`, { next }, EVENING);
  /** The card showing face up: Next award, rolling on to the next, sealed. `at` is how many are out. */
  const roll = (at: number, as = dana) => as.call("POST", `/api/tournaments/${id}/awards/next`, { at }, EVENING);
  /** Reveal the next and roll on, as the admin's two taps do. */
  const revealThenRoll = async (next: number) => {
    expect((await reveal(next)).status).toBe(200);
    expect((await roll(next + 1)).status).toBe(200);
  };
  /** What someone sees of the awards: how many are out, the drum, and the winners they're sent. */
  const sees = async (as = dana, at = EVENING) => {
    const x = await tournament(as, at);
    return { revealed: x.awardsRevealed, next: x.awardsNext, winners: x.winners.map((v: Json) => v.award) };
  };
  return { dana, id, idOf, ants, bees, play, confirm, vote, reveal, roll, revealThenRoll, sees, tournament };
}
