// Whether a branch is safe to merge, mechanically (ADR 0115, README.md#worktrees).
//
//   npm run merge:check -- <area>/<topic>
//
// In the main checkout. The branch must be on main's tip (a fast-forward) and its worktree clean. `git diff
// main...<branch>` picks the tier (scripts/lib/merge-check.mjs): docs only, a format check of the changed files;
// otherwise lint, the tests, and the checks and builds of the apps the diff reaches. Steps run in two lanes side by
// side, each printing pass or FAIL as it ends; a failure's output is printed whole at the end. It runs in the
// branch's worktree, or a temporary checkout of it (.worktrees/.merge-check-*, removed after): never in the main
// checkout's tree.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STEPS, plan } from "./lib/merge-check.mjs";
import { checkouts, folderOf, install, mainCheckout } from "./lib/worktrees.mjs";

const branch = process.argv[2];
if (!branch || branch.startsWith("-")) {
  console.error("Usage: npm run merge:check -- <area>/<topic>");
  process.exit(2);
}
const main = mainCheckout();
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const ok = (cwd, ...args) => {
  try {
    git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
};

if (branch === "main") fail("main is what we merge into");
if (!ok(main, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`)) fail(`no branch ${branch}`);
if (!ok(main, "merge-base", "--is-ancestor", "main", branch))
  fail(`${branch} isn't on main's tip: git rebase main in its worktree first`);
let tree = checkouts(main).find((c) => c.branch === branch)?.dir;
if (tree === main) fail("that branch is checked out in the main checkout");
if (tree && git(tree, "status", "--porcelain") !== "")
  fail(`${tree} has uncommitted changes: the checks would test those, not the branch`);

const files = git(main, "diff", "--name-only", `main...${branch}`).split("\n").filter(Boolean);
const { tier, steps } = plan(files);
console.log(`merge:check ${branch}: ${files.length} file(s) changed, tier ${tier}`);
if (tier === "none") {
  console.log(`\nNothing to merge: ${branch} is main.`);
  process.exit(0);
}

const temporary = tree ? undefined : checkout();
tree ??= temporary;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => {
    if (temporary) ok(main, "worktree", "remove", "--force", temporary);
    process.exit(130);
  });
console.log(`in ${tree}\n`);

const present = files.filter((f) => existsSync(join(tree, f)));
const format = { name: "format (changed files)", cmd: ["npx", "prettier", "--check", "--ignore-unknown", ...present] };
// Lane one: lint and the tests; lane two: the checks and builds, which share no output with them
const lanes =
  tier === "docs"
    ? [present.length ? [format] : []]
    : [steps.filter((k) => k === "lint" || k === "test"), steps.filter((k) => k !== "lint" && k !== "test")].map(
        (lane) => lane.map((k) => STEPS[k]),
      );

const started = Date.now();
let results;
try {
  results = (await Promise.all(lanes.map(runLane))).flat();
} finally {
  if (temporary) git(main, "worktree", "remove", "--force", temporary);
}
const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`\n── ${r.name} failed: ${r.cmd.join(" ")}\n${r.output}`);
console.log(`\nmerge:check ${branch}: tier ${tier}`);
for (const r of results) console.log(`  ${r.ok ? "pass" : "FAIL"}  ${r.name.padEnd(24)} ${r.seconds.toFixed(1)}s`);
console.log(`  total ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failed.length) {
  console.log(`\nNot safe to merge: ${failed.map((r) => r.name).join(", ")} failed.`);
  process.exit(1);
}
console.log(`\nSafe to merge: git merge --ff-only ${branch}`);

async function runLane(lane) {
  const done = [];
  for (const step of lane) {
    const t = Date.now();
    const { passed, output } = await new Promise((settle) => {
      let output = "";
      const child = spawn(step.cmd[0], step.cmd.slice(1), { cwd: tree });
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("error", (e) => settle({ passed: false, output: output + e.message }));
      child.on("close", (code) => settle({ passed: code === 0, output }));
    });
    const result = { ...step, ok: passed, output, seconds: (Date.now() - t) / 1000 };
    console.log(`${passed ? "pass" : "FAIL"}  ${step.name} (${result.seconds.toFixed(1)}s)`);
    done.push(result);
  }
  return done;
}

/** A detached checkout of the branch, with main's node_modules hard-linked (as `npm run worktree add` does). */
function checkout() {
  const dir = join(main, ".worktrees", `.merge-check-${folderOf(branch)}`);
  if (existsSync(dir)) git(main, "worktree", "remove", "--force", dir);
  git(main, "worktree", "add", "--detach", dir, branch);
  try {
    install(main, dir);
  } catch (error) {
    git(main, "worktree", "remove", "--force", dir);
    fail(`couldn't install the temporary checkout: ${error.message}`);
  }
  return dir;
}

function fail(why) {
  console.error(`merge:check: ${why}\n\nNot safe to merge.`);
  process.exit(1);
}
