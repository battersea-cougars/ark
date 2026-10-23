// The Kumite simulator on a tournament's own day (ADR 0123), dev only: for a Kumite dated in the past (past-day.ts),
// the simulator's clocks are its evening's, not now, so it's played that evening and goes straight to history
// (lib/edition.ts playedOn: the evening its last match kicked off). The evening runs to a timetable worked out from
// what's been played, so a run stopped part way carries on at the same time: the first match kicks off half an hour
// after its start time (the draft first), each period runs its full length, a break between them, and the next match
// kicks off a few minutes after the last ended. Then, past the matches, the awards: confirmed with a winner each (the
// stats' and a draw's from the data, a vote's and the judges' call chosen at random), and each one revealed in turn.
import { awardFromData, candidatesOf, decidedByOf, LIVE_OPTIONS, playersOf } from "../../src/lib/awards";
import { londonISO } from "../../src/lib/dates";
import { awardsDataOf, nextAward, revealAward, setWinners, type Winner } from "./awards";
import { randomBelow } from "./draft";
import type { Game } from "./fixtures";
import type { Simulated } from "./simulate";

/** What the evening's timetable is worked out from: the tournament's day, hours and match length, and its reveal. */
export interface Evening {
  heldOn: string;
  startTime: string;
  gameMinutes: number;
  periods: number;
  breakMinutes: number;
  /** How many awards are out, and whether the drum's rolled on to the next (ADR 0074). */
  revealed: number;
  next: number;
}

/** The draft, on the night before the first match. */
const DRAFT_MS = 30 * 60_000;
/** From one match's end to the next one's kick-off. */
const CHANGEOVER_MS = 3 * 60_000;
/** From the last match's end to the awards. */
const AWARDS_MS = 15 * 60_000;

/**
 * The time on the evening for the simulator's next move, as `now` is to it: a clock it starts is started a period
 * before (simulate.ts gameMove), so for a match to kick off at its time, `now` is a period after it. A period being
 * played: when it runs out. Between periods: the next one's start, after the break, a period on. No match on: the next
 * one's kick-off, a period on, after the last one played (or the evening's first). Everything played: the awards.
 */
export function eveningClock(t: Evening, games: Game[]): Date {
  const full = t.gameMinutes * 60_000;
  const gap = t.breakMinutes * 60_000;
  const length = t.periods * full + (t.periods - 1) * gap;
  const on = games.find((g) => g.status === "live" && g.startedAt);
  if (on?.clockStartedAt) return new Date(Date.parse(on.clockStartedAt) + (on.clockLeftMs ?? full));
  if (on) return new Date(Date.parse(on.startedAt!) + (on.period - 1) * (full + gap) + (on.clockLeftMs ?? full));
  const ended = games
    .flatMap((g) => (g.status === "done" && g.startedAt ? [Date.parse(g.startedAt) + length] : []))
    .sort((a, b) => a - b)
    .at(-1);
  const first = Date.parse(londonISO(t.heldOn, t.startTime)) + DRAFT_MS;
  if (ended !== undefined && games.every((g) => g.status === "done")) return new Date(ended + AWARDS_MS);
  return new Date((ended === undefined ? first : ended + CHANGEOVER_MS) + full);
}

const DONE_SAID = "Played on its day, every award out: it's in Past Kumites.";

const pickOne = <T>(items: readonly T[]) => items[randomBelow(items.length)];

/**
 * The move after the matches, on its day: the awards confirmed, then each revealed, the drum rolled on between them
 * (as the admin's taps at the after-party: revealAward, nextAward). Done once every one's out.
 */
export async function awardsMove(db: D1Database, tournamentId: number, t: Evening, at: Date): Promise<Simulated> {
  const { data, awards, toReveal, confirmed, ctx } = await awardsDataOf(db, tournamentId);
  if (!confirmed) {
    await setWinners(db, tournamentId, { winners: chosenWinners(data, awards, ctx) }, at.toISOString());
    return { done: false, move: "awards", said: "The awards confirmed" };
  }
  if (t.revealed >= toReveal.length) return { done: true, move: "done", said: DONE_SAID };
  if (t.revealed === 0 || t.next) {
    await revealAward(db, tournamentId, { next: t.revealed });
    return { done: false, move: "reveal", said: `Revealed: ${toReveal[t.revealed].name}` };
  }
  await nextAward(db, tournamentId, { at: t.revealed });
  return { done: false, move: "nextAward", said: "On to the next award" };
}

type AwardsOf = Awaited<ReturnType<typeof awardsDataOf>>;

/**
 * A winner for every award, as an admin confirming them would have it: a stat's and a draw's from the data (joint
 * winners and all), a vote's one of those who could be voted for (nobody voted: the admin chooses), the judges' call
 * one of its names and anyone who played.
 */
function chosenWinners(data: AwardsOf["data"], awards: AwardsOf["awards"], ctx: AwardsOf["ctx"]): Winner[] {
  return awards.flatMap((award): Winner[] => {
    const how = decidedByOf(award);
    if (how.kind === "vote") {
      const candidates = candidatesOf(award, data, ctx);
      return candidates.length ? [{ award: award.name, teamId: null, memberId: pickOne(candidates) }] : [];
    }
    if (how.kind === "live") {
      const everyone = playersOf(data);
      const names = how.options.length ? how.options : LIVE_OPTIONS;
      return everyone.length
        ? [{ award: award.name, teamId: null, memberId: pickOne(everyone), title: pickOne(names) }]
        : [];
    }
    const from = awardFromData(award, data, ctx);
    return (from?.winners ?? []).map((w) => ({ award: award.name, ...w }));
  });
}
