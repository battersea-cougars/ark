// The after-party (ADR 0074): the evening a tournament ends, everyone at its afterwards (the Kumite's The Anchor), and
// whoever runs it reveals the awards one at a time, in the order listed (ADR 0044). How many are out is the
// tournament's (`awardsRevealed`); the Worker sends a member an award's winner only once it's out.
import type { Tournament } from "../demo/model";
import { champion, table } from "./fixtures";
import { isDone } from "@cougars/shared/results";
import { candidatesOf, decidedByOf, votersOf, type Positions } from "./awards";

/**
 * The awards as the after-party shows them, in its two steps (ADR 0044): first they're confirmed (voting open till
 * then, the judges' call made), then revealed one at a time. Each face up or face down, with the name it's given
 * tonight (the judges' call's, once confirmed); the next to reveal; whether they're confirmed; whether every one's out.
 */
export function revealOf(
  t: Pick<Tournament, "awards" | "winners" | "awardsRevealed" | "awardsNext" | "awardsConfirmedAt" | "titles">,
) {
  const list = t.awards ?? [];
  const revealed = Math.min(Math.max(0, t.awardsRevealed ?? 0), list.length);
  return {
    awards: list.map((a, i) => ({
      ...a,
      revealed: i < revealed,
      how: decidedByOf(a),
      title: t.titles?.find((x) => x.award === a.name)?.title ?? null,
    })),
    revealed,
    next: list[revealed] ?? null,
    // Confirmed (or, saved before it said when, its winners set): voting's closed and the reveal's on
    confirmed: !!t.awardsConfirmedAt || (t.winners ?? []).length > 0,
    all: list.length > 0 && revealed >= list.length,
    drum: drumOf(list.length, revealed, !!t.awardsNext),
  };
}

/**
 * The after-party's one card, a drum (ADR 0074): which award it shows and which face. Before any's out, the first,
 * sealed; each reveal turns it face up; Next award rolls on to the next, sealed; after the last it stays on the last
 * (the champions, as the Kumite lists them), face up.
 */
export function drumOf(count: number, revealed: number, next: boolean): { at: number; face: "sealed" | "up" } {
  if (revealed <= 0) return { at: 0, face: "sealed" };
  if (next && revealed < count) return { at: revealed, face: "sealed" };
  return { at: Math.min(revealed, count) - 1, face: "up" };
}

/** The champions' award (decided by the table), the after-party's finale: its card the bigger one, wherever it's listed. */
export const isFinale = (a: { decidedBy?: { kind: string; stat?: string } } & { name: string }) => {
  const how = decidedByOf(a as Parameters<typeof decidedByOf>[0]);
  return how.kind === "stat" && how.stat === "table";
};

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

/**
 * Your ballot (ADR 0044): the voted awards you vote for, from the last match till the awards are confirmed, each with
 * who you can vote for (never yourself) and the vote you cast, if you have. Nothing for someone who didn't play.
 */
export function ballotOf(
  t: Pick<Tournament, "status" | "games" | "teams" | "awards" | "awardsConfirmedAt" | "votes">,
  voter: number,
  ctx: Positions,
) {
  if (!isDone(t.status, t.games ?? []) || t.awardsConfirmedAt) return [];
  return (t.awards ?? [])
    .filter((a) => decidedByOf(a).kind === "vote" && votersOf(a, t, ctx).includes(voter))
    .map((award) => ({
      award,
      candidates: candidatesOf(award, t, ctx, voter),
      mine: t.votes?.find((v) => v.award === award.name)?.mine ?? null,
    }));
}
