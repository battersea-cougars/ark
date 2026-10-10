#!/usr/bin/env node
// Swap dev's players for made-up people (ADR 0029, scripts/lib/anonymize.mjs): everyone but the admins gets the
// made-up name the dev seed gives them, and loses their email, phone, bio, photo and web name; their bank reference
// is worked out again from the new name; the audit log's details swap the names too; enquiries lose who sent them;
// their sign-in codes and sessions go. Safe to run again: a made-up name is left as it is. Never for production.
//   node scripts/anonymize-members.mjs --local
//   node scripts/anonymize-members.mjs --remote -c <dev wrangler config>
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignReferenceSql } from "@cougars/shared/payment-reference";
import { fakeName, isFake, keepsReal } from "./lib/anonymize.mjs";

const argv = process.argv.slice(2);
const remote = argv.includes("--remote");
if (remote === argv.includes("--local")) {
  console.error("Usage: anonymize-members.mjs --local | --remote -c <wrangler config>");
  process.exit(2);
}
const config = argv.includes("-c")
  ? argv[argv.indexOf("-c") + 1]
  : join(import.meta.dirname, "../apps/web/wrangler.jsonc");
if (remote && /production|release/i.test(`${config} ${process.env.GITHUB_REF ?? ""}`)) {
  console.error("Not on production: dev only.");
  process.exit(2);
}
const where = remote ? "--remote" : "--local";

/** The rows of a query (one with no names in it, so it can go on the command line). */
function rows(sql) {
  const res = spawnSync("npx", ["wrangler", "d1", "execute", "DB", where, "-c", config, "--command", sql, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
  return JSON.parse(res.stdout)[0].results;
}

/** Run SQL from a private temp file (it holds names), removed straight after. */
function d1(sql) {
  const dir = mkdtempSync(join(tmpdir(), "anon-"));
  const file = join(dir, "run.sql");
  try {
    writeFileSync(file, sql, { mode: 0o600 });
    const res = spawnSync("npx", ["wrangler", "d1", "execute", "DB", where, "-c", config, "--file", file, "--yes"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) process.exit(res.status ?? 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const q = (s) => (s == null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);

const members = rows(
  `SELECT m.id, m.name, m.email, m.status,
          (SELECT json_group_array(r.name) FROM member_roles mr JOIN roles r ON r.id = mr.role_id
           WHERE mr.member_id = m.id) roles
   FROM members m`,
);
const swaps = members
  .filter((m) => m.status !== "erased" && !keepsReal(JSON.parse(m.roles)) && !isFake(m.name))
  .map((m) => ({ ...m, fake: fakeName(m.name) }));

// Two people on one made-up name would read as one: stop, rather than muddle them
const taken = new Map(members.filter((m) => !swaps.includes(m)).map((m) => [m.name.toLowerCase(), m.id]));
for (const s of swaps) {
  const key = s.fake.toLowerCase();
  if (taken.has(key)) throw new Error(`Two members would both be ${s.fake} (ids ${taken.get(key)} and ${s.id}).`);
  taken.set(key, s.id);
}

const out = [];
for (const s of swaps) {
  out.push(
    `UPDATE members SET name = ${q(s.fake)}, email = NULL, phone = NULL, bio = '', photo = NULL, web_name = NULL,
       payment_reference = NULL WHERE id = ${s.id};`,
  );
  const { sql, candidates } = assignReferenceSql(s.fake, "id = ?");
  const values = [...candidates, s.id];
  let i = 0;
  out.push(`${sql.replace(/\?/g, () => (typeof values[i] === "number" ? String(values[i++]) : q(values[i++])))};`);
  out.push(
    `UPDATE audit_log SET detail = REPLACE(detail, ${q(s.name)}, ${q(s.fake)}) WHERE instr(detail, ${q(s.name)});`,
  );
  if (s.email)
    out.push(`UPDATE audit_log SET detail = REPLACE(detail, ${q(s.email)}, '') WHERE instr(detail, ${q(s.email)});`);
  out.push(
    `DELETE FROM auth_sessions WHERE member_id = ${s.id};`,
    `DELETE FROM login_challenges WHERE member_id = ${s.id};`,
  );
}
// Who asked about joining, through the website
out.push(
  `UPDATE enquiries SET name = 'Enquirer ' || id, email = 'enquirer-' || id || '@example.com', phone = NULL
   WHERE email NOT LIKE 'enquirer-%@example.com';`,
);
// The club's data changed: the team app reloads it (data_version, ADR 0053)
out.push(
  "INSERT INTO data_version (id, version) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER)) " +
    "ON CONFLICT (id) DO UPDATE SET version = version + 1;",
);
d1(out.join("\n"));
console.log(`Anonymized ${swaps.length} of ${members.length} members (${where.slice(2)}); admins kept.`);
