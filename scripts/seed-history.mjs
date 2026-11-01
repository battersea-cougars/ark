#!/usr/bin/env node
// A made-up past for a local club (scripts/lib/history.mjs): years of played Kumites and a year of training nights for
// its real local members, so History's pages, past Kumites read on demand and the dues ledger have weight to them.
// Local only: a local D1 (through wrangler, --local) or a SQLite file, never dev's or production's.
//   npm run seed:history                        the checkout the show switch is showing (4510), if it has its own D1
//   npm run seed:history -- --remove            takes all of it away again
//   --kumites N (30)  --weeks N (52)  --seed N (1)
//   --target <worktree | wrangler state folder | .sqlite file>
//   --shared                                    allows main's shared local D1 (every checkout's, by default)
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { leftovers, removeHistory, seedHistory } from "./lib/history.mjs";
import { localState, showPaths } from "./lib/show.mjs";
import { mainCheckout } from "./lib/worktrees.mjs";

const argv = process.argv.slice(2);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const count = (name, fallback) => {
  const v = opt(name) ?? String(fallback);
  if (!/^\d+$/.test(v)) fail(`${name} is a whole number.`);
  return Number(v);
};
function fail(message) {
  console.error(`seed:history: ${message}`);
  process.exit(1);
}
if (argv.includes("--remote")) fail("local only: it never touches dev's or production's D1.");

const main = mainCheckout();
const shared = join(main, "apps", "web", ".wrangler", "state");
const D1_DIR = join("v3", "d1", "miniflare-D1DatabaseObject");

/** The wrangler state folder a checkout's apps use: its own (main, or --own-db), else main's. */
function stateOf(dir) {
  const show = showPaths(main);
  const last = existsSync(show.state) ? JSON.parse(readFileSync(show.state, "utf8")) : {};
  return (
    localState({ dir, main, ownDb: last.checkouts?.[dir]?.ownDb }) ?? join(dir, "apps", "web", ".wrangler", "state")
  );
}

/** Where to write: a SQLite file, or a wrangler state folder. Refuses main's shared one without --shared. */
function targetOf() {
  const given = opt("--target");
  let target;
  if (!given) {
    const show = showPaths(main);
    const shown = existsSync(show.state) ? JSON.parse(readFileSync(show.state, "utf8")).shown : null;
    if (!shown) fail("nothing is shown on 4510 (npm run app status): say --target.");
    target = { state: stateOf(shown), why: `the checkout shown, ${basename(shown)}` };
  } else {
    const path = resolve(given);
    if (!existsSync(path)) fail(`${path} isn't there.`);
    if (statSync(path).isFile()) target = { file: path, why: "a SQLite file" };
    else if (existsSync(join(path, D1_DIR))) target = { state: path, why: "a wrangler state folder" };
    else if (existsSync(join(path, ".git"))) target = { state: stateOf(path), why: `the checkout ${basename(path)}` };
    else fail(`${path} is neither a checkout, a wrangler state folder nor a SQLite file.`);
  }
  const where = target.file ?? target.state;
  if (resolve(where).startsWith(shared) && !argv.includes("--shared"))
    fail(`that's main's shared local D1 (${shared}), every checkout's: add --shared if you mean it.`);
  if (target.state) {
    const dir = join(target.state, D1_DIR);
    if (!existsSync(dir) || !readdirSync(dir).some((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite"))
      fail(`no local D1 in ${target.state} (run its app once first).`);
  }
  return target;
}

/** A SQLite file, opened as D1 has it (foreign keys on). */
function sqliteDb(file) {
  const raw = new Database(file, { fileMustExist: true });
  raw.pragma("foreign_keys = ON");
  return { rows: async (sql) => raw.prepare(sql).all(), run: async (sql) => void raw.exec(sql) };
}

/** A local D1 through wrangler (--local, this state folder): how the apps' own database is written. */
function wranglerDb(state) {
  const web = join(import.meta.dirname, "../apps/web");
  const d1 = (args) => {
    const res = spawnSync(
      "npx",
      ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", state, "--yes", ...args],
      { cwd: web, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
    if (res.status !== 0) fail(`wrangler: ${(res.stderr || res.stdout).trim().split("\n").slice(-3).join(" ")}`);
    return res.stdout;
  };
  return {
    rows: async (sql) => JSON.parse(d1(["--json", "--command", sql]))[0].results,
    // The rows are members' names and money: the file is private and goes once it's run
    run: async (sql) => {
      const dir = mkdtempSync(join(tmpdir(), "seed-history-"));
      try {
        writeFileSync(join(dir, "history.sql"), sql, { mode: 0o600 });
        d1(["--file", join(dir, "history.sql")]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

const target = targetOf();
const db = target.file ? sqliteDb(target.file) : wranglerDb(target.state);
console.log(`seed:history: ${target.why} (${target.file ?? target.state})`);

if (argv.includes("--remove")) {
  const { before, after } = await removeHistory(db);
  console.log(`Removed: ${JSON.stringify(before)}. Left: ${JSON.stringify(after)}.`);
  process.exit(0);
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const options = { today, kumites: count("--kumites", 30), weeks: count("--weeks", 52), seed: count("--seed", 1) };
const { made, rows } = await seedHistory(db, options).catch((e) => fail(e.message));
const k = made.kumites;
const t = made.training;
if (k) console.log(`Kumites: ${k.played} played and ${k.unplayed} never played, ${k.from} to ${k.to}.`);
if (t)
  console.log(
    `Tuesday Skills: ${t.nights} nights (${t.cancelled} cancelled), ${t.from} to ${t.to}; ` +
      `${t.payments} payments, £${(t.paidPence / 100).toFixed(2)}.`,
  );
console.log(
  `Rows: ${Object.entries(rows)
    .map(([table, n]) => `${table} ${n}`)
    .join(", ")}.`,
);
console.log(`Now there: ${JSON.stringify(await leftovers(db))}. Take it away: npm run seed:history -- --remove`);
