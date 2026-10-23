// Who won a tournament's awards (ADR 0044). The awards themselves are the tournament's (copied from its series, ADR
// 0044, 0049), each saying how it's decided (lib/awards.ts); this is who took each one home: a team (Champions) or a
// player on one of its teams. At the after-party (ADR 0074) there are two steps. First the awards are confirmed:
// from the last match till then, everyone who played votes for the voted ones; the admin checks the stats and draws,
// chooses where a vote's level, and makes the judges' call (its name tonight and who); confirming counts the votes,
// closes voting and sets every winner at once. Then the reveal: one award at a time, in the order listed.
import { all, batch, first, statement } from "@cougars/shared/d1";
import { isDone } from "@cougars/shared/results";
import { HttpError, int, text } from "../api/api.http";
import {
  awardsToReveal,
  candidatesOf,
  countVotes,
  decidedByOf,
  playersOf,
  votersOf,
  type AwardsData,
  type Positions,
} from "../../src/lib/awards";
import { parseAwards } from "./tournaments";

export interface Winner {
  award: string;
  teamId: number | null;
  memberId: number | null;
  /** An admin's live call: the name they gave it on the night. */
  title?: string | null;
}

/** SQL: the tournament `t` is done (every match played, or marked finished), as `isDone` has it. */
const DONE = `(t.status = 'finished' OR (EXISTS (SELECT 1 FROM tournament_games g WHERE g.tournament_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM tournament_games g WHERE g.tournament_id = t.id AND g.status <> 'done')))`;

/** Everything an award is decided from, in one round trip: the tournament, its teams, results and who plays where. */
export async function awardsDataOf(db: D1Database, tournamentId: number) {
  const p = [tournamentId];
  const [t, teams, players, games, goals, penalties, positions, winners] = (
    await batch(db, [
      statement(
        db,
        `SELECT status, awards, awards_revealed revealed, awards_confirmed_at confirmedAt, points_win pointsWin,
                points_draw pointsDraw, points_loss pointsLoss FROM tournaments WHERE id = ?`,
        p,
      ),
      statement(db, "SELECT id, captain_member_id captainMemberId FROM tournament_teams WHERE tournament_id = ?", p),
      statement(
        db,
        `SELECT p.team_id teamId, p.member_id memberId FROM tournament_team_players p
         JOIN tournament_teams t ON t.id = p.team_id WHERE t.tournament_id = ?`,
        p,
      ),
      statement(
        db,
        `SELECT id, stage, position, home_team_id homeTeamId, away_team_id awayTeamId, home_goals homeGoals,
                away_goals awayGoals, status FROM tournament_games WHERE tournament_id = ?`,
        p,
      ),
      statement(
        db,
        `SELECT game_id gameId, scorer_member_id scorerId, assist_member_id assistId FROM tournament_goals
         WHERE game_id IN (SELECT id FROM tournament_games WHERE tournament_id = ?)`,
        p,
      ),
      statement(
        db,
        `SELECT game_id gameId, member_id memberId, minutes FROM tournament_penalties
         WHERE game_id IN (SELECT id FROM tournament_games WHERE tournament_id = ?)`,
        p,
      ),
      statement(
        db,
        `SELECT id, position FROM members WHERE id IN (
           SELECT captain_member_id FROM tournament_teams WHERE tournament_id = ?
           UNION SELECT p.member_id FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
           WHERE t.tournament_id = ?)`,
        [tournamentId, tournamentId],
      ),
      statement(db, "SELECT award FROM tournament_award_winners WHERE tournament_id = ?", p),
    ])
  ).map((r) => r.results as Record<string, unknown>[]);
  const row = t[0] as
    | {
        status: string;
        awards: string;
        revealed: number;
        confirmedAt: string | null;
        pointsWin: number;
        pointsDraw: number;
        pointsLoss: number;
      }
    | undefined;
  if (!row) throw new HttpError(404, "No such tournament.");
  const position = new Map(positions.map((m) => [m.id as number, m.position as string]));
  const data: AwardsData & { status: string } = {
    id: tournamentId,
    status: row.status,
    pointsWin: row.pointsWin,
    pointsDraw: row.pointsDraw,
    pointsLoss: row.pointsLoss,
    teams: teams.map((x) => ({
      id: x.id as number,
      captainMemberId: x.captainMemberId as number | null,
      players: players.filter((p) => p.teamId === x.id).map((p) => ({ memberId: p.memberId as number | null })),
    })),
    games: games.map((g) => ({
      ...(g as unknown as NonNullable<AwardsData["games"]>[number]),
      goals: goals.filter((x) => x.gameId === g.id) as { scorerId: number | null; assistId: number | null }[],
      penalties: penalties.filter((x) => x.gameId === g.id) as { memberId: number | null; minutes: number }[],
    })),
  };
  const awards = parseAwards(row.awards);
  return {
    data,
    awards,
    // The ones revealed, in order: a judges' call left out isn't
    toReveal: awardsToReveal(
      awards,
      winners.map((w) => w.award as string),
    ),
    revealed: row.revealed,
    // Confirmed, or (before it was said when) its winners set
    confirmed: !!row.confirmedAt || winners.length > 0,
    // Voting closes once they're confirmed
    closed: !!row.confirmedAt,
    ctx: { positionOf: (id: number) => position.get(id) } satisfies Positions,
  };
}

/**
 * SQL: the place in the reveal of award `w.award` of tournament `t` (0 first), as `awardsToReveal` (lib/awards.ts)
 * has it: how many awards listed before it are revealed, a judges' call left out (live, nobody given it) not one.
 */
export const REVEAL_PLACE = `(SELECT COUNT(*) FROM json_each(t.awards) j
  WHERE j.key < (SELECT k.key FROM json_each(t.awards) k WHERE json_extract(k.value, '$.name') = w.award)
    AND (COALESCE(json_extract(j.value, '$.decidedBy.kind'), '') <> 'live'
      OR EXISTS (SELECT 1 FROM tournament_award_winners g
        WHERE g.tournament_id = t.id AND g.award = json_extract(j.value, '$.name'))))`;

const CLOSED = "Voting's closed: the awards are confirmed. Waiting for the reveal.";

/** SQL: the votes for the tournament whose id is the parameter, all told. */
const VOTES_CAST = "(SELECT COUNT(*) FROM tournament_award_votes WHERE tournament_id = ?)";

/**
 * Confirming the awards (ADR 0044), before the reveal: { winners: [{ award, teamId | memberId, title? }] }, the whole
 * list, replacing what was there. A stat's and a draw's as the admin checked them; the judges' call (a live award)
 * with the name it's given tonight (`title`, one of its names or the admin's own) and who; a vote's counted here, by
 * the Worker, from the votes cast (the admin never says who won one, unless it's level after its tie-break: then
 * the reply says who's level, `tied`, nothing's saved, and they choose among them). Saving closes voting.
 *
 * One batch, every statement going only while nothing's revealed and the votes are as counted (ADR 0121): a vote
 * landing as it's confirmed is counted again (or refused, once it's done); once the reveal's started it's refused.
 */
export async function setWinners(
  db: D1Database,
  tournamentId: number,
  o: Record<string, unknown>,
  now: string,
): Promise<{ tied?: Record<string, number[]> }> {
  const list = o.winners;
  if (!Array.isArray(list)) throw new HttpError(400, "winners should be a list.");
  for (let tries = 0; ; tries++) {
    const { data, awards, revealed, ctx } = await awardsDataOf(db, tournamentId);
    if (revealed > 0) throw new HttpError(409, "The reveal's started: step back to change the awards.");
    const teams = new Set(data.teams.flatMap((x) => (x.id ? [x.id] : [])));
    const players = new Set(playersOf(data));
    const given = list.map((w: Record<string, unknown>) => {
      const name = text(w, "award", { max: 40 });
      const award = awards.find((a) => a.name === name);
      if (!award) throw new HttpError(400, `"${name}" isn't one of this tournament's awards.`);
      const teamId = int(w, "teamId", { nullable: true });
      const memberId = int(w, "memberId", { nullable: true });
      if ((teamId === null) === (memberId === null)) throw new HttpError(400, "Each award goes to a team or a player.");
      if (teamId !== null && !teams.has(teamId)) throw new HttpError(400, "That team isn't in this tournament.");
      if (memberId !== null && !players.has(memberId)) throw new HttpError(400, "They didn't play in this tournament.");
      const how = decidedByOf(award);
      if (how.kind === "live" && memberId === null) throw new HttpError(400, `The judges' call goes to a player.`);
      const title = how.kind === "live" ? text(w, "title", { optional: true, max: 40 }) || null : null;
      return { award: name, teamId, memberId, title };
    });
    // The votes, counted now: a vote's winner is the count's, the admin's only where it's level
    const votes = await all<{ award: string; id: number }>(
      db,
      "SELECT award, candidate_member_id id FROM tournament_award_votes WHERE tournament_id = ?",
      [tournamentId],
    );
    const tied: Record<string, number[]> = {};
    const winners = awards.flatMap((award) => {
      const mine = given.filter((w) => w.award === award.name);
      if (decidedByOf(award).kind !== "vote") return decidedByOf(award).kind === "live" ? mine.slice(0, 1) : mine;
      const counted = countVotes(
        award,
        votes.filter((v) => v.award === award.name).map((v) => v.id),
        data,
        ctx,
      );
      if (!counted.tied.length)
        return counted.winners.map((memberId) => ({ award: award.name, teamId: null, memberId, title: null }));
      const chosen = mine.find((w) => w.memberId !== null && counted.tied.includes(w.memberId));
      if (!chosen) tied[award.name] = counted.tied;
      return chosen ? [{ ...chosen, teamId: null, title: null }] : [];
    });
    if (Object.keys(tied).length) return { tied };

    const guard = `EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND awards_revealed = 0) AND ${VOTES_CAST} = ?`;
    const g = [tournamentId, tournamentId, votes.length];
    const done = await batch(db, [
      statement(db, `DELETE FROM tournament_award_winners WHERE tournament_id = ? AND ${guard}`, [tournamentId, ...g]),
      ...winners.map((w, i) =>
        statement(
          db,
          `INSERT INTO tournament_award_winners (tournament_id, award, team_id, member_id, position, title)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`,
          [tournamentId, w.award, w.teamId, w.memberId, i, w.title, ...g],
        ),
      ),
      statement(db, `UPDATE tournaments SET awards_confirmed_at = ? WHERE id = ? AND ${guard}`, [
        now,
        tournamentId,
        ...g,
      ]),
    ]);
    if (done.at(-1)?.meta.changes) return {};
    // A vote came in as it was counted, or the reveal started: look again
    if (tries >= 2) throw new HttpError(409, "The votes are still coming in: confirm again.");
  }
}

/**
 * The next award revealed at the after-party (ADR 0074): `next` is its place in the list (0 first), the one the tap saw
 * face down. Only once the last match is played and the awards are confirmed (every winner set then, the judges'
 * call and the votes too). A second tap on the same one (a double tap, or two phones at once) finds it out already
 * and does nothing; a tap from a page that's fallen behind further is refused. One statement, guarded on the count
 * the tap saw, so two at once reveal one (ADR 0121).
 */
export async function revealAward(db: D1Database, tournamentId: number, o: Record<string, unknown>) {
  const next = int(o, "next", { max: 8 });
  const { data, toReveal, revealed, confirmed } = await awardsDataOf(db, tournamentId);
  if (!isDone(data.status, data.games ?? [])) throw new HttpError(409, "Not till the last match is played.");
  if (next >= toReveal.length) throw new HttpError(409, "Every award's out.");
  if (!confirmed) throw new HttpError(409, "Confirm the awards first.");
  if (revealed > next) return;
  if (revealed < next) throw new HttpError(409, "It's moved on since: have another look.");
  // The drum shows it sealed: the first, or the next once it's rolled on from the last
  await batch(db, [
    statement(
      db,
      `UPDATE tournaments SET awards_revealed = awards_revealed + 1, awards_next = 0
       WHERE id = ? AND awards_revealed = ? AND awards_revealed < ?
         AND (awards_revealed = 0 OR awards_next = 1)`,
      [tournamentId, next, toReveal.length],
    ),
  ]);
}

/**
 * Next award (ADR 0074): the drum rolls on from the award just revealed to the next one, sealed, for everyone
 * watching. `at` is how many were out when the tap saw it; a double tap (or two phones) rolls it once. One
 * statement, guarded on the count and the drum where the tap saw them (ADR 0121).
 */
export async function nextAward(db: D1Database, tournamentId: number, o: Record<string, unknown>) {
  const at = int(o, "at", { min: 1, max: 8 });
  const t = await first<{ revealed: number; next: number }>(
    db,
    "SELECT awards_revealed revealed, awards_next next FROM tournaments WHERE id = ?",
    [tournamentId],
  );
  if (!t) throw new HttpError(404, "No such tournament.");
  if (t.revealed > at || (t.revealed === at && t.next)) return;
  if (t.revealed < at) throw new HttpError(409, "It's moved on since: have another look.");
  const { toReveal } = await awardsDataOf(db, tournamentId);
  if (at >= toReveal.length) throw new HttpError(409, "That was the last one.");
  await batch(db, [
    statement(
      db,
      `UPDATE tournaments SET awards_next = 1
       WHERE id = ? AND awards_revealed = ? AND awards_next = 0 AND awards_revealed < ?`,
      [tournamentId, at, toReveal.length],
    ),
  ]);
}

/**
 * { votes: [{ award, memberId }] }: a member's votes (ADR 0044), one an award, secret, never for themselves. Only
 * for someone who played (the skaters, for a skaters' vote), once the last match is played, until the awards are
 * confirmed. Each vote goes in only while that's still so (ADR 0121): one landing as they're confirmed is refused. A
 * vote cast already stays: the same one again (a double tap) is nothing; a different one is refused.
 */
export async function castVotes(
  db: D1Database,
  tournamentId: number,
  voter: number,
  o: Record<string, unknown>,
  now: string,
) {
  const list = o.votes;
  if (!Array.isArray(list) || !list.length || list.length > 8) throw new HttpError(400, "votes should be a list.");
  const { data, awards, closed, ctx } = await awardsDataOf(db, tournamentId);
  if (!isDone(data.status, data.games ?? [])) throw new HttpError(409, "Voting opens once the last match is played.");
  if (closed) throw new HttpError(409, CLOSED);
  if (!playersOf(data).includes(voter)) throw new HttpError(403, "Only those who played vote.");
  const mine = new Map(
    (
      await all<{ award: string; id: number }>(
        db,
        `SELECT award, candidate_member_id id FROM tournament_award_votes WHERE tournament_id = ? AND voter_member_id = ?`,
        [tournamentId, voter],
      )
    ).map((v) => [v.award, v.id]),
  );
  const votes = list.map((v: Record<string, unknown>) => {
    const name = text(v, "award", { max: 40 });
    const award = awards.find((a) => a.name === name);
    if (!award || decidedByOf(award).kind !== "vote") throw new HttpError(400, `"${name}" isn't voted for.`);
    if (!votersOf(award, data, ctx).includes(voter)) throw new HttpError(403, `Only the skaters vote for ${name}.`);
    const memberId = int(v, "memberId");
    if (memberId === voter) throw new HttpError(400, "Not for yourself. Nice try.");
    if (!candidatesOf(award, data, ctx, voter).includes(memberId))
      throw new HttpError(400, `They can't be voted for ${name}.`);
    const was = mine.get(name);
    if (was !== undefined && was !== memberId) throw new HttpError(409, `You've voted for ${name} already: one each.`);
    return { name, memberId };
  });
  const cast = await batch(
    db,
    votes.map((v) =>
      statement(
        db,
        `INSERT INTO tournament_award_votes (tournament_id, award, voter_member_id, candidate_member_id, cast_at)
         SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tournaments t
           WHERE t.id = ? AND t.awards_confirmed_at IS NULL AND ${DONE})
         ON CONFLICT DO NOTHING`,
        [tournamentId, v.name, voter, v.memberId, now, tournamentId],
      ),
    ),
  );
  // Nothing went in that wasn't in already: closed as it landed, or cast already
  const missed = votes.filter((v, i) => !cast[i].meta.changes && mine.get(v.name) !== v.memberId);
  if (missed.length) {
    const ins = await all<{ award: string; id: number }>(
      db,
      "SELECT award, candidate_member_id id FROM tournament_award_votes WHERE tournament_id = ? AND voter_member_id = ?",
      [tournamentId, voter],
    );
    const refused = missed.filter((v) => ins.find((x) => x.award === v.name)?.id !== v.memberId);
    if (refused.length) throw new HttpError(409, CLOSED);
  }
}

/** On the record, as a reveal leaves it (ADR 0074): how many are out, and the one that just came out. */
export async function revealedSubject(db: D1Database, tournamentId: number) {
  const t = await first<{ id: number; name: string; revealed: number; awards: string }>(
    db,
    "SELECT id, name, awards_revealed revealed, awards FROM tournaments WHERE id = ?",
    [tournamentId],
  );
  if (!t) return null;
  const given = await all<{ award: string }>(
    db,
    "SELECT DISTINCT award FROM tournament_award_winners WHERE tournament_id = ?",
    [tournamentId],
  );
  const out = awardsToReveal(
    parseAwards(t.awards),
    given.map((g) => g.award),
  );
  return {
    id: t.id,
    name: t.name,
    revealed: t.revealed,
    award: t.revealed > 0 ? (out[t.revealed - 1]?.name ?? null) : null,
  };
}
