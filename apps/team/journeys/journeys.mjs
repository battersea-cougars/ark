#!/usr/bin/env node
// The team app's journeys (ADR 0124): whole workflows, by role, in a real browser, against a fresh database.
//
//   npm run journeys                     fresh D1, the team app started privately, every journey, the app stopped
//   npm run journeys -- --file-issue     the same, and a run with failures files one GitHub issue (CI always does)
//   npm run journeys -- --keep           leave the app running after (prints its port), to look around
//   npm run journeys -- --headed         anything else goes to Playwright (--headed, --debug, --ui)
//
// The database is this checkout's own (`npm run app -- --own-db`), wiped and made again from db/schema.sql, the club
// seed and the journeys' made-up roster (journeys.roster.json), every run. So it refuses to run in the main checkout,
// whose D1 is everyone's, except in CI, where nothing else is there. Ports 4500/4510/4520 are never touched: the app
// runs on its own private port. Failures never fail the command's caller (exit 0 once it ran): they're reported, in
// .journeys/summary.md, and in CI (or with --file-issue) as one issue for the run.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRoster, rosterSql } from "../../../scripts/lib/roster.mjs";
import { checkoutOf, mainCheckout } from "../../../scripts/lib/worktrees.mjs";

const root = checkoutOf(import.meta.dirname);
const ci = process.env.CI === "true";
const argv = process.argv.slice(2);
const own = (flag) => (argv.includes(flag) ? (argv.splice(argv.indexOf(flag), 1), true) : false);
const fileIssue = own("--file-issue") || ci;
const keep = own("--keep");
const out = join(root, ".journeys");
const summary = join(out, "summary.md");

if (root === mainCheckout(root) && !ci) {
  console.error(
    "journeys: not in the main checkout: they start its local D1 afresh, and that one is everyone's.\n" +
      "Run them in a worktree (npm run worktree -- add team/<topic>), whose D1 is its own (--own-db).",
  );
  process.exit(2);
}

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });
  if (res.status !== 0 && !opts.mayFail) {
    console.error(`journeys: ${cmd} ${args.join(" ")} failed (${res.status})\n${res.stdout ?? ""}${res.stderr ?? ""}`);
    process.exit(1);
  }
  return res;
};
const app = (...args) => run("node", [join(root, "scripts/app.mjs"), ...args]);

// Nor in the checkout 4500/4510 show: that's the one being reviewed, and its D1 is someone's copy of the club
const shown = run("node", [join(root, "scripts/app.mjs"), "status"], { mayFail: true }).stdout ?? "";
if (!ci && shown.split("\n").some((line) => line.startsWith("→") && line.trimEnd().endsWith(` ${root}`))) {
  console.error(
    "journeys: not in the checkout 4500/4510 show: they'd stop it and start its D1 afresh, and that copy is being\n" +
      "reviewed. Run them in another worktree, or show another checkout first.",
  );
  process.exit(2);
}

// 1. A fresh database: the app stopped first (it holds the files), the checkout's own D1 removed and made again
const t0 = Date.now();
app("stop", "team");
const state = join(root, "apps/web/.wrangler/state");
rmSync(state, { recursive: true, force: true });
run("node", [join(root, "scripts/db-rebuild.mjs"), "--local"]);
const tmp = mkdtempSync(join(tmpdir(), "journeys-"));
try {
  const roster = parseRoster(readFileSync(join(import.meta.dirname, "journeys.roster.json"), "utf8"));
  writeFileSync(join(tmp, "roster.sql"), rosterSql(roster));
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--local",
    "-c",
    join(root, "apps/web/wrangler.jsonc"),
    "--file",
    join(tmp, "roster.sql"),
    "--yes",
  ]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`journeys: a fresh D1 (schema, club seed, journeys.roster.json) in ${secs(t0)}`);

// 2. The team app on its own port, on that database
const started = app("--private", "--own-db", "team");
const port = /team app up: http:\/\/localhost:(\d+)\//.exec(started.stdout)?.[1];
if (!port) {
  console.error(`journeys: the team app didn't start\n${started.stdout}${started.stderr}`);
  process.exit(1);
}
console.log(`journeys: the team app on http://localhost:${port}/`);

// 3. The journeys
mkdirSync(out, { recursive: true });
rmSync(summary, { force: true });
const t1 = Date.now();
const pw = run("npx", ["playwright", "test", "-c", join(import.meta.dirname, "journeys.config.ts"), ...argv], {
  stdio: "inherit",
  mayFail: true,
  env: { ...process.env, JOURNEY_PORT: port, JOURNEY_OUT: out },
});
console.log(`journeys: ran in ${secs(t1)} (exit ${pw.status})`);

// 4. Stopped, unless asked to keep it; in CI the switch it started goes too
if (keep) console.log(`journeys: the team app stays up on http://localhost:${port}/ (npm run app stop team)`);
else app("stop", "team");
if (ci) app("down");

// 5. The summary, and the one issue for the run
const failed = existsSync(summary);
if (!failed && pw.status !== 0) {
  console.error("journeys: Playwright failed before any step reported (see its output above)");
  process.exit(1);
}
if (!failed) {
  console.log("journeys: no step failed");
  process.exit(0);
}
console.log(`\n${readFileSync(summary, "utf8")}\njourneys: the summary is ${summary}`);
if (fileIssue) fileTheIssue();
else console.log("journeys: no issue filed (npm run journeys -- --file-issue to file one)");

function fileTheIssue() {
  const gh = (...args) => run("gh", args, { mayFail: true });
  if (gh("label", "list", "--search", "regression", "--json", "name").stdout?.includes('"regression"') !== true)
    gh("label", "create", "regression", "--color", "B60205", "--description", "A journey found something broken");
  const where = process.env.GITHUB_RUN_ID
    ? ` (run ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID})`
    : "";
  const sha = run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const res = gh(
    "issue",
    "create",
    "--title",
    `Journeys: failing steps at ${sha}`,
    "--label",
    "regression",
    "--body",
    `${readFileSync(summary, "utf8")}\n\nFrom \`npm run journeys\` at ${sha}${where}. Fix the code, or change what the journey expects (ADR 0124).`,
  );
  if (res.status === 0) console.log(`journeys: filed ${res.stdout.trim()}`);
  else console.error(`journeys: couldn't file the issue: ${res.stderr}`);
}

function secs(since) {
  return `${((Date.now() - since) / 1000).toFixed(0)}s`;
}
