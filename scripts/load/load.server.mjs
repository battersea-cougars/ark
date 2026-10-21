// A team Worker of the load run's own (docs/load-testing.md): the built Worker under `wrangler dev`, on a port the OS
// picks, with its own D1 in a fresh temp folder (never main's local D1, never dev or production), seeded with the
// club's schema and seed and a roster of `members`. Signed in the way scripts/dev-sign-in.mjs does (POST
// /api/auth/dev, a local server only), never by asking for codes; or, with `roster: false` (`--target local`), as
// against dev: the run adds its own members and mints their sessions into this D1 (`d1db`, load.club.mjs). The
// workerd process's CPU time is read from /proc.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRoster, rosterSql } from "../lib/roster.mjs";
import { loadRoster } from "./load.club.mjs";

const ROOT = join(import.meta.dirname, "../..");
const DIST = join(ROOT, "apps/team/dist/cougars_team");

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

/** Every process under `pid` (its children, theirs…). */
function descendants(pid) {
  const out = [];
  for (const p of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const stat = readFileSync(`/proc/${p}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (ppid === pid) out.push(Number(p), ...descendants(Number(p)));
    } catch {
      // gone meanwhile
    }
  }
  return out;
}
const TICK_MS = 1000 / Number(sh("getconf", ["CLK_TCK"]).trim() || 100);
/** CPU time (user + system) of a process so far, in ms. */
function cpuMs(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return (Number(f[11]) + Number(f[12])) * TICK_MS;
  } catch {
    return 0;
  }
}

export async function startServer({ members = 120, build = true, roster: seedRoster = true, log = console.log } = {}) {
  if (build || !existsSync(join(DIST, "index.js"))) {
    log("Building the team app…");
    sh("npm", ["run", "build", "-w", "@cougars/team"]);
  }
  // The wrapper that counts D1's rows, beside the built Worker, with a config naming it
  copyFileSync(join(import.meta.dirname, "load.worker.mjs"), join(DIST, "load-worker.js"));
  const built = JSON.parse(readFileSync(join(DIST, "wrangler.json"), "utf8"));
  const config = join(DIST, "load.wrangler.json");
  writeFileSync(config, JSON.stringify({ ...built, main: "load-worker.js" }, null, 2));

  // Its own D1, in a folder of its own
  const state = mkdtempSync(join(tmpdir(), "cougars-load-"));
  const roster = loadRoster(members);
  writeFileSync(join(state, "roster.sql"), rosterSql(parseRoster(JSON.stringify(roster)), new Date()));
  const execute = (...how) =>
    sh("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", state, "-c", config, "--yes", ...how]);
  const files = [join(ROOT, "db/schema.sql"), join(ROOT, "db/seed/club.sql")];
  for (const file of seedRoster ? [...files, join(state, "roster.sql")] : files) execute("--file", file);
  log(
    seedRoster ? `Seeded ${members} members into ${state}` : `Seeded the club (no members of the run's) into ${state}`,
  );
  /** This D1 as load.club.mjs reaches a database: `run` a script, the `rows` of one SELECT. */
  let n = 0;
  const d1db = {
    name: `local D1 in ${state}`,
    run(sql) {
      const file = join(state, `run-${n++}.sql`);
      writeFileSync(file, sql);
      execute("--file", file);
    },
    rows(sql) {
      const [answer] = JSON.parse(execute("--json", "--command", sql));
      return answer.results;
    },
  };

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "-c",
      config,
      "--persist-to",
      state,
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--var",
      "TEAM_ENV:local",
      "--test-scheduled",
      "--log-level",
      "error",
      "--show-interactive-dev-session=false",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } },
  );
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      // not up yet
    }
    if (i > 120 || child.exitCode !== null) throw new Error(`wrangler dev didn't start:\n${output}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  log(`Team Worker on ${url} (wrangler dev, pid ${child.pid})`);

  /** The workerd processes serving it: their CPU, all told. */
  const workerd = () =>
    descendants(child.pid).filter((p) => {
      try {
        return readFileSync(`/proc/${p}/cmdline`, "utf8").includes("workerd");
      } catch {
        return false;
      }
    });
  const cpu = () => workerd().reduce((n, p) => n + cpuMs(p), 0);
  const d1 = async (reset = false) => (await fetch(`${url}/api/__load/d1`, { method: reset ? "POST" : "GET" })).json();

  async function stop({ keep = false } = {}) {
    // Our own processes only, by PID
    for (const p of [...descendants(child.pid).reverse(), child.pid]) {
      try {
        process.kill(p, "SIGTERM");
      } catch {
        // already gone
      }
    }
    if (!keep) rmSync(state, { recursive: true, force: true });
    else log(`Kept its D1 in ${state}`);
  }

  return { url, roster, state, cpu, d1, d1db, stop, output: () => output };
}
