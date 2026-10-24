#!/usr/bin/env node
// Refuses a secret in `.env` (ADR 0002 point 5, #149): `.env` is for non-secret settings only. Run by `npm run lint`
// and `npm run app`; on its own: node scripts/env-check.mjs [checkout…] (default: this one).
// It prints line numbers and names, never a value.
import { join } from "node:path";
import { envProblems } from "./lib/env-guard.mjs";

const dirs = process.argv.slice(2);
const problems = envProblems(dirs.length ? dirs : [join(import.meta.dirname, "..")]);
for (const p of problems) console.error(p);
if (problems.length) {
  console.error(
    "\n.env is for non-secret settings only (ADR 0002). Store each in Bitwarden (http://localhost:4500/__secrets, or " +
      "npm run secret:set NAME), then delete the line.",
  );
  process.exit(1);
}
