// A sample Kumite: four teams, a round robin, some games played. Points and tiebreaks are placeholders until
// the club confirms them (an open question).
import { roundRobin } from "../lib/fixtures";
import { PLAYERS } from "./data";

export const KUMITE_TEAMS = [
  { id: 1, name: "Red", players: PLAYERS.slice(0, 5).map((p) => p.id) },
  { id: 2, name: "White", players: PLAYERS.slice(5, 10).map((p) => p.id) },
  { id: 3, name: "Black", players: PLAYERS.slice(10, 15).map((p) => p.id) },
  { id: 4, name: "Gold", players: PLAYERS.slice(15, 20).map((p) => p.id) },
];

export interface Match {
  id: number;
  home: number;
  away: number;
  goals: { team: number; scorer: number; assist?: number }[];
  status: "done" | "live" | "next";
}

const g = (team: number, scorer: number, assist?: number) => ({ team, scorer, assist });

export const MATCHES: Match[] = roundRobin(KUMITE_TEAMS.map((t) => t.id))
  .flat()
  .map(([home, away], i) => ({ id: i + 1, home, away, goals: [], status: "next" as const }));

MATCHES[0].goals = [g(1, 1, 2), g(4, 16), g(1, 3)];
MATCHES[0].status = "done";
MATCHES[1].goals = [g(2, 6, 7), g(3, 11), g(2, 8)];
MATCHES[1].status = "done";
MATCHES[2].goals = [g(1, 2, 1)];
MATCHES[2].status = "live";

export const POINTS = { win: 3, draw: 1, loss: 0 };

export function standings(matches: Match[], points = POINTS) {
  const rows = new Map(KUMITE_TEAMS.map((t) => [t.id, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const m of matches.filter((m) => m.status === "done")) {
    const h = m.goals.filter((x) => x.team === m.home).length;
    const a = m.goals.filter((x) => x.team === m.away).length;
    for (const [id, f, ag] of [
      [m.home, h, a],
      [m.away, a, h],
    ] as const) {
      const r = rows.get(id)!;
      r.p++;
      r.gf += f;
      r.ga += ag;
      if (f > ag) {
        r.w++;
        r.pts += points.win;
      } else if (f === ag) {
        r.d++;
        r.pts += points.draw;
      } else {
        r.l++;
        r.pts += points.loss;
      }
    }
  }
  return [...rows.values()].sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf);
}
