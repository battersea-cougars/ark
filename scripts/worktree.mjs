// One task, one worktree (ADR 0115, docs/development.md#worktrees).
//
//   npm run worktree -- add <area>/<topic> [base]   a branch off base (main) in .worktrees/<area>-<topic>, ready at
//                                                   once: main's node_modules hard-linked when the lockfile matches
//   npm run worktree -- remove <area>/<topic>       its apps stopped, the worktree removed (only if clean), and the
//                                                   branch deleted if it's merged
//
// `git worktree list` lists them.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ask, showPaths } from "./lib/show.mjs";
import { folderOf, install, mainCheckout } from "./lib/worktrees.mjs";

const [command, branch, base = "main"] = process.argv.slice(2);
const main = mainCheckout();
const run = (cwd, cmd, ...args) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

switch (command) {
  case "add": {
    if (!/^[\w.-]+\/[\w./-]+$/.test(branch ?? "")) usage();
    const dir = join(main, ".worktrees", folderOf(branch));
    if (existsSync(dir)) throw new Error(`${dir} already exists`);
    run(main, "git", "worktree", "add", "-b", branch, dir, base);
    const how = install(main, dir);
    // .env holds local, non-secret overrides only (ADR 0002), so it's safe to copy
    if (existsSync(join(main, ".env"))) copyFileSync(join(main, ".env"), join(dir, ".env"));
    console.log(
      `\n${branch} in ${dir} (node_modules ${how})\n` +
        "cd there, then npm run app (to show the user on 4500/4510) or npm run app -- --private (your own checks).\n" +
        "Its apps use main's local D1; a branch that changes db/schema.sql: npm run app -- --own-db.",
    );
    break;
  }
  case "remove": {
    if (!branch) usage();
    const dir = join(main, ".worktrees", folderOf(branch));
    // Its apps go first, if the show supervisor runs any
    await ask(showPaths(main).sock, { cmd: "stop", dir }).catch(() => undefined);
    try {
      run(main, "git", "worktree", "remove", dir);
    } catch {
      console.error(`Kept ${dir}: it has changes or untracked files (git status there). Its apps are stopped.`);
      process.exit(1);
    }
    try {
      run(main, "git", "branch", "-d", branch);
    } catch {
      console.log(`Kept the branch ${branch}: it isn't merged.`);
    }
    break;
  }
  default:
    usage();
}

function usage() {
  console.error("Usage: npm run worktree -- add <area>/<topic> [base] | remove <area>/<topic>");
  process.exit(2);
}
