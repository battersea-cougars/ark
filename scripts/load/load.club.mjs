// A load run's own people on a database it shares (docs/load-testing.md, "Against dev"): members of its own, signed in
// with sessions it mints itself (no emailed codes, nothing changed in the app), and afterwards everything it made gone
// again. Everything it makes carries a mark it can find again, even after a crash (`--cleanup`):
//   members        an email at load.test (a name that can't be anyone's: .test is reserved)
//   sign-ins       auth_sessions.method "load", stored as the app stores them (the token's SHA-256, auth.ts)
//   what it makes  a name ending "(scripts/load)": a training, a tournament type, tournaments
// Tokens live only in this process's memory. `db` is { run(sql), rows(sql) }: dev's D1 (load.dev.mjs), a local one
// (load.server.mjs), or the tests' SQLite.
import { createHash, randomBytes } from "node:crypto";
import { parseRoster, rosterSql } from "../lib/roster.mjs";

export const MARK = "(scripts/load)";
export const DOMAIN = "load.test";
const METHOD = "load";
const AGENT = `cougars load run ${MARK}`;
/** A minted sign-in lasts a day, so one a crash left behind runs out on its own. */
const SESSION_HOURS = 24;

/** The club for a load run: an admin, then members, a few of them keepers. Names nobody real has. */
export function loadRoster(members) {
  return [
    { name: "Load Admin", position: "D", rating: 70, email: `admin@${DOMAIN}`, roles: ["Admin"] },
    ...Array.from({ length: members - 1 }, (_, i) => ({
      name: `Load Member ${i + 1}`,
      position: i % 30 === 0 ? "G" : i % 3 ? "F" : "D",
      rating: 40 + (i % 40),
      email: `m${i + 1}@${DOMAIN}`,
    })),
  ];
}

const ours = (column) => `${column} LIKE '%@${DOMAIN}'`;
const marked = (column) => `${column} LIKE '%${MARK}'`;
const MEMBERS = `SELECT id FROM members WHERE ${ours("email")}`;
const SERIES = `SELECT id FROM training_series WHERE ${marked("name")}`;
const SESSIONS = `SELECT id FROM training_sessions WHERE series_id IN (${SERIES})`;
const TYPES = `SELECT id FROM tournament_types WHERE ${marked("name")}`;
const TOURNAMENTS = `SELECT id FROM tournaments WHERE ${marked("name")} OR type_id IN (${TYPES})`;

/** What a run has left in the database: none of it should outlast the run. */
export async function leftovers(db) {
  const [row] = await db.rows(
    `SELECT (${count(MEMBERS)}) members, (SELECT COUNT(*) FROM auth_sessions WHERE method = '${METHOD}') signIns,
            (${count(SERIES)}) trainings, (${count(SESSIONS)}) sessions, (${count(TYPES)}) tournamentTypes,
            (${count(TOURNAMENTS)}) tournaments,
            (SELECT COUNT(*) FROM audit_log WHERE member_id IN (${MEMBERS})) auditRows`,
  );
  return row;
}
const count = (select) => `SELECT COUNT(*) FROM (${select})`;
export const nothingLeft = (left) => Object.values(left).every((n) => !n);

/**
 * The run's members, added the way the roster seed adds people (scripts/lib/roster.mjs), one an Admin. Refuses if a
 * run's people are still there (`--cleanup` first) or if a name is already someone's.
 */
export async function addMembers(db, roster) {
  if (!roster.every((r) => r.email?.endsWith(`@${DOMAIN}`))) throw new Error(`A load run's members are @${DOMAIN}.`);
  const left = await leftovers(db);
  if (!nothingLeft(left))
    throw new Error(`An earlier run left things behind (${JSON.stringify(left)}): npm run load -- --cleanup first.`);
  const names = roster.map((r) => `'${r.name.replaceAll("'", "''")}'`).join(", ");
  const [taken] = await db.rows(`SELECT COUNT(*) n FROM members WHERE name IN (${names})`);
  if (taken.n) throw new Error(`${taken.n} of the run's names are already members' names: refusing to touch them.`);
  for (let i = 0; i < roster.length; i += 30)
    await db.run(rosterSql(parseRoster(JSON.stringify(roster.slice(i, i + 30))), new Date()));
}

const token = () => randomBytes(32).toString("base64url");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/**
 * A sign-in for each of these members, as the app stores one (auth.ts startSession: the token's SHA-256, never the
 * token), marked as the load run's and good for a day. Only the run's own members (@load.test) get one. The tokens
 * come back, by email, in memory only: { email: { memberId, token } }.
 */
export async function mintSessions(db, emails, now = new Date()) {
  if (!emails.every((e) => e.endsWith(`@${DOMAIN}`))) throw new Error(`Sign-ins only for @${DOMAIN} members.`);
  const list = emails.map((e) => `'${e}'`).join(", ");
  const rows = await db.rows(`SELECT id, email FROM members WHERE email IN (${list}) AND status = 'active'`);
  if (rows.length !== emails.length) throw new Error(`Only ${rows.length} of ${emails.length} members to sign in.`);
  const at = now.toISOString();
  const until = new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString();
  const out = {};
  const values = rows.map((r) => {
    const t = token();
    out[r.email] = { memberId: r.id, token: t };
    return `(${Number(r.id)}, '${sha256(t)}', '${METHOD}', '${AGENT}', '${at}', '${at}', '${until}')`;
  });
  for (let i = 0; i < values.length; i += 100)
    await db.run(
      `INSERT INTO auth_sessions (member_id, token_hash, method, user_agent, created_at, last_seen_at, expires_at)
       VALUES ${values.slice(i, i + 100).join(", ")}`,
    );
  return out;
}

/** The session cookie for a minted token, as the app names it (auth.ts cookieName: __Host- on https). */
export const sessionCookie = (url, value) =>
  `${new URL(url).protocol === "https:" ? "__Host-" : ""}cougars_session=${value}`;

/**
 * Everything a run made, gone, in one batch (all or nothing): its tournaments and their agenda rows, its tournament
 * types, its trainings with their sessions (sign-ups, teams and charges go with them), its members' record in the
 * audit log, its sign-ins, its members (the rest of what's theirs goes with them). Then the club's data version moves
 * on, so phones reload. Nothing of anyone else's is touched. Returns what was there before and what's left.
 */
export async function cleanUp(db) {
  const before = await leftovers(db);
  if (nothingLeft(before)) return { before, after: before };
  await db.run(
    [
      `DELETE FROM agenda WHERE (source = 'tournament' AND source_id IN (${TOURNAMENTS}))
         OR (source = 'session' AND source_id IN (${SESSIONS}))`,
      `DELETE FROM tournaments WHERE id IN (${TOURNAMENTS})`,
      `DELETE FROM tournament_types WHERE id IN (${TYPES})`,
      `DELETE FROM training_sessions WHERE id IN (${SESSIONS})`,
      `DELETE FROM training_series WHERE id IN (${SERIES})`,
      // What would stop a member going: the few references that don't go with them
      `UPDATE attendance SET recorded_by = NULL WHERE recorded_by IN (${MEMBERS})`,
      `UPDATE session_teams SET published_by = NULL WHERE published_by IN (${MEMBERS})`,
      `UPDATE charges SET created_by = NULL WHERE created_by IN (${MEMBERS})`,
      `UPDATE payments SET recorded_by = NULL WHERE recorded_by IN (${MEMBERS})`,
      `DELETE FROM audit_log WHERE member_id IN (${MEMBERS})`,
      `DELETE FROM auth_sessions WHERE method = '${METHOD}' OR member_id IN (${MEMBERS})`,
      `DELETE FROM members WHERE id IN (${MEMBERS})`,
      "UPDATE data_version SET version = version + 1",
    ].join(";\n"),
  );
  return { before, after: await leftovers(db) };
}
