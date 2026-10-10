// The team roster seed (db/seed/README.md): a JSON list of players turned into SQL that only ever adds what's
// missing. A player already in `members` (matched by name, ignoring case) is left alone, so edits made in the app
// win; an email is filled in only where there's none yet; roles are added, never taken away. Safe to run on
// every deploy.

import { assignReferenceSql } from "@cougars/shared/payment-reference";

const POSITIONS = new Set(["F", "D", "G"]);

/** Check a roster and say what's wrong with it, by row. */
export function parseRoster(text) {
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new Error("The roster isn't valid JSON.");
  }
  if (!Array.isArray(rows)) throw new Error("The roster should be a JSON array of players.");
  const seen = new Set();
  return rows.map((r, i) => {
    const at = `Row ${i + 1}`;
    const name = typeof r?.name === "string" ? r.name.trim() : "";
    if (!name) throw new Error(`${at}: a name is needed.`);
    if (seen.has(name.toLowerCase())) throw new Error(`${at}: ${name} is listed twice.`);
    seen.add(name.toLowerCase());
    if (!POSITIONS.has(r.position)) throw new Error(`${at} (${name}): position should be F, D or G.`);
    if (!Number.isInteger(r.rating) || r.rating < 0 || r.rating > 100)
      throw new Error(`${at} (${name}): rating should be a whole number from 0 to 100.`);
    if (r.email != null && (typeof r.email !== "string" || !r.email.includes("@")))
      throw new Error(`${at} (${name}): that email doesn't look right.`);
    const roles = r.roles ?? [];
    if (!Array.isArray(roles) || roles.some((x) => typeof x !== "string"))
      throw new Error(`${at} (${name}): roles should be a list of role names.`);
    if (r.everyday != null && typeof r.everyday !== "string")
      throw new Error(`${at} (${name}): everyday should be the name of the role their app opens as.`);
    if (r.cougar != null && typeof r.cougar !== "boolean")
      throw new Error(`${at} (${name}): cougar should be true or false.`);
    return {
      name,
      position: r.position,
      rating: r.rating,
      email: r.email?.trim().toLowerCase() || null,
      roles,
      cougar: r.cougar === true,
      // The role their app opens as day to day (ADR 0024), set when they're added; theirs to change after
      everyday: r.everyday ?? null,
    };
  });
}

const q = (s) => (s == null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);

/** The SQL that brings `members` and `member_roles` up to the roster. Everyone gets Member, plus their roles. */
export function rosterSql(players, now = new Date()) {
  const at = now.toISOString();
  const on = at.slice(0, 10);
  const same = (name) => `lower(name) = lower(${q(name)})`;
  const out = [];
  for (const p of players) {
    out.push(
      `INSERT INTO members (name, position, rating, cougar, status, joined_on, created_at, everyday_role_id) ` +
        `SELECT ${q(p.name)}, ${q(p.position)}, ${p.rating}, ${p.cougar ? 1 : 0}, 'active', ${q(on)}, ${q(at)}, ` +
        `(SELECT id FROM roles WHERE name = ${q(p.everyday)}) ` +
        `WHERE NOT EXISTS (SELECT 1 FROM members WHERE ${same(p.name)});`,
    );
    if (p.email)
      out.push(
        `UPDATE members SET email = ${q(p.email)} WHERE ${same(p.name)} AND email IS NULL ` +
          `AND NOT EXISTS (SELECT 1 FROM members WHERE email = ${q(p.email)});`,
      );
    // Their bank reference (ADR 0007), filled in by value: the seed is one SQL file, not bound statements
    const { sql, candidates } = assignReferenceSql(p.name, "lower(name) = lower(?)");
    const values = [...candidates, p.name];
    let i = 0;
    out.push(`${sql.replace(/\?/g, () => q(values[i++]))};`);
    for (const role of ["Member", ...p.roles.filter((r) => r !== "Member")])
      out.push(
        `INSERT OR IGNORE INTO member_roles (member_id, role_id) ` +
          `SELECT m.id, r.id FROM members m, roles r WHERE lower(m.name) = lower(${q(p.name)}) AND r.name = ${q(role)};`,
      );
  }
  // The roster changed the club's data: the team app reloads it (data_version, ADR 0053)
  out.push(
    "INSERT INTO data_version (id, version) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER)) " +
      "ON CONFLICT (id) DO UPDATE SET version = version + 1;",
  );
  return out.join("\n");
}
