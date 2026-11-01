// A past Kumite recorded (ADR 0126), as lib/PastKumiteRecord asks it: its day, its teams, its matches with their
// scores (each team playing every other once, in the fair order, and a final between the top two if it had one), who
// scored where anyone remembers, and who won each award. What stops each step, what's filled in for the admin to check
// (the champions and the top scorer, from the results), and what the Worker is sent
// (worker/tournaments/past.ts recordPast).
import type { Award, AwardsData } from "./awards";
import { awardFromData, decidedByOf } from "./awards";
import { fairFixtures } from "./fixtures";
import { champion, table } from "@cougars/shared/results";

export const PAST_STEPS = ["When", "Teams", "Matches", "Awards", "Check"] as const;
export type PastStep = (typeof PAST_STEPS)[number];

export interface PastTeam {
  name: string;
  captain: number | null;
  players: number[];
}

export interface PastMatch {
  home: number;
  away: number;
  homeGoals: number;
  awayGoals: number;
  /** Who scored each side's goals, one a goal: a member, or null where nobody remembers. */
  scorers: { home: (number | null)[]; away: (number | null)[] };
}

export interface PastWinner {
  /** A team's place in the list, for a team's award (the champions). */
  team: number | null;
  memberId: number | null;
  /** The judges' call's name on the night. */
  title: string;
}

export interface PastValues {
  heldOn: string;
  teams: PastTeam[];
  /** The round robin, each pair once. */
  matches: PastMatch[];
  /** A final between the top two, if there was one; its teams follow the table. */
  final: PastMatch | null;
  winners: Record<string, PastWinner>;
}

export const blankPast = (): PastValues => ({
  heldOn: "",
  teams: [blankTeam(), blankTeam()],
  matches: [],
  final: null,
  winners: {},
});

export const blankTeam = (): PastTeam => ({ name: "", captain: null, players: [] });

const nil = (home: number, away: number): PastMatch => ({
  home,
  away,
  homeGoals: 0,
  awayGoals: 0,
  scorers: { home: [], away: [] },
});

/** Everyone on a team: its captain and players. */
export const rosterOf = (t: PastTeam) => [...(t.captain ? [t.captain] : []), ...t.players];

/**
 * The round robin for this many teams, in the fair order (lib/fixtures.ts), keeping any score already put in for a
 * pair; and the final, if asked for, between the top two of the table so far.
 */
export function withMatches(v: PastValues, final: boolean): Pick<PastValues, "matches" | "final"> {
  const n = v.teams.length;
  const pairs = n >= 2 ? fairFixtures(Array.from({ length: n }, (_, i) => i)) : [];
  const matches = pairs.map(
    ([home, away]) => v.matches.find((m) => m.home === home && m.away === away) ?? nil(home, away),
  );
  return { matches, final: final && n >= 2 ? finalOf({ ...v, matches }) : null };
}

/** The final between the top two of the table (by place in the list), keeping its score if its teams haven't changed. */
export function finalOf(v: PastValues): PastMatch {
  const [first, second] = standings(v);
  const home = first?.team ?? 0;
  const away = second?.team ?? 1;
  return v.final && v.final.home === home && v.final.away === away ? v.final : nil(home, away);
}

/** As results: teams by their place in the list, from 1 (a team id of 0 isn't one). */
const results = (v: PastValues) => [
  ...v.matches.map((m, i) => ({
    homeTeamId: m.home + 1,
    awayTeamId: m.away + 1,
    homeGoals: m.homeGoals,
    awayGoals: m.awayGoals,
    status: "done",
    stage: "group" as const,
    position: i + 1,
  })),
  ...(v.final
    ? [
        {
          homeTeamId: v.final.home + 1,
          awayTeamId: v.final.away + 1,
          homeGoals: v.final.homeGoals,
          awayGoals: v.final.awayGoals,
          status: "done",
          stage: "playoff" as const,
          position: v.matches.length + 1,
        },
      ]
    : []),
];

/** The table from the round robin's scores, best first: each row's team by its place in the list. */
export const standings = (v: PastValues) =>
  table(
    v.teams.map((_, i) => i + 1),
    results(v).filter((g) => g.stage === "group"),
  ).map((r) => ({ ...r, team: r.teamId - 1 }));

/** The award's data as lib/awards.ts reads it: teams by place from 1, their goals and scorers. */
function awardsData(v: PastValues): AwardsData {
  const games = results(v).map((g, i) => {
    const m = i < v.matches.length ? v.matches[i] : v.final!;
    return { ...g, goals: [...m.scorers.home, ...m.scorers.away].map((scorerId) => ({ scorerId })) };
  });
  return {
    id: 0,
    teams: v.teams.map((t, i) => ({
      id: i + 1,
      captainMemberId: t.captain,
      players: t.players.map((memberId) => ({ memberId })),
    })),
    games,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
  };
}

/** The champions from the results (the final's winners, else the top of the table): a team's place, or null. */
export function championsOf(v: PastValues) {
  const data = awardsData(v);
  const id = champion(
    data.teams.map((t) => t.id!),
    data.games ?? [],
  );
  return id ? id - 1 : null;
}

/**
 * Each award's winner as the results say, for the admin to check (the champions, the top scorer, a draw), where
 * they haven't chosen already; a vote's and the judges' call are theirs to say (Nobody till they do).
 */
export function suggestedWinners(v: PastValues, awards: Award[], positionOf: (id: number) => string | undefined) {
  const data = awardsData(v);
  const out: Record<string, PastWinner> = { ...v.winners };
  for (const award of awards) {
    if (out[award.name]) continue;
    out[award.name] = { team: null, memberId: null, title: "" };
    const how = decidedByOf(award);
    if (how.kind !== "stat" && how.kind !== "random") continue;
    const w = awardFromData(award, data, { positionOf })?.winners[0];
    if (w) out[award.name] = { team: w.teamId ? w.teamId - 1 : null, memberId: w.memberId, title: "" };
  }
  return out;
}

/** Whether an award goes to a team (the champions) rather than a player. */
export const forATeam = (award: Award) => {
  const how = decidedByOf(award);
  return how.kind === "stat" && how.stat === "table";
};

/** What stops a step, in words; "" when nothing does. */
export function pastProblem(step: PastStep, v: PastValues, today: string): string {
  if (step === "When") {
    if (!v.heldOn) return "Choose the day it was.";
    return v.heldOn >= today ? "A day gone by: one still to come is scheduled as the next." : "";
  }
  if (step === "Teams") {
    if (v.teams.length < 2) return "Two teams at least.";
    if (v.teams.some((t) => !t.captain)) return "Every team needs its captain.";
    return v.teams.some((t) => !t.players.length) ? "Every team needs its players." : "";
  }
  if (step === "Matches")
    return v.final && v.final.homeGoals === v.final.awayGoals ? "The final can't end level: who won it?" : "";
  return "";
}

/** The Worker's body (worker/tournaments/past.ts): the matches in order, the final last; scorers where said. */
export function pastBody(typeId: number, name: string, v: PastValues, awards: Award[]) {
  const match = (m: PastMatch, final = false) => ({
    home: m.home,
    away: m.away,
    homeGoals: m.homeGoals,
    awayGoals: m.awayGoals,
    final,
    scorers: { home: m.scorers.home.slice(0, m.homeGoals), away: m.scorers.away.slice(0, m.awayGoals) },
  });
  return {
    typeId,
    name,
    heldOn: v.heldOn,
    teams: v.teams.map((t) => ({ name: t.name.trim(), captainMemberId: t.captain, players: t.players })),
    games: [...v.matches.map((m) => match(m)), ...(v.final ? [match(v.final, true)] : [])],
    winners: awards.flatMap((a) => {
      const w = v.winners[a.name];
      if (!w || (w.team === null && w.memberId === null)) return [];
      return [
        forATeam(a)
          ? { award: a.name, team: w.team }
          : { award: a.name, memberId: w.memberId, ...(w.title && { title: w.title }) },
      ];
    }),
  };
}
