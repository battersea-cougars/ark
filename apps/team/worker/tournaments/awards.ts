// Who won a tournament's awards (ADR 0044). The awards themselves are the tournament's (copied from its series, ADR
// 0044, 0049); this is who took each one home: a team (Champions) or a player on one of its teams (Top scorer, Best
// goalie). An admin sets the whole list at once, on the tournament's page; everyone sees it with the tournament. At
// the after-party (ADR 0074) whoever runs it reveals them one at a time, in the order listed.
import { all, batch, first, run, statement } from "@cougars/shared/d1";
import { isDone } from "@cougars/shared/results";
import { HttpError, int, text } from "../api/api.http";

export interface Winner {
  award: string;
  teamId: number | null;
  memberId: number | null;
}

/** { winners: [{ award, teamId } | { award, memberId }] }: the whole list, replacing what was there. */
export async function setWinners(db: D1Database, tournamentId: number, o: Record<string, unknown>) {
  const list = o.winners;
  if (!Array.isArray(list)) throw new HttpError(400, "winners should be a list.");
  const t = await all<{ awards: string }>(db, "SELECT awards FROM tournaments WHERE id = ?", [tournamentId]);
  if (!t.length) throw new HttpError(404, "No such tournament.");
  const awards = new Set((JSON.parse(t[0].awards || "[]") as { name: string }[]).map((a) => a.name));
  const teams = new Set(
    (await all<{ id: number }>(db, "SELECT id FROM tournament_teams WHERE tournament_id = ?", [tournamentId])).map(
      (x) => x.id,
    ),
  );
  // Its players: the captains and everyone on a team
  const players = new Set(
    (
      await all<{ id: number }>(
        db,
        `SELECT captain_member_id id FROM tournament_teams WHERE tournament_id = ? AND captain_member_id IS NOT NULL
         UNION SELECT p.member_id FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
         WHERE t.tournament_id = ? AND p.member_id IS NOT NULL`,
        [tournamentId, tournamentId],
      )
    ).map((x) => x.id),
  );
  const winners = list.map((w: Record<string, unknown>) => {
    const award = text(w, "award", { max: 40 });
    if (!awards.has(award)) throw new HttpError(400, `"${award}" isn't one of this tournament's awards.`);
    const teamId = int(w, "teamId", { nullable: true });
    const memberId = int(w, "memberId", { nullable: true });
    if ((teamId === null) === (memberId === null)) throw new HttpError(400, "Each award goes to a team or a player.");
    if (teamId !== null && !teams.has(teamId)) throw new HttpError(400, "That team isn't in this tournament.");
    if (memberId !== null && !players.has(memberId)) throw new HttpError(400, "They didn't play in this tournament.");
    return { award, teamId, memberId };
  });
  await batch(db, [
    statement(db, "DELETE FROM tournament_award_winners WHERE tournament_id = ?", [tournamentId]),
    ...winners.map((w, i) =>
      statement(
        db,
        `INSERT INTO tournament_award_winners (tournament_id, award, team_id, member_id, position) VALUES (?, ?, ?, ?, ?)`,
        [tournamentId, w.award, w.teamId, w.memberId, i],
      ),
    ),
  ]);
}

/**
 * The next award revealed at the after-party (ADR 0074): `next` is its place in the list (0 first), the one the tap saw
 * face down. Only once the last match is played and the awards are confirmed. A second tap on the same one (a double
 * tap, or two phones at once) finds it out already and does nothing; a tap from a page that's fallen behind further is
 * refused. One statement, guarded on the count the tap saw, so two at once reveal one (ADR 0121).
 */
export async function revealAward(db: D1Database, tournamentId: number, o: Record<string, unknown>) {
  const next = int(o, "next", { max: 8 });
  const t = await first<{ status: string; awards: string; revealed: number }>(
    db,
    "SELECT status, awards, awards_revealed revealed FROM tournaments WHERE id = ?",
    [tournamentId],
  );
  if (!t) throw new HttpError(404, "No such tournament.");
  const games = await all<{ status: string }>(db, "SELECT status FROM tournament_games WHERE tournament_id = ?", [
    tournamentId,
  ]);
  if (!isDone(t.status, games)) throw new HttpError(409, "Not till the last match is played.");
  const count = (JSON.parse(t.awards || "[]") as unknown[]).length;
  if (next >= count) throw new HttpError(409, "Every award's out.");
  const confirmed = await first<{ n: number }>(
    db,
    "SELECT COUNT(*) n FROM tournament_award_winners WHERE tournament_id = ?",
    [tournamentId],
  );
  if (!confirmed?.n) throw new HttpError(409, "Confirm the awards first.");
  if (t.revealed > next) return;
  if (t.revealed < next) throw new HttpError(409, "It's moved on since: have another look.");
  await run(
    db,
    `UPDATE tournaments SET awards_revealed = awards_revealed + 1
     WHERE id = ? AND awards_revealed = ? AND awards_revealed < json_array_length(awards)`,
    [tournamentId, next],
  );
}
