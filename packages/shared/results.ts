// A tournament's results (ADR 0061, ADR 0100): the table, the champions and whether it's done. One set of rules for
// the team app's Worker and pages and the website's results, so they can't disagree.

/** Done, by its games more than its settings: an admin marked it finished, or every game's been played. */
export const isDone = (status: string, games: { status?: string }[]) =>
  status === "finished" || (games.length > 0 && games.every((g) => g.status === "done"));

/**
 * The same, in SQL, for the Worker and the website: `t`, the tournament's alias. Done is past, whatever its date says
 * (ADR 0074, #182): a Kumite played early is history on its pages, Home and What's on alike.
 */
export const doneSql = (t: string) =>
  `(${t}.status = 'finished' OR (EXISTS (SELECT 1 FROM tournament_games g WHERE g.tournament_id = ${t}.id)
     AND NOT EXISTS (SELECT 1 FROM tournament_games g WHERE g.tournament_id = ${t}.id AND g.status <> 'done')))`;

export interface Result {
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  /** A game being played has a score but no result yet: only a finished one counts (ADR 0061). */
  status?: string;
}

export interface TableRow {
  teamId: number;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

/** The table from the games with a result: points, then goal difference, then goals for. */
export function table(
  teamIds: number[],
  results: Result[],
  points: { win: number; draw: number; loss: number } = { win: 3, draw: 1, loss: 0 },
): TableRow[] {
  const rows = new Map(teamIds.map((teamId) => [teamId, { teamId, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const g of results) {
    if (g.homeGoals == null || g.awayGoals == null || g.homeTeamId == null || g.awayTeamId == null) continue;
    if (g.status !== undefined && g.status !== "done") continue;
    for (const [id, f, a] of [
      [g.homeTeamId, g.homeGoals, g.awayGoals],
      [g.awayTeamId, g.awayGoals, g.homeGoals],
    ] as const) {
      const r = rows.get(id);
      if (!r) continue;
      r.p++;
      r.gf += f;
      r.ga += a;
      if (f > a) [r.w, r.pts] = [r.w + 1, r.pts + points.win];
      else if (f === a) [r.d, r.pts] = [r.d + 1, r.pts + points.draw];
      else [r.l, r.pts] = [r.l + 1, r.pts + points.loss];
    }
  }
  return [...rows.values()].sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf);
}

/**
 * Who won the tournament, once it's decided: with playoffs, whoever wins the last one (the final); without, the top
 * of the table once every game's played. A drawn final crowns nobody until a result settles it.
 */
export function champion(
  teamIds: number[],
  games: (Result & { stage: "group" | "playoff"; position: number })[],
  points?: { win: number; draw: number; loss: number },
): number | null {
  const playoffs = games.filter((g) => g.stage === "playoff");
  if (playoffs.length) {
    const final = playoffs.reduce((a, b) => (b.position > a.position ? b : a));
    if (final.status !== "done" || final.homeGoals == null || final.awayGoals == null) return null;
    if (final.homeGoals === final.awayGoals) return null;
    return final.homeGoals > final.awayGoals ? final.homeTeamId : final.awayTeamId;
  }
  if (!games.length || games.some((g) => g.status !== "done")) return null;
  return table(teamIds, games, points)[0]?.teamId ?? null;
}
