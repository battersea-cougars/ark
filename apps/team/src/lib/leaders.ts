// The leaderboards (#47): each player's goals, assists, points (goals and assists together, as hockey counts them)
// and penalty minutes (PIM, lib/penalties.ts penaltyMinutes), over one tournament's games or every edition's. Only
// games under way or played count: one not kicked off has nothing on it yet.
import { penaltyMinutes } from "./penalties";

export const LEADER_STATS = [
  { key: "points", label: "Points", short: "Pts" },
  { key: "goals", label: "Goals", short: "G" },
  { key: "assists", label: "Assists", short: "A" },
  { key: "pim", label: "PIM", short: "PIM" },
] as const;
export type LeaderStat = (typeof LEADER_STATS)[number]["key"];

export interface LeaderRow {
  memberId: number;
  goals: number;
  assists: number;
  points: number;
  pim: number;
}

interface GameLike {
  status: string;
  goals?: { scorerId: number | null; assistId: number | null }[];
  penalties?: { id: number; teamId: number; memberId: number | null; minutes: number; atMs: number | null }[];
}

/**
 * The board for one stat: everyone with any, most first; level, more points, then more goals, then the order they
 * first appear in.
 */
export function leaders(games: GameLike[], stat: LeaderStat): LeaderRow[] {
  const played = games.filter((g) => g.status !== "next");
  const rows = new Map<number, LeaderRow>();
  const row = (memberId: number) => {
    let r = rows.get(memberId);
    if (!r) rows.set(memberId, (r = { memberId, goals: 0, assists: 0, points: 0, pim: 0 }));
    return r;
  };
  for (const g of played.flatMap((x) => x.goals ?? [])) {
    if (g.scorerId !== null) row(g.scorerId).goals++;
    if (g.assistId !== null) row(g.assistId).assists++;
  }
  for (const [memberId, minutes] of penaltyMinutes(played).byMember) row(memberId).pim = minutes;
  for (const r of rows.values()) r.points = r.goals + r.assists;
  return ranked([...rows.values()], stat);
}

/** Rows already counted (History's all-time board, counted by the Worker, #175), as the board for one stat. */
export const ranked = (rows: LeaderRow[], stat: LeaderStat) =>
  rows.filter((r) => r[stat] > 0).sort((a, b) => b[stat] - a[stat] || b.points - a.points || b.goals - a.goals);
