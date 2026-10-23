// A Kumite on a past day (ADR 0123), dev only: a testing tool, so a Kumite with a whole evening behind it can be had
// in a few taps, to try what a past one shows. It's made as an admin would make one (createTournament: its series'
// rules and awards, its captains), dated the day asked, and signed up for by enough of the club for its teams, each
// signed up in the fortnight before; sign-up closed the day before. Then the app plays it out on that evening with the
// simulator (`simulate` with `onItsDay`, on-its-day.ts): the draft, every match on its clock, the awards confirmed and
// revealed, so it's history at once.
import { all, batch, first, statement } from "@cougars/shared/d1";
import { seasonLabel, seasonOf } from "@cougars/shared/seasons";
import { playersNeeded } from "../../src/lib/draft";
import { HttpError, date, int } from "../api/api.http";
import { shuffled } from "./draft";
import { createTournament } from "./tournaments";

/** The most teams it makes, and players a team beyond its captain: a Kumite's usual evening. */
const MOST_TEAMS = 4;
const PLAYERS_A_TEAM = 5;
const DAY_MS = 86_400_000;

/**
 * `{ typeId, heldOn }`: a Kumite of the series on `heldOn`, a day gone by. Four captains (fewer in a small club: two at
 * least), each with a team's worth signed up, at random from the club's active members. Nobody owes for it.
 */
export async function setUpPastDay(db: D1Database, o: Record<string, unknown>, today: string) {
  const typeId = int(o, "typeId", { min: 1 });
  const heldOn = date(o, "heldOn")!;
  if (heldOn >= today) throw new HttpError(400, "Choose a day gone by.");
  const series = await first<{ shortName: string; kind: string }>(
    db,
    "SELECT short_name shortName, kind FROM tournament_types WHERE id = ?",
    [typeId],
  );
  if (!series) throw new HttpError(400, "No such tournament series.");
  if (series.kind !== "draft") throw new HttpError(409, "Only a captains' draft (the Kumite).");
  const club = shuffled(
    (await all<{ id: number }>(db, "SELECT id FROM members WHERE status = 'active' ORDER BY id")).map((m) => m.id),
  );
  const teams = [MOST_TEAMS, 3, 2].find((n) => club.length >= n + playersNeeded(n));
  if (!teams) throw new HttpError(409, "Not enough members for two teams.");
  const captains = club.slice(0, teams);
  const players = club.slice(teams, teams + teams * PLAYERS_A_TEAM);

  const day = Date.parse(`${heldOn}T12:00:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const { id } = await createTournament(db, {
    typeId,
    name: `${series.shortName} ${seasonLabel(seasonOf(heldOn).season, heldOn)}`,
    heldOn,
    status: "open",
    feePence: 0,
    signupOpensOn: iso(day - 14 * DAY_MS),
    signupClosesOn: iso(day - DAY_MS),
    draftOn: heldOn,
    teams: captains.map((captainMemberId) => ({ name: "", captainMemberId })),
  });
  // Signed up over the fortnight before, a few hours apart; sign-up closed the evening before, told when it opened
  const signedUp = players.map((m, i) => [m, new Date(day - 14 * DAY_MS + (i + 1) * 3_600_000 * 7).toISOString()]);
  await batch(db, [
    statement(
      db,
      `INSERT INTO tournament_entries (tournament_id, member_id, signup, signed_up_at)
       SELECT ?, value ->> 0, 'in', value ->> 1 FROM json_each(?) WHERE true
       ON CONFLICT (tournament_id, member_id) DO NOTHING`,
      [id, JSON.stringify(signedUp)],
    ),
    // The captains were in from the start
    statement(
      db,
      `UPDATE tournament_entries SET signed_up_at = ?
       WHERE tournament_id = ? AND member_id IN (SELECT value FROM json_each(?))`,
      [new Date(day - 14 * DAY_MS).toISOString(), id, JSON.stringify(captains)],
    ),
    statement(db, "UPDATE tournaments SET signup_closed_at = ?, signup_told_at = ? WHERE id = ?", [
      new Date(day - DAY_MS + 6 * 3_600_000).toISOString(),
      new Date(day - 14 * DAY_MS).toISOString(),
      id,
    ]),
  ]);
  return { id };
}
