// A captains' draft (ADR 0060, after 0052; reset and reopen: 0064, 0066; one goalie a team: 0067). An admin opens it on
// the night, once the captains' pick order is drawn at random (step 1, drawOrder); the captains take turns, in snake order from it,
// picking from the members who said they're in (captains are in automatically and never picked); an admin closes it
// once everyone's picked, or leaving the rest out on purpose, and then the teams are locked. Someone running the draft
// (run:Draft) can pick for the captain on the clock, and undo the last pick.
import { all, batch, first, run, statement } from "@cougars/shared/d1";
import { MIN_TEAM_SIZE, nextSlots, onTheClock, playersNeeded } from "../../src/lib/draft";
import { syncTournament } from "@cougars/shared/agenda";
import { HttpError } from "../api/api.http";
import { clearingFixtures, fixturesCanBeMade, makeFixtures } from "./fixtures";
import { STARTED } from "./started";
import { can, type Action } from "../../src/access/actions";

interface DraftTeam {
  id: number;
  captain: number | null;
}

async function tournamentOf(db: D1Database, tournamentId: number) {
  const t = await first<{ kind: string; state: string }>(
    db,
    "SELECT kind, draft_state state FROM tournaments WHERE id = ?",
    [tournamentId],
  );
  if (!t) throw new HttpError(404, "No such tournament.");
  if (t.kind !== "draft") throw new HttpError(409, "Teams enter this tournament; there's no draft.");
  return t;
}

const teamsOf = (db: D1Database, tournamentId: number) =>
  all<DraftTeam>(
    db,
    "SELECT id, captain_member_id captain FROM tournament_teams WHERE tournament_id = ? ORDER BY pick, id",
    [tournamentId],
  );

/** Picks made so far (the record, and whether a draft has started). */
const PICKS = `SELECT COUNT(*) FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
               WHERE t.tournament_id = ? AND p.pick_number IS NOT NULL`;

/**
 * The slot of the pick to make now (0: round one's first): the first pick number nobody has, less one. The turn
 * follows the numbers, not how many picks there are (#125): a pick that came off leaves its number empty, filled
 * first by the team whose pick it was (lib/draft.ts nextSlots, the same for the page). One param: the tournament.
 */
const NEXT_SLOT = `WITH taken AS (SELECT p.pick_number n FROM tournament_team_players p
                     JOIN tournament_teams t ON t.id = p.team_id
                     WHERE t.tournament_id = ? AND p.pick_number IS NOT NULL)
                   SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM taken WHERE n = 1) THEN 0
                     ELSE (SELECT min(n) FROM taken WHERE n + 1 NOT IN (SELECT n FROM taken)) END`;

/** Members who said they're in, aren't captains and haven't been picked: who's left. */
const POOL = `SELECT e.member_id FROM tournament_entries e
              WHERE e.tournament_id = ? AND e.signup = 'in'
                AND e.member_id NOT IN (SELECT captain_member_id FROM tournament_teams
                                        WHERE tournament_id = ? AND captain_member_id IS NOT NULL)
                AND e.member_id NOT IN (SELECT p.member_id FROM tournament_team_players p
                                        JOIN tournament_teams t ON t.id = p.team_id
                                        WHERE t.tournament_id = ? AND p.member_id IS NOT NULL)`;

/** A whole number from 0 to `below` - 1, every one equally likely (no modulo bias), from the Worker's crypto. */
export function randomBelow(below: number): number {
  const buf = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % below);
  let n: number;
  do n = crypto.getRandomValues(buf)[0];
  while (n >= limit);
  return n % below;
}

/** The same things in a fair random order: a Fisher-Yates shuffle. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Who's left to pick, every goalie first (every team wants one), each lot in a fair random order. */
export const goaliesFirst = <T extends { goalie: number | boolean }>(pool: readonly T[]) => [
  ...shuffled(pool.filter((p) => p.goalie)),
  ...shuffled(pool.filter((p) => !p.goalie)),
];

/** Whether the pick order's been drawn: every captain has their number (the editor undraws it if they change). */
export async function isDrawn(db: D1Database, tournamentId: number) {
  const n = await first<{ teams: number; drawn: number }>(
    db,
    "SELECT COUNT(*) teams, COUNT(pick) drawn FROM tournament_teams WHERE tournament_id = ?",
    [tournamentId],
  );
  return !!n && n.teams > 0 && n.drawn === n.teams;
}

/**
 * Step 1 (ADR 0060): someone running the draft draws the captains' pick order at random, before it opens: the order
 * they were named in means nothing. It's round one's; the snake turns it after. Drawn once: drawing again, opening and
 * reopening keep it, and only a reset (or changing the captains before it opens) takes it away.
 */
export async function drawOrder(db: D1Database, tournamentId: number) {
  await tournamentOf(db, tournamentId);
  const teams = await teamsOf(db, tournamentId);
  if (teams.length < 2) throw new HttpError(409, "A draft needs at least two captains.");
  if (await isDrawn(db, tournamentId)) return;
  // One batch, each number set only while some captain's still without one: a second admin's draw, a moment later,
  // finds them all numbered and changes nothing
  await batch(
    db,
    shuffled(teams).map((team, i) =>
      statement(
        db,
        `UPDATE tournament_teams SET pick = ? WHERE id = ?
         AND (SELECT COUNT(*) FROM tournament_teams WHERE tournament_id = ? AND pick IS NULL) > 0`,
        [i + 1, team.id, tournamentId],
      ),
    ),
  );
}

/** SQL: a match of the tournament has started or has a result (one param: the tournament). */
const PLAYED =
  "SELECT 1 FROM tournament_games WHERE tournament_id = ? AND (home_goals IS NOT NULL OR status <> 'next')";
/** Whether a match of the tournament has started or has a result: then its teams are set. */
const played = (db: D1Database, tournamentId: number) => first(db, PLAYED, [tournamentId]);
const PLAYED_SAID = "A match has started: clear the fixtures to reopen the draft.";

/**
 * Step 2: an admin opens the draft, once the order's drawn: the captains can pick (and each hears it, with their
 * place: push.notices.ts draftOpen). A closed one reopens with its picks and its order, where it left off (0066),
 * keeping its fixtures, which are between the same teams; not once a match has started (reopenDraft clears them).
 */
export async function openDraft(db: D1Database, tournamentId: number) {
  const t = await tournamentOf(db, tournamentId);
  if (t.state === "closed" && (await played(db, tournamentId))) throw new HttpError(409, PLAYED_SAID);
  const captains = (await teamsOf(db, tournamentId)).length;
  if (captains < 2) throw new HttpError(409, "A draft needs at least two captains.");
  if (!(await isDrawn(db, tournamentId))) throw new HttpError(409, "Set the order first.");
  // The first time, only with enough to pick from: every team its captain and two more (a reopened one carries on)
  const picked = await first<{ n: number }>(db, `SELECT (${PICKS}) n`, [tournamentId]);
  if (!picked?.n) {
    const pool = await first<{ n: number }>(db, `SELECT COUNT(*) n FROM (${POOL})`, [
      tournamentId,
      tournamentId,
      tournamentId,
    ]);
    const need = playersNeeded(captains);
    if ((pool?.n ?? 0) < need)
      throw new HttpError(
        409,
        `Not enough players yet: a team's at least ${MIN_TEAM_SIZE}, so the draft needs ${need} signed up for ${captains} captains: ${pool?.n ?? 0} so far.`,
      );
  }
  await run(db, "UPDATE tournaments SET draft_state = 'open' WHERE id = ?", [tournamentId]);
  await syncTournament(db, tournamentId);
}

/** An admin closes the draft: once everyone's picked, or leaving the rest out on purpose. Then it's locked. */
export async function closeDraft(db: D1Database, tournamentId: number, leaveOut: boolean) {
  const t = await tournamentOf(db, tournamentId);
  if (t.state !== "open") throw new HttpError(409, "The draft isn't open.");
  const left = await first<{ n: number }>(db, `SELECT COUNT(*) n FROM (${POOL})`, [
    tournamentId,
    tournamentId,
    tournamentId,
  ]);
  if (left?.n && !leaveOut)
    throw new HttpError(409, `${left.n} still to pick. Pick them, or close it leaving them out.`);
  await run(db, "UPDATE tournaments SET draft_state = 'closed' WHERE id = ?", [tournamentId]);
  // Its draft night leaves the agenda
  await syncTournament(db, tournamentId);
}

/**
 * Whoever runs the draft reopens a closed one (Reopen, ADR 0060), saying what becomes of the fixtures: kept (they're
 * between the same teams), only while no match has started; or cleared, matches, results and goals, which needs
 * someone who edits the tournament (checked by the route). One batch: the clear and the reopen run only while it's
 * still closed, and keeping only while nothing's been played, so a double tap reopens and clears once, and a result
 * landing between the check and the batch isn't left behind (ADR 0121). The picks and the order stay.
 */
export async function reopenDraft(db: D1Database, tournamentId: number, fixtures: "keep" | "clear") {
  const t = await tournamentOf(db, tournamentId);
  if (t.state !== "closed")
    throw new HttpError(409, t.state === "open" ? "The draft is open already." : "The draft isn't closed.");
  if (fixtures === "keep" && (await played(db, tournamentId))) throw new HttpError(409, PLAYED_SAID);
  const reopen = "UPDATE tournaments SET draft_state = 'open' WHERE id = ? AND draft_state = 'closed'";
  const results = await batch(
    db,
    fixtures === "clear"
      ? [
          ...clearingFixtures(db, tournamentId, "(SELECT draft_state FROM tournaments WHERE id = ?) = 'closed'", [
            tournamentId,
          ]),
          statement(db, reopen, [tournamentId]),
        ]
      : [statement(db, `${reopen} AND NOT EXISTS (${PLAYED})`, [tournamentId, tournamentId])],
  );
  if (!results.at(-1)?.meta.changes) {
    if (fixtures === "keep" && (await played(db, tournamentId))) throw new HttpError(409, PLAYED_SAID);
    throw new HttpError(409, "The draft is open already.");
  }
  // Its draft night comes back to the agenda
  await syncTournament(db, tournamentId);
}

/**
 * Everyone's picked (or the rest are left out on purpose): one tap closes the draft and makes the fixtures (ADR 0060,
 * 0061). Checked first, so a refusal changes nothing: the players left, and that the fixtures can be made (enough teams
 * for the playoffs). Then the close is the claim (ADR 0121): only the request that turns it from open to closed makes
 * the fixtures, so two taps at once close it once and make one set; the other is refused. Fixtures already made (before
 * the draft, or before a reopen) are kept: they're between the same teams. Should making them fail after the close,
 * the draft goes back to open, as it was.
 */
export async function finishDraft(db: D1Database, tournamentId: number, leaveOut: boolean) {
  const t = await tournamentOf(db, tournamentId);
  if (t.state !== "open")
    throw new HttpError(409, t.state === "closed" ? "The draft is closed." : "The draft isn't open.");
  const left = await first<{ n: number }>(db, `SELECT COUNT(*) n FROM (${POOL})`, [
    tournamentId,
    tournamentId,
    tournamentId,
  ]);
  if (left?.n && !leaveOut)
    throw new HttpError(409, `${left.n} still to pick. Pick them, or close it leaving them out.`);
  const games = await first(db, "SELECT 1 FROM tournament_games WHERE tournament_id = ?", [tournamentId]);
  if (!games) await fixturesCanBeMade(db, tournamentId);
  const res = await run(db, "UPDATE tournaments SET draft_state = 'closed' WHERE id = ? AND draft_state = 'open'", [
    tournamentId,
  ]);
  if (!res.meta.changes) throw new HttpError(409, "The draft is closed.");
  if (!games)
    try {
      await makeFixtures(db, tournamentId);
    } catch (e) {
      await run(db, "UPDATE tournaments SET draft_state = 'open' WHERE id = ?", [tournamentId]);
      throw e;
    }
  // Its draft night leaves the agenda
  await syncTournament(db, tournamentId);
}

/**
 * Someone running the draft starts it again: every pick comes off, the pick order with them, and it's back to not yet
 * open. The sign-ups, captains and fixtures stay: the teams are the same teams, only their players change (0066).
 */
export async function resetDraft(db: D1Database, tournamentId: number) {
  await tournamentOf(db, tournamentId);
  await run(
    db,
    "DELETE FROM tournament_team_players WHERE team_id IN (SELECT id FROM tournament_teams WHERE tournament_id = ?)",
    [tournamentId],
  );
  await run(db, "UPDATE tournaments SET draft_state = 'none' WHERE id = ?", [tournamentId]);
  // And its pick order: it's drawn again before it next opens
  await run(db, "UPDATE tournament_teams SET pick = NULL WHERE tournament_id = ?", [tournamentId]);
  // Its draft night comes back to the agenda
  await syncTournament(db, tournamentId);
}

/**
 * SQL: the member isn't a goalie joining a team that has one (its captain or a player). Inside the statement that puts
 * them on, so a pick and an admin's edit landing together can't give a team two. Params: member, member, team, team.
 */
const NOT_A_SECOND_GOALIE = `NOT (EXISTS (SELECT 1 FROM members WHERE id = ? AND position = 'G') AND EXISTS (
    SELECT 1 FROM members m WHERE m.position = 'G' AND m.id <> ? AND (
      m.id = (SELECT captain_member_id FROM tournament_teams WHERE id = ?)
      OR m.id IN (SELECT member_id FROM tournament_team_players WHERE team_id = ?))))`;

/**
 * One goalie a team (ADR 0060): a goalie can't join a team that has one, its captain or a player. Refused for a pick,
 * whoever makes it, and for an admin's team edit. Checked first for the words; the statements keep to it too
 * (NOT_A_SECOND_GOALIE).
 */
async function oneGoalie(db: D1Database, teamId: number, memberId: number) {
  const keeper = await first(db, "SELECT 1 FROM members WHERE id = ? AND position = 'G'", [memberId]);
  if (!keeper) return;
  const has = await first(
    db,
    `SELECT 1 FROM members m WHERE m.position = 'G' AND m.id <> ? AND (
       m.id = (SELECT captain_member_id FROM tournament_teams WHERE id = ?)
       OR m.id IN (SELECT member_id FROM tournament_team_players WHERE team_id = ?))`,
    [memberId, teamId, teamId],
  );
  if (has) throw new HttpError(409, "They've got a goalie already.");
}

/**
 * The captain on the clock (or someone running the draft) picks a member who said they're in. The turn follows the
 * pick numbers (NEXT_SLOT, #125). `turn`, when the app sends it, is the slot it saw on the clock (with no picks taken
 * off, how many picks it had seen): a pick is for that turn and no other, so a tap that lands after the turn moved on
 * (a second phone, a slow network, the captain whose snake turn comes twice running) is refused, not spent on their
 * next pick. Without it, the turn is whatever it is when the pick lands.
 */
export async function pick(
  db: D1Database,
  tournamentId: number,
  memberId: number,
  by: { memberId: number; actions: Set<Action> },
  turn?: number,
) {
  const t = await tournamentOf(db, tournamentId);
  if (t.state !== "open")
    throw new HttpError(409, t.state === "closed" ? "The draft is closed." : "The draft isn't open yet.");
  const teams = await teamsOf(db, tournamentId);
  const slot = (await first<{ n: number }>(db, `SELECT (${NEXT_SLOT}) n`, [tournamentId]))?.n ?? 0;
  if (turn !== undefined && turn !== slot) throw new HttpError(409, "Someone just picked: have another look.");
  const team = teams[onTheClock(teams.length, slot)];
  const running = can(by.actions, "run:Draft");
  if (!running && !teams.some((x) => x.captain === by.memberId)) throw new HttpError(403, "Only the captains pick.");
  if (!running && team.captain !== by.memberId) throw new HttpError(409, "It's not your pick.");
  await oneGoalie(db, team.id, memberId);
  // One statement, so two captains tapping at once can't both pick: it only goes in if they're still in the pool
  // and the pick on the clock is still this one (no other has landed, or come off, since). It takes that pick's number
  const res = await run(
    db,
    `INSERT INTO tournament_team_players (team_id, member_id, name, position, pick_number, picked_by)
     SELECT ?, ?, '', (SELECT COUNT(*) FROM tournament_team_players WHERE team_id = ?), ?, ?
     WHERE ? IN (${POOL}) AND (${NEXT_SLOT}) = ? AND ${NOT_A_SECOND_GOALIE}`,
    [
      team.id,
      memberId,
      team.id,
      slot + 1,
      // Who picked: the captain, or whoever runs the draft picking for them, which the app and the record say
      by.memberId,
      memberId,
      tournamentId,
      tournamentId,
      tournamentId,
      tournamentId,
      slot,
      memberId,
      memberId,
      team.id,
      team.id,
    ],
  );
  if (!res.meta.changes) {
    // A goalie landed on the team just before: say so
    await oneGoalie(db, team.id, memberId);
    throw new HttpError(409, "They can't be picked: not signed up, a captain, already picked, or someone just picked.");
  }
}

/** Someone running the draft takes back the last pick. */
export async function undoPick(db: D1Database, tournamentId: number) {
  const t = await tournamentOf(db, tournamentId);
  if (t.state !== "open") throw new HttpError(409, "The draft isn't open.");
  const res = await run(
    db,
    `DELETE FROM tournament_team_players WHERE id = (
       SELECT p.id FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
       WHERE t.tournament_id = ? AND p.pick_number IS NOT NULL ORDER BY p.pick_number DESC LIMIT 1)`,
    [tournamentId],
  );
  if (!res.meta.changes) throw new HttpError(409, "Nobody's been picked yet.");
}

/**
 * Someone comes out of a drafted tournament (entries.ts). A member saying they're out: while the draft is open, a pick
 * comes off their team; once it's closed, or for a captain, it goes through an admin. An admin taking them off
 * (`byAdmin`) takes them off their team whenever; a captain still comes off in the tournament's settings. Checks, then
 * gives the statement that takes them off their team, for the same batch as their answer: a pick landing between the
 * two would leave them on a team they've said no to. A member's own, only while it hasn't started (started.ts), as
 * their answer is.
 */
export async function leaveDraft(
  db: D1Database,
  tournamentId: number,
  memberId: number,
  byAdmin = false,
): Promise<D1PreparedStatement[]> {
  const t = await first<{ kind: string; state: string }>(
    db,
    "SELECT kind, draft_state state FROM tournaments WHERE id = ?",
    [tournamentId],
  );
  if (t?.kind !== "draft") return [];
  const captain = await first(db, "SELECT 1 FROM tournament_teams WHERE tournament_id = ? AND captain_member_id = ?", [
    tournamentId,
    memberId,
  ]);
  if (captain)
    throw new HttpError(
      409,
      byAdmin
        ? "That's a captain: change the captains in the tournament's settings."
        : "You're a captain: ask an admin to take you off.",
    );
  if (t.state === "closed" && !byAdmin) {
    const picked = await first(
      db,
      `SELECT 1 FROM tournament_team_players p JOIN tournament_teams tt ON tt.id = p.team_id
       WHERE tt.tournament_id = ? AND p.member_id = ?`,
      [tournamentId, memberId],
    );
    if (picked) throw new HttpError(409, "You're on a team now: ask an admin to take you off.");
  }
  return [
    statement(
      db,
      `DELETE FROM tournament_team_players WHERE member_id = ?
       AND team_id IN (SELECT id FROM tournament_teams WHERE tournament_id = ?)${byAdmin ? "" : ` AND NOT ${STARTED}`}`,
      byAdmin ? [memberId, tournamentId] : [memberId, tournamentId, tournamentId],
    ),
  ];
}

/** An admin puts someone in a drafted tournament: not once the draft's closed (reopen it first). */
export async function joinDraft(db: D1Database, tournamentId: number) {
  const t = await first<{ kind: string; state: string }>(
    db,
    "SELECT kind, draft_state state FROM tournaments WHERE id = ?",
    [tournamentId],
  );
  if (t?.kind === "draft" && t.state === "closed")
    throw new HttpError(409, "The draft's closed: reopen it to add someone.");
}

/** A team of this tournament, or 404. */
async function teamOf(db: D1Database, tournamentId: number, teamId: number) {
  const team = await first<DraftTeam>(
    db,
    "SELECT id, captain_member_id captain FROM tournament_teams WHERE id = ? AND tournament_id = ?",
    [teamId, tournamentId],
  );
  if (!team) throw new HttpError(404, "No such team.");
  return team;
}

/**
 * An admin puts a member on a team directly, outside the draft: a replacement when someone drops out. From another
 * team they move (their pick number goes with them, so the draft's turn doesn't shift); not signed up, they're put in.
 * A captain stays on their own team.
 */
export async function putOnTeam(db: D1Database, tournamentId: number, teamId: number, memberId: number, now: string) {
  await teamOf(db, tournamentId, teamId);
  const captain = await first(db, "SELECT 1 FROM tournament_teams WHERE tournament_id = ? AND captain_member_id = ?", [
    tournamentId,
    memberId,
  ]);
  if (captain) throw new HttpError(409, "That's a captain: they stay on their own team.");
  await oneGoalie(db, teamId, memberId);
  const on = await first<{ id: number; team: number }>(
    db,
    `SELECT p.id, p.team_id team FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
     WHERE t.tournament_id = ? AND p.member_id = ?`,
    [tournamentId, memberId],
  );
  if (on?.team === teamId) return;
  const position = `(SELECT COUNT(*) FROM tournament_team_players WHERE team_id = ?)`;
  const guard = [memberId, memberId, teamId, teamId];
  const res = on
    ? await run(
        db,
        `UPDATE tournament_team_players SET team_id = ?, position = ${position} WHERE id = ? AND ${NOT_A_SECOND_GOALIE}`,
        [teamId, teamId, on.id, ...guard],
      )
    : await run(
        db,
        `INSERT INTO tournament_team_players (team_id, member_id, name, position)
         SELECT ?, ?, '', ${position} WHERE ${NOT_A_SECOND_GOALIE}`,
        [teamId, memberId, teamId, ...guard],
      );
  // A goalie picked onto the team just before
  if (!res.meta.changes) throw new HttpError(409, "They've got a goalie already.");
  // On a team means in the tournament
  await run(
    db,
    `INSERT INTO tournament_entries (tournament_id, member_id, signup, signed_up_at) VALUES (?, ?, 'in', ?)
     ON CONFLICT (tournament_id, member_id) DO UPDATE SET signup = 'in'`,
    [tournamentId, memberId, now],
  );
}

/** An admin takes a member off a team. They stay signed up, back in the pool. */
export async function takeOffTeam(db: D1Database, tournamentId: number, teamId: number, memberId: number) {
  await teamOf(db, tournamentId, teamId);
  await run(db, "DELETE FROM tournament_team_players WHERE team_id = ? AND member_id = ?", [teamId, memberId]);
}

/**
 * The latest pick someone made for a captain (ADR 0060): whoever runs the draft picking for the team on the clock. The
 * record's subject, so a pick for someone else goes on it, naming both, and a captain's own doesn't.
 */
export const lastPickedFor = (db: D1Database, tournamentId: number) =>
  first(
    db,
    `SELECT p.pick_number pick, p.member_id memberId, m.name player, t.id teamId, t.captain_member_id captainMemberId,
            c.name captain, p.picked_by pickedBy
     FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
     LEFT JOIN members m ON m.id = p.member_id LEFT JOIN members c ON c.id = t.captain_member_id
     WHERE t.tournament_id = ? AND p.pick_number IS NOT NULL AND p.picked_by IS NOT t.captain_member_id
     ORDER BY p.pick_number DESC LIMIT 1`,
    [tournamentId],
  );

/** How far a draft has got: its state and picks made (the record, ADR 0095). */
export const draftProgress = (db: D1Database, tournamentId: number) =>
  first<{ state: string; picks: number }>(
    db,
    `SELECT draft_state state, (${PICKS}) picks FROM tournaments WHERE id = ?`,
    [tournamentId, tournamentId],
  );

/**
 * Teams set, the rest at random (Move to…, ADR 0074): an admin moves the draft on to Teams set, and everyone still to
 * pick is chosen at random for the team on the clock, in snake order from the drawn order, as the simulator picks (ADR
 * 0123): a goalie first while there's one and the team has none, never a second goalie (one a team, ADR 0067); the
 * captains are on their teams already. Someone no team can take (a goalie too many) is left out. Then the draft's closed.
 * One batch: the draft opened if it wasn't, each pick only while that member's still in the pool and that pick still the
 * one on the clock (draft.ts pick's own guards), and the close only while it's open, so a second admin a moment later
 * changes nothing and is refused (ADR 0121). Each pick names the admin (`by`) as who picked. How many were chosen, and
 * how many left out.
 */
export async function setTeamsAtRandom(db: D1Database, tournamentId: number, by: number) {
  const t = await tournamentOf(db, tournamentId);
  if (t.state === "closed") throw new HttpError(409, "The draft is closed.");
  const [teams, taken, pool] = await Promise.all([
    all<{ id: number; goalie: number }>(
      db,
      `SELECT t.id, EXISTS (SELECT 1 FROM members m WHERE m.position = 'G' AND (m.id = t.captain_member_id
         OR m.id IN (SELECT member_id FROM tournament_team_players WHERE team_id = t.id))) goalie
       FROM tournament_teams t WHERE t.tournament_id = ? ORDER BY t.pick, t.id`,
      [tournamentId],
    ),
    all<{ n: number }>(
      db,
      `SELECT p.pick_number n FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
       WHERE t.tournament_id = ? AND p.pick_number IS NOT NULL`,
      [tournamentId],
    ),
    all<{ id: number; goalie: number }>(
      db,
      `SELECT e.member_id id, EXISTS (SELECT 1 FROM members m WHERE m.id = e.member_id AND m.position = 'G') goalie
       FROM (${POOL}) e ORDER BY e.member_id`,
      [tournamentId, tournamentId, tournamentId],
    ),
  ]);
  if (teams.length < 2) throw new HttpError(409, "A draft needs at least two captains.");
  const numbers = new Set(taken.map((x) => x.n));
  const left = [...pool];
  const picks: D1PreparedStatement[] = [];
  while (left.length) {
    const [slot] = nextSlots(numbers, 1);
    const team = teams[onTheClock(teams.length, slot)];
    const chosen = goaliesFirst(left).find((p) => !(p.goalie && team.goalie));
    // The team on the clock can take nobody left (goalies, and it has one): the rest are left out
    if (!chosen) break;
    picks.push(
      statement(
        db,
        `INSERT INTO tournament_team_players (team_id, member_id, name, position, pick_number, picked_by)
         SELECT ?, ?, '', (SELECT COUNT(*) FROM tournament_team_players WHERE team_id = ?), ?, ?
         WHERE ? IN (${POOL}) AND (${NEXT_SLOT}) = ? AND ${NOT_A_SECOND_GOALIE}`,
        [
          team.id,
          chosen.id,
          team.id,
          slot + 1,
          by,
          chosen.id,
          tournamentId,
          tournamentId,
          tournamentId,
          tournamentId,
          slot,
          chosen.id,
          chosen.id,
          team.id,
          team.id,
        ],
      ),
    );
    numbers.add(slot + 1);
    if (chosen.goalie) team.goalie = 1;
    left.splice(left.indexOf(chosen), 1);
  }
  const results = await batch(db, [
    statement(db, "UPDATE tournaments SET draft_state = 'open' WHERE id = ? AND draft_state = 'none'", [tournamentId]),
    ...picks,
    statement(db, "UPDATE tournaments SET draft_state = 'closed' WHERE id = ? AND draft_state = 'open'", [
      tournamentId,
    ]),
  ]);
  if (!results.at(-1)?.meta.changes) throw new HttpError(409, "It's moved on since: have another look.");
  // Its draft night leaves the agenda
  await syncTournament(db, tournamentId);
  return { chosen: picks.length, leftOut: left.length };
}
