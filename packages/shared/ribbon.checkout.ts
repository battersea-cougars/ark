import { execFileSync } from "node:child_process";

// The checkout a dev server runs from, for the LOCAL ribbon (ribbon.ts, ADR 0010): read once from git when the dev
// server starts, never by a deploy's build. Node only: the website's and team app's configs call it, Vite's loading
// the team's as it is, so it imports nothing of ours (a Checkout, ribbon.ts, is this shape).

interface Checkout {
  branch: string;
  ownData: boolean;
}

/**
 * Which checkout this is. `branch` is git's (a short commit when detached); `linked` is a worktree rather than main's
 * checkout; `sharedState` is the show switch's COUGARS_LOCAL_STATE, set when a worktree's app uses main's local D1
 * (ADR 0115). Main's checkout's D1 is the shared one, so only a worktree without it is on its own data.
 */
export function checkoutFrom(
  git: { branch: string; commit: string; linked: boolean },
  sharedState: string | undefined,
): Checkout {
  return { branch: git.branch === "HEAD" ? git.commit : git.branch, ownData: git.linked && !sharedState };
}

/** This process's checkout, or null without git (a tarball). */
export function localCheckout(cwd = process.cwd()): Checkout | null {
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["rev-parse", ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const [gitDir, commonDir] = git("--path-format=absolute", "--git-dir", "--git-common-dir").split("\n");
    const branch = git("--abbrev-ref", "HEAD");
    const commit = branch === "HEAD" ? git("--short", "HEAD") : "";
    return checkoutFrom({ branch, commit, linked: gitDir !== commonDir }, process.env.COUGARS_LOCAL_STATE);
  } catch {
    return null;
  }
}
