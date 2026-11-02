#!/usr/bin/env node
// The team app's journeys (ADR 0031): whole workflows, by role, in a real browser, against a fresh database.
//
//   npm run journeys                     fresh D1, the team app started privately, every journey, the app stopped
//   npm run journeys -- --core           the core run: all but the Kumite on the clock (its played-out Kumites)
//   npm run journeys -- --file-issue     the same, and a run with failures files one GitHub issue (CI always does)
//   npm run journeys -- --keep           leave the app running after (prints its port), to look around
//   npm run journeys -- --a11y           axe over everyone's page at the end of each stage, into .journeys/a11y.md
//   npm run journeys -- --headed         anything else goes to Playwright (--headed, --debug, --ui)
//
// The run itself is Playwright's, through the repo's playwright.config.ts, as VS Code's Testing panel runs it: its
// global setup (journeys.setup.mjs) makes the journeys' own fresh D1 in .journeys/d1 and starts the team app on it on a
// free port, beside the show switch, so any checkout can run them, main's too, and nobody's apps or data are touched.
// Failures never fail the command's caller (exit 0 once it ran): they're reported, in .journeys/summary.md, and in CI
// (or with --file-issue) as one issue for the run.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkoutOf } from "../../../../../scripts/lib/worktrees.mjs";

const root = checkoutOf(import.meta.dirname);
const ci = process.env.CI === "true";
const argv = process.argv.slice(2);
const own = (flag) => (argv.includes(flag) ? (argv.splice(argv.indexOf(flag), 1), true) : false);
const fileIssue = own("--file-issue") || ci;
const keep = own("--keep");
const a11y = own("--a11y");
const core = own("--core");
// The core run (nightly on main, testing.md): everything but the long one, the Kumite on the clock
const only = core ? ["--grep-invert", "The Kumite on the clock"] : [];
const which = core ? "core" : "full";
const out = join(root, ".journeys");
const summary = join(out, "summary.md");

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });
  if (res.status !== 0 && !opts.mayFail) {
    console.error(`journeys: ${cmd} ${args.join(" ")} failed (${res.status})\n${res.stdout ?? ""}${res.stderr ?? ""}`);
    process.exit(1);
  }
  return res;
};
const gh = (...args) => run("gh", args, { mayFail: true });

// The journeys: the global setup starts the app, its teardown stops it (unless --keep)
mkdirSync(out, { recursive: true });
rmSync(summary, { force: true });
rmSync(join(out, "a11y.md"), { force: true });
const t1 = Date.now();
const pw = run("npx", ["playwright", "test", ...only, ...argv], {
  stdio: "inherit",
  mayFail: true,
  env: { ...process.env, JOURNEY_OUT: out, JOURNEY_A11Y: a11y ? "1" : "", JOURNEY_KEEP: keep ? "1" : "" },
});
console.log(`journeys: the ${which} run in ${secs(t1)} (exit ${pw.status})`);
if (a11y) console.log(`journeys: what axe found, stage by stage: ${join(out, "a11y.md")}`);

// The summary, and the one issue for the run
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
  if (gh("label", "list", "--search", "regression", "--json", "name").stdout?.includes('"regression"') !== true)
    gh("label", "create", "regression", "--color", "B60205", "--description", "A journey found something broken");
  const where = process.env.GITHUB_RUN_ID
    ? ` (run ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID})`
    : "";
  const sha = run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const title = `Journeys: failing steps at ${sha}${core ? " (core)" : ""}`;
  // A night with nothing new on main fails the same way again: one issue for a commit, its later runs a comment on it
  if (notedAgain(title, where)) return;
  const res = gh(
    "issue",
    "create",
    "--title",
    title,
    "--label",
    "regression",
    "--body",
    `${readFileSync(summary, "utf8")}\n\nFrom the ${which} \`npm run journeys\` at ${sha}${where}. Fix the code, or change what the journey expects (ADR 0031).`,
  );
  if (res.status === 0) console.log(`journeys: filed ${res.stdout.trim()}`);
  else console.error(`journeys: couldn't file the issue: ${res.stderr}`);
}

/** A comment on the open issue with this title, if there is one: true once it's noted there. */
function notedAgain(title, where) {
  const search = [
    "--label",
    "regression",
    "--state",
    "open",
    "--search",
    `"${title}" in:title`,
    "--json",
    "number,title",
  ];
  const same = JSON.parse(gh("issue", "list", ...search).stdout || "[]").find((i) => i.title === title);
  if (!same) return false;
  const res = gh(
    "issue",
    "comment",
    String(same.number),
    "--body",
    `Failing again${where}.\n\n${readFileSync(summary, "utf8")}`,
  );
  if (res.status === 0) console.log(`journeys: noted again on #${same.number}`);
  else console.error(`journeys: couldn't comment on #${same.number}: ${res.stderr}`);
  return true;
}

function secs(since) {
  return `${((Date.now() - since) / 1000).toFixed(0)}s`;
}
