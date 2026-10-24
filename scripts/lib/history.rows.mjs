// Rows for a club's past, written as SQL: played Kumites (each with its teams, draft, games, goals, penalties, awards,
// votes and sign-ups) and anything else, table by table. Shared by `npm run seed:history` (scripts/lib/history.mjs,
// which makes up a realistic past for a local D1) and the tests' club with years behind it
// (apps/team/worker/api/bootstrap.testing.ts). Every row gets its id here, from `ids` (the next free id in each
// table), so a whole history is one SQL text: run by wrangler on a local D1, or straight into the tests' SQLite.

/**
 * The next free id in each table, from what's there: the largest id or AUTOINCREMENT's sequence, whichever's more.
 * One row, a column a table (D1 refuses a compound SELECT of more than a few).
 */
export const NEXT_IDS_SQL = (tables) =>
  "SELECT " +
  tables
    .map(
      (t) =>
        `MAX(COALESCE((SELECT MAX(id) FROM "${t}"), 0),
           COALESCE((SELECT seq FROM sqlite_sequence WHERE name = '${t}'), 0)) + 1 "${t}"`,
    )
    .join(",\n  ");

/** Hands out ids, table by table, from the next free ones ({ table: id }). */
export function idsFrom(next) {
  const at = { ...next };
  return (table) => {
    if (!at[table]) throw new Error(`No starting id for ${table}.`);
    return at[table]++;
  };
}

/** The tables a Kumite's rows go in, parents first. */
export const KUMITE_TABLES = [
  "tournaments",
  "tournament_teams",
  "tournament_team_players",
  "tournament_entries",
  "tournament_games",
  "tournament_goals",
  "tournament_penalties",
  "tournament_award_winners",
  "tournament_award_votes",
];
/** Of those, the ones with an id. */
export const KUMITE_ID_TABLES = KUMITE_TABLES.filter((t) => !t.startsWith("tournament_award_"));

/**
 * One Kumite as rows: `k` is { tournament, teams, entries, games, winners, votes }, with columns as the schema names
 * them, and teams referred to by their place in `teams` (a game's `home` and `away`, a goal's `side`, a winner's
 * `team`). A team is { players: [{ member_id, … }], …its own columns }; a game { home, away, goals, penalties, …its
 * own }; a goal or penalty { side: "home" | "away", …its own }. Adds them to `out` ({ table: rows }).
 */
export function kumiteRows(k, nextId, out = {}) {
  const add = (table, row) => ((out[table] ??= []).push(row), row);
  const t = add("tournaments", { id: nextId("tournaments"), ...k.tournament });
  const teams = k.teams.map(({ players, ...team }) => {
    const row = add("tournament_teams", { id: nextId("tournament_teams"), tournament_id: t.id, ...team });
    players.forEach((p, i) =>
      add("tournament_team_players", { id: nextId("tournament_team_players"), team_id: row.id, position: i, ...p }),
    );
    return row;
  });
  for (const e of k.entries ?? [])
    add("tournament_entries", { id: nextId("tournament_entries"), tournament_id: t.id, ...e });
  for (const { home, away, goals = [], penalties = [], ...game } of k.games ?? []) {
    const g = add("tournament_games", {
      id: nextId("tournament_games"),
      tournament_id: t.id,
      ...game,
      home_team_id: teams[home]?.id ?? null,
      away_team_id: teams[away]?.id ?? null,
    });
    const sideOf = (side) => (side === "home" ? g.home_team_id : g.away_team_id);
    for (const { side, ...goal } of goals)
      add("tournament_goals", { id: nextId("tournament_goals"), game_id: g.id, team_id: sideOf(side), ...goal });
    for (const { side, ...penalty } of penalties)
      add("tournament_penalties", {
        id: nextId("tournament_penalties"),
        game_id: g.id,
        team_id: sideOf(side),
        ...penalty,
      });
  }
  for (const { team, ...w } of k.winners ?? [])
    add("tournament_award_winners", {
      tournament_id: t.id,
      ...w,
      team_id: team === undefined || team === null ? null : teams[team].id,
    });
  for (const v of k.votes ?? []) add("tournament_award_votes", { tournament_id: t.id, ...v });
  return t;
}

const literal = (v) =>
  v === null || v === undefined
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : typeof v === "boolean"
        ? String(Number(v))
        : `'${String(v).replaceAll("'", "''")}'`;

/** D1 takes a statement of up to 100 KB: each INSERT stays well under it, a logo or two at a time if need be. */
const MOST_BYTES = 60_000;

/** Rows' VALUES lists, a statement's worth (MOST_BYTES) at a time. */
function chunks(rows) {
  const out = [[]];
  let bytes = 0;
  for (const row of rows) {
    const v = `(${Object.values(row).map(literal).join(", ")})`;
    if (out.at(-1).length && bytes + v.length > MOST_BYTES) [out[out.length], bytes] = [[], 0];
    out.at(-1).push(v);
    bytes += v.length;
  }
  return out.filter((c) => c.length);
}

/** A table's rows grouped by the columns they have, each group in order. */
function byColumns(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = Object.keys(row).join(", ");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

/**
 * Every table's rows as INSERTs, in the order given (parents first), as many rows a statement as fit. Each row lists
 * the columns it has; anything else takes the schema's default.
 */
export function insertsSql(tables, order = Object.keys(tables)) {
  const out = [];
  for (const table of order)
    for (const [columns, rows] of byColumns(tables[table] ?? []))
      for (const values of chunks(rows)) out.push(`INSERT INTO "${table}" (${columns}) VALUES\n${values.join(",\n")};`);
  return out.join("\n");
}
