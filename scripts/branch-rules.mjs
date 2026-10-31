#!/usr/bin/env node
// The repository's branch rules (ADR 0010), as GitHub rulesets: `main` and `release` can't be force-pushed or
// deleted, and `release`, which deploys production, changes only through a pull request (from `main`) whose PR checks
// pass. No reviews required: the maintainers can't approve their own. Safe to run again: it finds each ruleset by name
// and puts it right.
//   node scripts/branch-rules.mjs
// Needs the GitHub CLI signed in as a repository admin.
import { execFileSync } from "node:child_process";

const REPO = "battersea-cougars/ark";
const gh = (method, path, body) =>
  JSON.parse(
    execFileSync("gh", ["api", "--method", method, path, ...(body ? ["--input", "-"] : [])], {
      input: body && JSON.stringify(body),
      encoding: "utf8",
    }) || "null",
  );

const branches = (...names) => ({ ref_name: { include: names.map((n) => `refs/heads/${n}`), exclude: [] } });
const RULESETS = [
  {
    name: "main and release: no force-push, no deletion",
    target: "branch",
    enforcement: "active",
    conditions: branches("main", "release"),
    rules: [{ type: "non_fast_forward" }, { type: "deletion" }],
  },
  {
    name: "release: by pull request, checks passing",
    target: "branch",
    enforcement: "active",
    conditions: branches("release"),
    rules: [
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
          // A merge commit, so `release` keeps `main`'s commits as they are
          allowed_merge_methods: ["merge"],
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          // pr.yml's one job
          required_status_checks: [{ context: "check" }],
        },
      },
    ],
  },
];

const existing = gh("GET", `repos/${REPO}/rulesets`);
for (const ruleset of RULESETS) {
  const found = existing.find((r) => r.name === ruleset.name);
  if (found) gh("PUT", `repos/${REPO}/rulesets/${found.id}`, ruleset);
  else gh("POST", `repos/${REPO}/rulesets`, ruleset);
  console.log(`${ruleset.name}: ${found ? "put right" : "made"}.`);
}
