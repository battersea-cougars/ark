// Teams for a session (T3): made in the app (lib/snake.ts), published here, so everyone sees the same ones.
// Publishing replaces whatever was there. Someone who drops out or is taken off comes off their team too
// (entries.ts).
import { all, batch, first, run, statement } from "@cougars/shared/d1";
import { HttpError } from "../api/api.http";

export interface TeamJson {
  name: string;
  players: number[];
}

/** Published teams as read (api.club.ts), in order, by session. */
export function teamsFrom(
  rows: { sessionId: number; teamId: number; name: string; memberId: number | null }[],
): Map<number, TeamJson[]> {
  const out = new Map<number, TeamJson[]>();
  const byTeam = new Map<number, TeamJson>();
  for (const r of rows) {
    let team = byTeam.get(r.teamId);
    if (!team) {
      team = { name: r.name, players: [] };
      byTeam.set(r.teamId, team);
      out.set(r.sessionId, [...(out.get(r.sessionId) ?? []), team]);
    }
    if (r.memberId != null) team.players.push(r.memberId);
  }
  return out;
}

export async function publishTeams(
  db: D1Database,
  sessionId: number,
  o: Record<string, unknown>,
  by: number,
  now: string,
) {
  const teams = o.teams;
  if (!Array.isArray(teams) || !teams.length || teams.length > 8) throw new HttpError(400, "teams should be a list.");
  const seen = new Set<number>();
  const clean = teams.map((t) => {
    const name = typeof t?.name === "string" ? t.name.trim() : "";
    if (!name || name.length > 30) throw new HttpError(400, "Each team needs a name.");
    if (!Array.isArray(t.players) || t.players.some((p: unknown) => !Number.isInteger(p)))
      throw new HttpError(400, `${name}: players should be member ids.`);
    for (const p of t.players as number[]) {
      if (seen.has(p)) throw new HttpError(400, "Someone's on two teams.");
      seen.add(p);
    }
    return { name, players: t.players as number[] };
  });
  const session = await all(db, "SELECT 1 FROM training_sessions WHERE id = ?", [sessionId]);
  if (!session.length) throw new HttpError(404, "No such session.");
  // In one batch. The team just added is the newest: ids only go up (AUTOINCREMENT), and a batch runs in order, alone
  const team = "(SELECT max(id) FROM session_teams WHERE session_id = ?)";
  await batch(db, [
    statement(db, "DELETE FROM session_teams WHERE session_id = ?", [sessionId]),
    ...clean.flatMap((t, i) => [
      statement(
        db,
        "INSERT INTO session_teams (session_id, name, position, published_at, published_by) VALUES (?, ?, ?, ?, ?)",
        [sessionId, t.name, i, now, by],
      ),
      statement(
        db,
        `INSERT INTO session_team_players (team_id, member_id)
         SELECT ${team}, m.id FROM json_each(?) j JOIN members m ON m.id = j.value ORDER BY j.key`,
        [sessionId, JSON.stringify(t.players)],
      ),
    ]),
  ]);
}

/** Off any team for this session: they dropped out or were taken off. A statement, for the batch that takes them off. */
export const offTeams = (db: D1Database, sessionId: number, memberId: number) =>
  statement(
    db,
    `DELETE FROM session_team_players
     WHERE member_id = ? AND team_id IN (SELECT id FROM session_teams WHERE session_id = ?)`,
    [memberId, sessionId],
  );

/** Take a session's teams down: back to before they were made. The sign-ups stay. */
export async function removeTeams(db: D1Database, sessionId: number) {
  await run(db, "DELETE FROM session_teams WHERE session_id = ?", [sessionId]);
}

/** Start a session again: nobody in, waiting or out, and no teams. For a session set up wrong, or a test run. */
export async function resetSession(db: D1Database, sessionId: number) {
  const session = await all(db, "SELECT 1 FROM training_sessions WHERE id = ?", [sessionId]);
  if (!session.length) throw new HttpError(404, "No such session.");
  await batch(db, [
    statement(db, "DELETE FROM session_teams WHERE session_id = ?", [sessionId]),
    statement(db, "DELETE FROM attendance WHERE session_id = ?", [sessionId]),
  ]);
}

/** A session's day and how many said anything: what a reset takes away (the record, ADR 0095). */
export const sessionSignups = (db: D1Database, sessionId: number) =>
  first<{ heldOn: string; signups: number }>(
    db,
    `SELECT held_on heldOn, (SELECT COUNT(*) FROM attendance WHERE session_id = s.id) signups
     FROM training_sessions s WHERE id = ?`,
    [sessionId],
  );
