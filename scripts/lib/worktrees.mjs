// Checkouts and their ports (ADR 0115, docs/development.md#worktrees). The main checkout stays on main and holds .worktrees/;
// each task is a branch in its own worktree there. The user's ports (4500 website, 4510 team app, 4520 Studio) belong to
// the show switch (scripts/app-supervisor.mjs), never to an app: every app runs on ports free when it starts.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

/** The apps a checkout runs, each on its well-known port (the one the devcontainer forwards). */
export const SERVICES = {
  web: { port: 4500, label: "website" },
  team: { port: 4510, label: "team app" },
  studio: { port: 4520, label: "Studio" },
};

/**
 * The ports the show switch holds: the well-known ones, or COUGARS_APP_PORTS="web,team,studio" (a test supervisor
 * beside the user's, on other ports).
 */
export function publicPorts(env = process.env) {
  const given = env.COUGARS_APP_PORTS?.split(",").map(Number);
  const names = Object.keys(SERVICES);
  if (given && (given.length !== names.length || given.some((p) => !Number.isInteger(p) || p <= 0)))
    throw new Error(
      `COUGARS_APP_PORTS should be ${names.length} ports (${names.join(",")}), not "${env.COUGARS_APP_PORTS}"`,
    );
  return Object.fromEntries(names.map((name, i) => [name, given?.[i] ?? SERVICES[name].port]));
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** The main checkout, which holds .worktrees/, from anywhere inside any checkout. */
export function mainCheckout(cwd = process.cwd()) {
  return dirname(git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"));
}

/** The checkout `cwd` is in. */
export const checkoutOf = (cwd = process.cwd()) => git(cwd, "rev-parse", "--show-toplevel");

/** A branch's worktree folder: web/sanity-usage → .worktrees/web-sanity-usage. */
export const folderOf = (branch) => branch.replaceAll("/", "-");

/** Every checkout, main first, with its branch (undefined when detached). */
export function checkouts(main) {
  const found = [];
  for (const entry of git(main, "worktree", "list", "--porcelain").split("\n\n")) {
    const dir = /^worktree (.+)$/m.exec(entry)?.[1];
    if (dir) found.push({ dir, branch: /^branch refs\/heads\/(.+)$/m.exec(entry)?.[1] });
  }
  return found;
}

/** `n` distinct ports the OS has free now (held open together, so none repeats). */
export async function freePorts(n) {
  const servers = await Promise.all(
    Array.from(
      { length: n },
      () =>
        new Promise((resolve, reject) => {
          const server = createServer().on("error", reject);
          server.listen(0, "0.0.0.0", () => resolve(server));
        }),
    ),
  );
  const ports = servers.map((s) => s.address().port);
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  return ports;
}

// ---- node_modules, hard-linked from main ------------------------------------------------------------------------

/**
 * What isn't linked: caches that runs rewrite in place (Vite's .vite, .vite-dev and .vite-temp, Astro's .astro,
 * miniflare's .mf, .cache with the dev server's pid file, Sanity's .sanity). A hard-linked file written in place
 * changes main's copy too. npm's own .bin and .package-lock.json are kept: without them it isn't an install.
 */
export const skipEntry = (entry) => entry.startsWith(".") && entry !== ".bin" && entry !== ".package-lock.json";

/** Every node_modules folder of a checkout: the root's and each workspace's, relative paths. */
export function nodeModulesFolders(dir) {
  const { workspaces = [] } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  return ["node_modules", ...workspaces.map((w) => join(w, "node_modules"))];
}

const cpLink = (source, into) => execFileSync("cp", ["-al", source, into], { stdio: ["ignore", "ignore", "pipe"] });

/**
 * Hard-links main's node_modules into a new checkout (instant, no download, no disk), one top-level entry at a time,
 * leaving out the caches. An entry that fails is removed and linked once more; failing again, it throws, naming it.
 */
export function linkNodeModules(main, dir, link = cpLink) {
  const failed = [];
  for (const folder of nodeModulesFolders(main)) {
    const from = join(main, folder);
    if (!existsSync(from)) continue;
    const to = join(dir, folder);
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      if (skipEntry(entry)) continue;
      try {
        link(join(from, entry), to);
      } catch {
        rmSync(join(to, entry), { recursive: true, force: true });
        try {
          link(join(from, entry), to);
        } catch (e) {
          failed.push(`${folder}/${entry}: ${e.stderr?.toString().trim() || e.message}`);
        }
      }
    }
  }
  if (failed.length) throw new Error(`couldn't link from ${main}:\n  ${failed.join("\n  ")}`);
}

/** Ready at once when the lockfile matches main's (hard links); otherwise a real install. */
export function install(main, dir) {
  const lock = (d) => readFileSync(join(d, "package-lock.json"), "utf8");
  if (existsSync(join(main, "node_modules")) && lock(main) === lock(dir)) {
    linkNodeModules(main, dir);
    return "linked";
  }
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit" });
  return "installed";
}
