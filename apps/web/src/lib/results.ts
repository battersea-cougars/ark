// Tournament results on the website (ADR 0100): what the team app recorded, worked out at build time from the club
// snapshot's rows (scripts/lib/results-sql.mjs). Only a tournament that's public and done (@cougars/shared/results),
// and only award winners an admin confirmed (ADR 0044). People go by the name they chose, else first name and initial
// (@cougars/shared/names): no full name leaves this module.
import { onTheWebsite, publicName, shortOnTheWebsite } from "@cougars/shared/names";
import { champion, isDone, table } from "@cougars/shared/results";
import { isSeason, seasonLabel, seasonOf } from "@cougars/shared/seasons";

export interface PublishedAward {
  name: string;
  about: string;
  /** Who won it, confirmed: a team's name or a player's. Empty until an admin confirms. */
  winners: string[];
}

export interface PublishedTeam {
  id: number;
  name: string;
  /** Its crest's address (/crests/<id>.webp), or null for none. */
  crest: string | null;
  /** Captain first, then the players in order. */
  players: string[];
}

export interface PublishedGame {
  id: number;
  stage: "group" | "playoff";
  /** A playoff's name ("Final"); "" for a group game. */
  name: string;
  position: number;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  /** Penalty minutes a side (ADR 0061). */
  homePim: number;
  awayPim: number;
}

export interface PublishedEdition {
  id: number;
  name: string;
  /** Its series ("The Cougars Kumite"), if it has one. */
  series: { slug: string; name: string } | null;
  heldOn: string;
  /** "Autumn 2026". */
  season: string;
  /** The champions' team name; null if the day didn't decide one. */
  champions: string | null;
  /** The champions' crest's address, if they have one. */
  championsCrest: string | null;
  awards: PublishedAward[];
  teams: PublishedTeam[];
  table: {
    teamId: number;
    name: string;
    p: number;
    w: number;
    d: number;
    l: number;
    gf: number;
    ga: number;
    pts: number;
  }[];
  games: PublishedGame[];
  /** Everyone with a goal, an assist or a penalty: most goals, then most assists, then fewest penalty minutes. */
  scorers: { name: string; team: string; goals: number; assists: number; pim: number }[];
}

/** The snapshot's rows, as scripts/lib/results-sql.mjs reads them. */
export interface ResultRows {
  tournaments: {
    id: number;
    name: string;
    heldOn: string;
    status: string;
    season: string | null;
    awards: string;
    pointsWin: number;
    pointsDraw: number;
    pointsLoss: number;
    seriesSlug: string | null;
    seriesName: string | null;
  }[];
  games: {
    id: number;
    tournamentId: number;
    stage: "group" | "playoff";
    name: string;
    position: number;
    homeTeamId: number | null;
    awayTeamId: number | null;
    homeGoals: number | null;
    awayGoals: number | null;
    status: string;
  }[];
  teams: {
    id: number;
    tournamentId: number;
    name: string;
    /** A small image, as the team app keeps it: a data: URL. */
    logo: string | null;
    captainName: string | null;
    captainWebName: string | null;
    outsideCaptain: string;
  }[];
  players: { teamId: number; name: string | null; webName: string | null; outsideName: string }[];
  goals: {
    tournamentId: number;
    teamId: number;
    scorerId: number | null;
    scorerName: string | null;
    scorerWebName: string | null;
    assistId: number | null;
    assistName: string | null;
    assistWebName: string | null;
  }[];
  /** Missing from a snapshot taken before penalties were kept. */
  penalties?: {
    tournamentId: number;
    gameId: number;
    teamId: number;
    memberId: number | null;
    memberName: string | null;
    memberWebName: string | null;
    minutes: number;
  }[];
  winners: {
    tournamentId: number;
    award: string;
    teamId: number | null;
    memberName: string | null;
    memberWebName: string | null;
    /** The judges' call's name on the night (ADR 0044); null for every other award. */
    title?: string | null;
  }[];
}

/** A crest as a file the build writes: its address and its bytes. */
export interface CrestFile {
  path: string;
  type: string;
  base64: string;
}

const CREST = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;

/** A team's crest as a file, if it has one the website can show (never SVG: it could carry script). */
function crestFile(teamId: number, logo: string | null): CrestFile | null {
  const m = logo?.match(CREST);
  return m
    ? { path: `/crests/${teamId}.${m[1] === "jpeg" ? "jpg" : m[1]}`, type: `image/${m[1]}`, base64: m[2] }
    : null;
}

/** The crests of the published tournaments' teams, to write as files at build time. */
export function crestFiles(rows: ResultRows | null): CrestFile[] {
  const published = new Set(editionsFrom(rows).map((e) => e.id));
  return (rows?.teams ?? []).flatMap((x) => (published.has(x.tournamentId) ? (crestFile(x.id, x.logo) ?? []) : []));
}

/** Every published tournament, newest first, worked out from the snapshot's rows. None without a snapshot. */
export function editionsFrom(rows: ResultRows | null): PublishedEdition[] {
  if (!rows) return [];
  const editions: PublishedEdition[] = [];
  for (const t of rows.tournaments) {
    const games = rows.games.filter((g) => g.tournamentId === t.id);
    if (!isDone(t.status, games)) continue;
    const teams = rows.teams.filter((x) => x.tournamentId === t.id);
    const teamName = teamNamer(teams);
    const nameOf = new Map(teams.map((x) => [x.id, teamName(x)]));
    const crestOf = new Map(teams.map((x) => [x.id, crestFile(x.id, x.logo)?.path ?? null]));
    const points = { win: t.pointsWin, draw: t.pointsDraw, loss: t.pointsLoss };
    const teamIds = teams.map((x) => x.id);
    const penalties = (rows.penalties ?? []).filter((p) => p.tournamentId === t.id);
    const pimOf = (gameId: number, teamId: number) =>
      penalties.filter((p) => p.gameId === gameId && p.teamId === teamId).reduce((n, p) => n + p.minutes, 0);

    // The champions: as confirmed, else worked out from the games
    const winners = rows.winners.filter((w) => w.tournamentId === t.id);
    const list = JSON.parse(t.awards) as {
      name: string;
      about?: string;
      decidedBy?: { kind: string; stat?: string };
    }[];
    // The champions' award: the one the table decides (ADR 0044), else (saved before it said how) by its name
    const champs =
      list.find((a) => a.decidedBy?.kind === "stat" && a.decidedBy.stat === "table")?.name ??
      list.find((a) => !a.decidedBy && /champion/i.test(a.name))?.name ??
      "Champions";
    const confirmed = winners.find((w) => w.award === champs && w.teamId)?.teamId ?? null;
    const championId = confirmed ?? champion(teamIds, games, points);
    const awards = list.map((a) => ({
      // The judges' call goes by the name it was given on the night
      name: winners.find((w) => w.award === a.name && w.title)?.title ?? a.name,
      about: a.about ?? "",
      winners: winners
        .filter((w) => w.award === a.name)
        .map((w) =>
          w.teamId ? (nameOf.get(w.teamId) ?? "") : w.memberName ? onTheWebsite(w.memberName, w.memberWebName) : "",
        )
        .filter(Boolean),
    }));

    editions.push({
      id: t.id,
      name: t.name,
      series: t.seriesSlug && t.seriesName ? { slug: t.seriesSlug, name: t.seriesName } : null,
      heldOn: t.heldOn,
      season: seasonLabel(isSeason(t.season) ? t.season : seasonOf(t.heldOn).season, t.heldOn),
      champions: championId ? (nameOf.get(championId) ?? null) : null,
      championsCrest: championId ? (crestOf.get(championId) ?? null) : null,
      awards,
      teams: teams.map((x) => ({
        id: x.id,
        name: nameOf.get(x.id)!,
        crest: crestOf.get(x.id) ?? null,
        players: [
          ...(x.captainName
            ? [onTheWebsite(x.captainName, x.captainWebName)]
            : x.outsideCaptain
              ? [publicName(x.outsideCaptain)]
              : []),
          ...rows.players
            .filter((p) => p.teamId === x.id)
            .map((p) => (p.name ? onTheWebsite(p.name, p.webName) : publicName(p.outsideName)))
            .filter(Boolean),
        ],
      })),
      table: table(teamIds, games, points).map((r) => ({ ...r, name: nameOf.get(r.teamId)! })),
      games: games.flatMap((g) =>
        g.status === "done" && g.homeTeamId && g.awayTeamId && g.homeGoals != null && g.awayGoals != null
          ? [
              {
                id: g.id,
                stage: g.stage,
                name: g.name,
                position: g.position,
                home: nameOf.get(g.homeTeamId)!,
                away: nameOf.get(g.awayTeamId)!,
                homeGoals: g.homeGoals,
                awayGoals: g.awayGoals,
                homePim: pimOf(g.id, g.homeTeamId),
                awayPim: pimOf(g.id, g.awayTeamId),
              },
            ]
          : [],
      ),
      scorers: scorersOf(
        rows.goals.filter((o) => o.tournamentId === t.id),
        penalties,
        nameOf,
      ),
    });
  }
  return editions;
}

type TeamRow = ResultRows["teams"][number];

/** A team's name: its own, else "Team" and its captain's short name (first name and initial, if two would match). */
function teamNamer(teams: TeamRow[]) {
  const short = (x: TeamRow) =>
    x.captainName ? shortOnTheWebsite(x.captainName, x.captainWebName) : x.outsideCaptain.trim().split(/\s+/)[0];
  const full = (x: TeamRow) =>
    x.captainName ? onTheWebsite(x.captainName, x.captainWebName) : publicName(x.outsideCaptain);
  return (x: TeamRow) => {
    if (x.name) return x.name;
    if (!short(x)) return "Team";
    const twin = teams.some((y) => y.id !== x.id && !y.name && short(y) === short(x));
    return `Team ${twin ? full(x) : short(x)}`;
  };
}

function scorersOf(
  goals: ResultRows["goals"],
  penalties: NonNullable<ResultRows["penalties"]>,
  teamName: Map<number, string>,
) {
  const by = new Map<number, { name: string; team: string; goals: number; assists: number; pim: number }>();
  const tally = (id: number | null, name: string | null, webName: string | null, teamId: number) => {
    if (!id || !name) return null;
    let s = by.get(id);
    if (!s)
      by.set(
        id,
        (s = { name: onTheWebsite(name, webName), team: teamName.get(teamId) ?? "", goals: 0, assists: 0, pim: 0 }),
      );
    return s;
  };
  for (const o of goals) {
    const scorer = tally(o.scorerId, o.scorerName, o.scorerWebName, o.teamId);
    if (scorer) scorer.goals++;
    const assist = tally(o.assistId, o.assistName, o.assistWebName, o.teamId);
    if (assist) assist.assists++;
  }
  // A bench penalty is nobody's
  for (const p of penalties) {
    const s = tally(p.memberId, p.memberName, p.memberWebName, p.teamId);
    if (s) s.pim += p.minutes;
  }
  return [...by.values()].sort(
    (a, b) => b.goals - a.goals || b.assists - a.assists || a.pim - b.pim || a.name.localeCompare(b.name),
  );
}
