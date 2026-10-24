// Which of pr.yml's checks a pull request needs: the same tiers as `npm run merge:check` (scripts/lib/merge-check.mjs,
// ADR 0115), from the files it changes against its base. Docs alone get a format check of those files; code gets
// lint, knip, the tests, and the checks and builds of the apps it can reach.
//
//   node scripts/ci/pr-plan.mjs <base>    tier=… and lint=true, checkWeb=false, … to $GITHUB_OUTPUT
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { STEPS, plan } from "../lib/merge-check.mjs";

const base = process.argv[2];
if (!base) {
  console.error("Usage: node scripts/ci/pr-plan.mjs <base commit>");
  process.exit(2);
}
// Both sides of a move count: a file moved out of an app changes that app too
const files = execFileSync("git", ["diff", "--name-only", "--no-renames", base, "HEAD"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const { tier, steps } = plan(files);
console.log(`${files.length} file(s) changed, tier ${tier}: ${steps.map((k) => STEPS[k].name).join(", ") || "-"}`);

const outputs = [`tier=${tier}`, ...Object.keys(STEPS).map((k) => `${k}=${steps.includes(k)}`)].join("\n") + "\n";
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
else process.stdout.write(outputs);
