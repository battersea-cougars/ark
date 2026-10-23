#!/usr/bin/env node
// What the website takes from the club's D1 at build time (ADR 0043, ADR 0044), each into its own gitignored file under
// apps/web/src/data/ (the roster is personal data, ADR 0029). Run before `astro dev` and `astro build` (apps/web's
// predev/prebuild). Only what the website shows leaves the database.
//   roster.local.json   the active Cougars and their record (lib/roster-sql.mjs)
//   kumite.local.json   a Kumite's own awards, and the next one's date and place (lib/kumite-sql.mjs, ADR 0042)
//   results.local.json  every public tournament's results, as rows (lib/results-sql.mjs, ADR 0100)
//
//   node scripts/club-snapshot.mjs                   local D1 (apps/web/.wrangler, or COUGARS_LOCAL_STATE's)
//   CLUB_SNAPSHOT_ENV=dev|production node ...       that environment's D1, over the API (CI: CLOUDFLARE_API_TOKEN
//                                                    and CLOUDFLARE_ACCOUNT_ID for its account)
// Never fails a build: whatever can't be read is written as null, and the site falls back (Sanity, samples). An empty
// list is a real answer (no Cougars yet).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { readResultRows } from "./lib/results-sql.mjs";
import { ROSTER_SQL } from "./lib/roster-sql.mjs";
import { kumiteFrom, kumiteSql } from "./lib/kumite-sql.mjs";
import { remoteD1 } from "./lib/d1-api.mjs";

const SNAPSHOTS = {
  roster: { sql: ROSTER_SQL, shape: (rows) => rows, say: (r) => `${r.length} Cougars` },
  // Several queries at once (no `sql`): their rows by name
  results: { sql: null, shape: (rows) => rows, say: (r) => `${r.tournaments.length} public tournaments` },
  kumite: {
    // The next one's date and place, and a Kumite's own awards: the next public one's, else the last held's
    sql: kumiteSql(),
    shape: kumiteFrom,
    say: (k) => `${k.awards.length} Kumite awards, next ${k.next ? k.next.season || k.next.startsAt : "not set"}`,
  },
};
const web = new URL("../apps/web/", import.meta.url);

// A worktree's site under the show switch reads main's local D1 (COUGARS_LOCAL_STATE, ADR 0115)
const persist = process.env.COUGARS_LOCAL_STATE ? ["--persist-to", process.env.COUGARS_LOCAL_STATE] : [];
const localQuery = async (sql) =>
  JSON.parse(
    execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", ...persist, "--json", "--command", sql], {
      cwd: web,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  )[0].results;

const environment = process.env.CLUB_SNAPSHOT_ENV;
let query = localQuery;
try {
  if (environment) query = await remoteD1(environment);
} catch (error) {
  query = () => Promise.reject(error);
}
mkdirSync(new URL("src/data/", web), { recursive: true });
for (const [name, { sql, shape, say }] of Object.entries(SNAPSHOTS)) {
  let data = null;
  try {
    data = shape(sql ? await query(sql) : await readResultRows(query));
  } catch (error) {
    console.warn(`Club snapshot: no ${name} (${error.message.split("\n")[0]}). The site falls back.`);
  }
  writeFileSync(new URL(`src/data/${name}.local.json`, web), JSON.stringify(data, null, 2) + "\n");
  if (data) console.log(`Club snapshot: ${say(data)}.`);
}
