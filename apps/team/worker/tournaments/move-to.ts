// An admin moves a captains' draft to any of its statuses at once (Move to…, ADR 0074; lib/move-to.ts plans it, the
// same for the app and here). The request says the status the admin's page saw (`from`) and the one to move to (`to`):
// read here from the tournament as it is, and refused (409) if it's moved on since. Back is the steps back
// (step-back.ts) in order, in one batch, each statement only doing anything while it's still at that step; should a
// step find nothing to do, another admin got there first, and it's refused (ADR 0121). Forward is the app's own jobs in
// order, each with its own guards: sign-up closed, the order drawn, the draft opened, or the rest chosen at random and
// the draft closed (draft.ts setTeamsAtRandom), the fixtures made, the day under way, then finished. Checked first, so a
// move that can't be made changes nothing.
import { batch, run, statement } from "@cougars/shared/d1";
import { syncTournament } from "@cougars/shared/agenda";
import { HttpError } from "../api/api.http";
import { londonToday } from "../../src/lib/dates";
import { planMove, statusNow, type MovePlan, type MoveStep, type Moving } from "../../src/lib/move-to";
import { statusList, type Status } from "../../src/lib/tournament-front";
import { BACK_FROM, type BackFrom } from "../../src/lib/step-back";
import { closeSignup } from "./signup";
import { drawOrder, openDraft, setTeamsAtRandom } from "./draft";
import { fixturesCanBeMade, makeFixtures } from "./fixtures";
import { stepsBack } from "./step-back";

const STATUSES: readonly Status[] = statusList({ kind: "draft" });
const MOVED_ON = "It's moved on since: have another look.";

/** The tournament as a move reads it, and what there is to count: for the plan, the check and the record. */
export async function whereItStands(db: D1Database, tournamentId: number, today: string) {
  // One round trip, read together (ADR 0003)
  const [tournament, teamRows, gameRows, tally] = await batch(db, [
    statement(
      db,
      `SELECT name, kind, status, draft_state draftState, held_on heldOn, season, signup_opens_on signupOpensOn,
         signup_closes_on signupClosesOn, signup_closed_at signupClosedAt, awards_revealed awardsRevealed
       FROM tournaments WHERE id = ?`,
      [tournamentId],
    ),
    statement(db, "SELECT pick FROM tournament_teams WHERE tournament_id = ? ORDER BY pick, id", [tournamentId]),
    statement(db, "SELECT status, home_goals homeGoals FROM tournament_games WHERE tournament_id = ?", [tournamentId]),
    statement(
      db,
      `SELECT
         (SELECT COUNT(*) FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
          WHERE t.tournament_id = ?) picks,
         (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = ? AND home_goals IS NOT NULL) results,
         (SELECT COUNT(*) FROM tournament_goals WHERE game_id IN (SELECT id FROM tournament_games WHERE tournament_id = ?)) goals,
         (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = ? AND e.signup = 'in'
            AND e.member_id NOT IN (SELECT captain_member_id FROM tournament_teams
                                    WHERE tournament_id = ? AND captain_member_id IS NOT NULL)
            AND e.member_id NOT IN (SELECT p.member_id FROM tournament_team_players p
                                    JOIN tournament_teams t ON t.id = p.team_id
                                    WHERE t.tournament_id = ? AND p.member_id IS NOT NULL)) pool`,
      Array(6).fill(tournamentId),
    ),
  ]);
  const t = tournament.results[0] as (Omit<Moving, "teams" | "games"> & { name: string }) | undefined;
  if (!t) throw new HttpError(404, "No such tournament.");
  const teams = teamRows.results as { pick: number | null }[];
  const games = gameRows.results as { status: string; homeGoals: number | null }[];
  const n = tally.results[0] as { picks: number; results: number; goals: number; pool: number } | undefined;
  const moving: Moving = { ...t, teams, games };
  const counts = n ?? { picks: 0, results: 0, goals: 0, pool: 0 };
  return {
    name: t.name,
    moving,
    counts,
    stage: t.kind === "draft" ? statusNow(moving, today) : null,
    draftState: t.draftState,
    status: t.status,
    games: games.length,
    ...counts,
  };
}

/** `{ from, to }`, checked: two of a draft's statuses. */
export function moveIn(o: Record<string, unknown>): { from: Status; to: Status } {
  const ok = (s: unknown): s is Status => typeof s === "string" && STATUSES.includes(s as Status);
  if (!ok(o.from) || !ok(o.to)) throw new HttpError(400, `from and to should each be one of ${STATUSES.join(", ")}.`);
  return { from: o.from, to: o.to };
}

/** What a move did: the plan's words, and how many the draft chose at random (its captains hear it). */
export interface Moved {
  from: Status;
  to: Status;
  done: string[];
  chosen: number;
  leftOut: number;
}

/** Moves it from `from` (the status the admin saw) to `to`, as an admin (`by`, the route's checked), at `now`. */
export async function moveTo(
  db: D1Database,
  tournamentId: number,
  { from, to }: { from: Status; to: Status },
  by: { memberId: number },
  now: string,
): Promise<Moved> {
  const today = londonToday(new Date(now));
  const it = await whereItStands(db, tournamentId, today);
  if (it.stage !== from) throw new HttpError(409, MOVED_ON);
  const plan = planMove(it.moving, today, to, it.counts);
  if (typeof plan === "string") throw new HttpError(409, plan);
  const moved: Moved = { from, to, done: plan.steps.map((s) => s.said), chosen: 0, leftOut: 0 };
  if (plan.back) await back(db, tournamentId, plan, today);
  else Object.assign(moved, await forward(db, tournamentId, plan, by.memberId, today, now));
  // The agenda once, for every step (they leave it to this)
  await syncTournament(db, tournamentId);
  return moved;
}

/** Each statement that takes a step back that isn't step-back.ts's own: its last one says it was still there. */
function offTheDay(db: D1Database, id: number): Partial<Record<MoveStep, D1PreparedStatement[]>> {
  return {
    unfinish: [statement(db, "UPDATE tournaments SET status = 'live' WHERE id = ? AND status <> 'live'", [id])],
    offTheDay: [
      statement(db, "UPDATE tournaments SET status = 'open' WHERE id = ? AND status IN ('live', 'finished')", [id]),
    ],
  };
}

/** Back: every step in one batch, in order; one that found nothing to do means someone got there first. */
async function back(db: D1Database, id: number, plan: MovePlan, today: string) {
  const own = stepsBack(db, id, today);
  const more = offTheDay(db, id);
  const steps = plan.steps.map(({ step }) =>
    BACK_FROM.includes(step as BackFrom) ? own[step as BackFrom] : (more[step] ?? []),
  );
  const results = await batch(db, steps.flat());
  // Each step's last statement, by where it falls in the batch
  let at = -1;
  for (const s of steps) {
    at += s.length;
    if (!results[at]?.meta.changes) throw new HttpError(409, MOVED_ON);
  }
}

/** Forward: checked first (the fixtures can be made), then each job in turn. */
async function forward(db: D1Database, id: number, plan: MovePlan, by: number, today: string, now: string) {
  const has = (s: MoveStep) => plan.steps.some((x) => x.step === s);
  if (has("makeFixtures")) await fixturesCanBeMade(db, id);
  const out = { chosen: 0, leftOut: 0 };
  for (const { step } of plan.steps)
    switch (step) {
      case "closeSignup":
        await closeSignup(db, id, today, now, false);
        break;
      case "draw":
        await drawOrder(db, id);
        break;
      case "open":
        await openDraft(db, id, false);
        break;
      case "setTeams":
        Object.assign(out, await setTeamsAtRandom(db, id, by, false));
        break;
      case "makeFixtures":
        await makeFixtures(db, id);
        break;
      case "start":
        if (
          !(
            await run(
              db,
              "UPDATE tournaments SET status = 'live' WHERE id = ? AND status NOT IN ('live', 'finished')",
              [id],
            )
          ).meta.changes
        )
          throw new HttpError(409, MOVED_ON);
        break;
      case "finish":
        if (
          !(await run(db, "UPDATE tournaments SET status = 'finished' WHERE id = ? AND status <> 'finished'", [id]))
            .meta.changes
        )
          throw new HttpError(409, MOVED_ON);
        break;
    }
  return out;
}
