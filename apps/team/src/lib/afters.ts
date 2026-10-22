// The after-party (ADR 0074): the evening a tournament ends, everyone at its afterwards (the Kumite's The Anchor), and
// whoever runs it reveals the awards one at a time, in the order listed (ADR 0044). How many are out is the
// tournament's (`awardsRevealed`); the Worker sends a member an award's winner only once it's out.
import type { Tournament } from "../demo/model";
import { champion, table } from "./fixtures";

/**
 * The awards as the after-party shows them: each face up or face down, the next to reveal, whether the awards have
 * been confirmed (they're revealed from what's confirmed), and whether every one's out.
 */
export function revealOf(t: Pick<Tournament, "awards" | "winners" | "awardsRevealed">) {
  const list = t.awards ?? [];
  const revealed = Math.min(Math.max(0, t.awardsRevealed ?? 0), list.length);
  return {
    awards: list.map((a, i) => ({ ...a, revealed: i < revealed })),
    revealed,
    next: list[revealed] ?? null,
    confirmed: (t.winners ?? []).length > 0,
    all: list.length > 0 && revealed >= list.length,
  };
}

/**
 * The final table, as the after-party has it: the champions first, then the final's loser (with playoffs), then the
 * rest as the table had them (points, goal difference, goals for). Each with its table row.
 */
export function finalOrder(t: Pick<Tournament, "teams" | "games" | "pointsWin" | "pointsDraw" | "pointsLoss">) {
  const ids = t.teams.flatMap((x) => (x.id ? [x.id] : []));
  const games = t.games ?? [];
  const points = { win: t.pointsWin, draw: t.pointsDraw, loss: t.pointsLoss };
  const rows = table(
    ids,
    games.filter((g) => g.stage === "group"),
    points,
  );
  const champ = champion(ids, games, points);
  const playoffs = games.filter((g) => g.stage === "playoff");
  const final = playoffs.length ? playoffs.reduce((a, b) => (b.position > a.position ? b : a)) : undefined;
  const runnerUp = champ && final ? (final.homeTeamId === champ ? final.awayTeamId : final.homeTeamId) : null;
  const first = [champ, runnerUp].filter((id): id is number => !!id);
  return [
    ...first.flatMap((id) => rows.filter((r) => r.teamId === id)),
    ...rows.filter((r) => !first.includes(r.teamId)),
  ].map((r) => ({ ...r, champions: r.teamId === champ }));
}
