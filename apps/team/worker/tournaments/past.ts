// A past one recorded (ADR 0126): the club played Kumites before the app, and an admin puts one in after the fact, in
// one go: when it was (a day gone by), its teams (names, captains, players, all members), its matches with their
// scores (a final among them, if there was one) and, if anyone remembers, who scored, and who won each award. It goes
// in done, its awards confirmed and every one revealed, so it's history at once (Past Kumites): no after-party, no
// sign-up, no fees (it was paid for then). Its results are typed in (no kick-off), so it's played on its own day
// (lib/edition.ts playedOn); a goal with nobody said counts in the score only, a named scorer in the all-time leaders.
import { batch, first, statement } from "@cougars/shared/d1";
import { awardsToReveal, decidedByOf } from "../../src/lib/awards";
import { HttpError, date, int, objectsIn, text } from "../api/api.http";
import { createTournament, parseAwards } from "./tournaments";

/** A team as it played: its name, its captain and its players, all members. */
interface PastTeam {
  name: string;
  captainMemberId: number;
  players: number[];
}

/** A match as it ended: its teams (by their place in `teams`), the score, and who scored, where anyone said. */
interface PastGame {
  home: number;
  away: number;
  homeGoals: number;
  awayGoals: number;
  /** The final (a playoff): it can't end level, and its winner is the champions. */
  final: boolean;
  /** Who scored each side's goals, in any order: a member, or null where nobody remembers. */
  scorers: { home: (number | null)[]; away: (number | null)[] };
}

/** Who won an award: a team (by its place in `teams`) or a member who played; a judges' call with its name. */
interface PastWinner {
  award: string;
  team: number | null;
  memberId: number | null;
  title: string | null;
}

const listOf = (o: Record<string, unknown>, key: string, most: number) => {
  const v = o[key] ?? [];
  if (!Array.isArray(v) || v.length > most) throw new HttpError(400, `${key} should be a list of up to ${most}.`);
  return objectsIn(v, key);
};

function teamsIn(o: Record<string, unknown>): PastTeam[] {
  const teams = listOf(o, "teams", 16).map((t) => ({
    name: text(t, "name", { optional: true, max: 40 }).trim(),
    captainMemberId: int(t, "captainMemberId", { min: 1 }),
    players: (Array.isArray(t.players) ? t.players : []).map((p) => int({ p }, "p", { min: 1 })),
  }));
  if (teams.length < 2) throw new HttpError(400, "Two teams at least.");
  if (teams.some((t) => t.players.length > 30)) throw new HttpError(400, "Up to 30 players a team.");
  const everyone = teams.flatMap((t) => [t.captainMemberId, ...t.players]);
  if (new Set(everyone).size !== everyone.length) throw new HttpError(400, "Someone is on two teams.");
  return teams;
}

function gamesIn(o: Record<string, unknown>, teams: PastTeam[]): PastGame[] {
  const games = listOf(o, "games", 120).map((g): PastGame => {
    const home = int(g, "home", { max: teams.length - 1 });
    const away = int(g, "away", { max: teams.length - 1 });
    if (home === away) throw new HttpError(400, "A match is between two teams.");
    const homeGoals = int(g, "homeGoals", { max: 99 });
    const awayGoals = int(g, "awayGoals", { max: 99 });
    const final = g.final === true;
    if (final && homeGoals === awayGoals) throw new HttpError(400, "A final can't end level: the next goal won it.");
    const said = (g.scorers ?? {}) as Record<string, unknown>;
    const side = (key: "home" | "away", team: number, goals: number) => {
      const list = Array.isArray(said[key]) ? (said[key] as unknown[]) : [];
      if (list.length > goals) throw new HttpError(400, "More scorers than goals.");
      const on = new Set([teams[team].captainMemberId, ...teams[team].players]);
      return list.map((m) => {
        if (m == null) return null;
        const id = int({ m }, "m", { min: 1 });
        if (!on.has(id)) throw new HttpError(400, "A scorer plays for the team they scored for.");
        return id;
      });
    };
    return {
      home,
      away,
      homeGoals,
      awayGoals,
      final,
      scorers: { home: side("home", home, homeGoals), away: side("away", away, awayGoals) },
    };
  });
  // The final's last, as the evening ran: the champions are its winners
  const finals = games.filter((g) => g.final).length;
  if (finals > 1) throw new HttpError(400, "One final.");
  if (finals && !games.at(-1)!.final) throw new HttpError(400, "The final's the last match.");
  return games;
}

function winnersIn(o: Record<string, unknown>, teams: PastTeam[], awards: ReturnType<typeof parseAwards>) {
  const played = new Set(teams.flatMap((t) => [t.captainMemberId, ...t.players]));
  const winners = listOf(o, "winners", 40).map((w): PastWinner => {
    const name = text(w, "award", { max: 40 });
    const award = awards.find((a) => a.name === name);
    if (!award) throw new HttpError(400, `"${name}" isn't one of its awards.`);
    const team = int(w, "team", { max: teams.length - 1, nullable: true });
    const memberId = int(w, "memberId", { min: 1, nullable: true });
    if ((team === null) === (memberId === null)) throw new HttpError(400, "Each award goes to a team or a player.");
    if (memberId !== null && !played.has(memberId)) throw new HttpError(400, "They didn't play in it.");
    const live = decidedByOf(award).kind === "live";
    if (live && memberId === null) throw new HttpError(400, "The judges' call goes to a player.");
    return { award: name, team, memberId, title: live ? text(w, "title", { optional: true, max: 40 }) || null : null };
  });
  // The judges' call is one name and one player; any other award may be shared (joint winners)
  for (const a of awards)
    if (decidedByOf(a).kind === "live" && winners.filter((w) => w.award === a.name).length > 1)
      throw new HttpError(400, `${a.name} goes to one player.`);
  return winners;
}

/** What's asked, checked whole before anything's written: its series, day, teams, matches and winners. */
async function pastIn(db: D1Database, o: Record<string, unknown>, today: string) {
  const typeId = int(o, "typeId", { min: 1 });
  const heldOn = date(o, "heldOn")!;
  if (heldOn >= today) throw new HttpError(400, "That's not a day gone by: a Kumite still to come is scheduled.");
  const series = await first<{ name: string; awards: string }>(
    db,
    "SELECT name, awards FROM tournament_types WHERE id = ?",
    [typeId],
  );
  if (!series) throw new HttpError(400, "No such tournament series.");
  const teams = teamsIn(o);
  const games = gamesIn(o, teams);
  const awards = parseAwards(series.awards);
  const winners = winnersIn(o, teams, awards);
  const members = [...new Set(teams.flatMap((t) => [t.captainMemberId, ...t.players]))];
  const known = await first<{ n: number }>(
    db,
    "SELECT count(*) n FROM members WHERE id IN (SELECT value FROM json_each(?))",
    [JSON.stringify(members)],
  );
  if (known?.n !== members.length) throw new HttpError(400, "No such member.");
  const name = text(o, "name", { optional: true, max: 80 }).trim() || series.name;
  return { typeId, name, heldOn, teams, games, awards, winners, members };
}
type Past = Awaited<ReturnType<typeof pastIn>>;

/**
 * An admin records a past one (ADR 0126): `{ typeId, name, heldOn, teams, games, winners }`, `heldOn` before today.
 * Checked whole before anything's written; then made as any is (createTournament: its series' rules and awards, its
 * teams and captains), and the rest in one batch (filling).
 */
export async function recordPast(db: D1Database, o: Record<string, unknown>, today: string, now: string) {
  const past = await pastIn(db, o, today);
  const { id } = await createTournament(db, {
    typeId: past.typeId,
    name: past.name,
    heldOn: past.heldOn,
    // Over: every match played, whatever's been typed in
    status: "finished",
    // Paid for at the time, before the app: nobody owes for it now
    feePence: 0,
    teams: past.teams.map((t) => ({ name: t.name, captainMemberId: t.captainMemberId, players: [] })),
  });
  // Its teams, in the order they were named (ids only go up)
  const ids = (
    await batch(db, [statement(db, "SELECT id FROM tournament_teams WHERE tournament_id = ? ORDER BY id", [id])])
  )[0].results.map((r) => (r as { id: number }).id);
  if (ids.length !== past.teams.length) throw new HttpError(500, "Its teams didn't all go in.");
  await batch(db, filling(db, id, ids, past, now));
  return { id };
}

/** Each match, its goals, each award's winners and each team's players, as rows for json_each, by the teams' ids. */
function rowsOf(ids: number[], { games, winners, teams }: Past) {
  const groups = games.filter((g) => !g.final).length;
  const gameRows = games.map((g, i) => [
    g.final ? "playoff" : "group",
    g.final ? groups + 1 : i + 1,
    i + 1,
    g.final ? "Final" : "",
    ids[g.home],
    ids[g.away],
    g.homeGoals,
    g.awayGoals,
  ]);
  // Every goal, by its match's place: a scorer where said, the rest nobody-said-who, none timed
  const goalRows = games.flatMap((g, i) =>
    (
      [
        [g.home, g.homeGoals, g.scorers.home],
        [g.away, g.awayGoals, g.scorers.away],
      ] as const
    ).flatMap(([team, n, scorers]) => Array.from({ length: n }, (_, k) => [i + 1, ids[team], scorers[k] ?? null])),
  );
  const kept = new Map<string, number>();
  const winnerRows = winners.map((w) => {
    const position = kept.get(w.award) ?? 0;
    kept.set(w.award, position + 1);
    return [w.award, w.team === null ? null : ids[w.team], w.memberId, position, w.title];
  });
  const playerRows = teams.flatMap((t, i) => t.players.map((m, position) => [ids[i], m, position]));
  return { gameRows, goalRows, winnerRows, playerRows };
}

/**
 * The rest of it, as one batch's statements: the draft's order (as named) and close, the players and their sign-ups,
 * every match done with its goals, the winners, the awards confirmed and all revealed.
 */
function filling(db: D1Database, id: number, ids: number[], past: Past, now: string) {
  const { gameRows, goalRows, winnerRows, playerRows } = rowsOf(ids, past);
  const revealed = awardsToReveal(past.awards, [...new Set(past.winners.map((w) => w.award))]).length;
  return [
    // A draft's order as the teams were named; then it's closed
    statement(
      db,
      `UPDATE tournament_teams SET pick = (SELECT key + 1 FROM json_each(?) WHERE value = tournament_teams.id)
       WHERE tournament_id = ? AND (SELECT kind FROM tournaments WHERE id = ?) = 'draft'`,
      [JSON.stringify(ids), id, id],
    ),
    statement(
      db,
      `INSERT INTO tournament_team_players (team_id, member_id, name, position)
       SELECT value ->> 0, value ->> 1, '', value ->> 2 FROM json_each(?) ORDER BY key`,
      [JSON.stringify(playerRows)],
    ),
    // Everyone who played was in
    statement(
      db,
      `INSERT INTO tournament_entries (tournament_id, member_id, signup, signed_up_at)
       SELECT ?, value, 'in', ? FROM json_each(?) WHERE true
       ON CONFLICT (tournament_id, member_id) DO UPDATE SET signup = 'in', signed_up_at = excluded.signed_up_at`,
      [id, `${past.heldOn}T12:00:00.000Z`, JSON.stringify(past.members)],
    ),
    statement(
      db,
      `INSERT INTO tournament_games (tournament_id, stage, round, position, name, home_team_id, away_team_id,
         home_goals, away_goals, status)
       SELECT ?, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6,
         value ->> 7, 'done'
       FROM json_each(?) ORDER BY key`,
      [id, JSON.stringify(gameRows)],
    ),
    statement(
      db,
      `INSERT INTO tournament_goals (game_id, team_id, scorer_member_id, at_ms, period, created_at)
       SELECT (SELECT id FROM tournament_games WHERE tournament_id = ? AND position = value ->> 0), value ->> 1,
         value ->> 2, NULL, NULL, ?
       FROM json_each(?) ORDER BY key`,
      [id, now, JSON.stringify(goalRows)],
    ),
    statement(
      db,
      `INSERT INTO tournament_award_winners (tournament_id, award, team_id, member_id, position, title)
       SELECT ?, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4 FROM json_each(?) ORDER BY key`,
      [id, JSON.stringify(winnerRows)],
    ),
    // The awards confirmed and every one out: nothing's left for an after-party
    statement(
      db,
      `UPDATE tournaments SET draft_state = CASE WHEN kind = 'draft' THEN 'closed' ELSE draft_state END,
         awards_confirmed_at = ?, awards_revealed = ?, awards_next = 0
       WHERE id = ?`,
      [now, revealed, id],
    ),
  ];
}
