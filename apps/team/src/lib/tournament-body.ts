// A tournament as the app sends it to be saved (POST /api/tournaments, PUT /api/tournaments/:id), from its editor
// (lib/TournamentDateEditor) and the quick questions. What it leaves out stays as the server has it (ADR 0030):
//   - its status: it moves on from the tournament's own page (Manage: Close sign-up, Move to…, ADR 0074)
//   - a saved team's name and logo: they're changed on the team's own page (Edit the team), so an editor left open
//     while its captain renames the team never puts the old name back. A new team sends its own.
import type { Tournament, TournamentTeam } from "../demo/model";

/** A team as sent: a saved one (it has an id) without its look. */
export function teamBody(team: TournamentTeam) {
  const { name, logo, ...rest } = team;
  return team.id ? rest : { ...rest, name, logo };
}

export const tournamentBody = (t: Tournament) => ({
  typeId: t.typeId,
  name: t.name,
  venueId: t.venueId,
  location: t.location,
  mapUrl: t.mapUrl,
  heldOn: t.heldOn,
  startTime: t.startTime,
  endTime: t.endTime,
  capacity: t.capacity,
  feePence: t.feePence,
  season: t.season,
  public: t.public,
  signupOpensOn: t.signupOpensOn,
  signupClosesOn: t.signupClosesOn,
  draftOn: t.draftOn,
  pointsWin: t.pointsWin,
  pointsDraw: t.pointsDraw,
  pointsLoss: t.pointsLoss,
  gameMinutes: t.gameMinutes,
  penaltyRule: t.penaltyRule,
  periods: t.periods,
  defaultPenaltyMinutes: t.defaultPenaltyMinutes,
  breakMinutes: t.breakMinutes,
  kind: t.kind,
  awards: t.awards,
  playoffs: t.playoffs,
  teams: t.teams.map(teamBody),
  afterMode: t.afterMode,
  afterVenueId: t.afterVenueId,
  afterTime: t.afterTime,
  afterNote: t.afterNote,
});
