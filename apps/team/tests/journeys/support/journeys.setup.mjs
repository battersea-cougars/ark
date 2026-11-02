// The journeys' global setup (ADR 0031), for `npm run journeys` and VS Code's Testing panel alike: a fresh database of
// their own, the team app started on it on a free port, and a teardown that stops it.
//
// Nothing here is a checkout's own, so it's safe in any checkout, main's too: the database is .journeys/d1 (never
// apps/web/.wrangler, the D1 a checkout's apps and everyone else's use), Vite's cache is .journeys/vite (never the one
// the checkout's own dev server rebuilds), and the app runs beside the show switch (ADR 0115) on a port the OS picks,
// never on 4500/4510/4520 and never through it, so the apps it runs are left alone.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { join } from "node:path";
import { databaseFiles } from "../../../../../scripts/lib/database.mjs";
import { parseRoster, rosterSql } from "../../../../../scripts/lib/roster.mjs";
import { freePorts } from "../../../../../scripts/lib/worktrees.mjs";

const root = join(import.meta.dirname, "../../../../..");
const out = process.env.JOURNEY_OUT ?? join(root, ".journeys");
const state = join(out, "d1");
const pidFile = join(out, "app.pid");
const logFile = join(out, "app.log");
const START_MS = 180_000;

export default async function journeysSetup() {
  mkdirSync(out, { recursive: true });
  await stopLeftOver();
  const t0 = Date.now();
  freshDatabase();
  console.log(`journeys: a fresh D1 (schema or migrations, club seed, journeys.roster.json) in ${secs(t0)}`);
  const [port] = await freePorts(1);
  const app = startApp(port);
  await answering(app, port);
  console.log(`journeys: the team app on http://localhost:${port}/`);
  // The journeys read these (journey.ts); Playwright hands them to its workers
  process.env.JOURNEY_PORT = String(port);
  process.env.JOURNEY_STATE = state;
  return () => stopApp(app, port);
}

/** The journeys' D1 made again: the schema and the club seed (after launch, the migrations), then the made-up roster. */
function freshDatabase() {
  rmSync(state, { recursive: true, force: true });
  const roster = rosterSql(parseRoster(readFileSync(join(import.meta.dirname, "journeys.roster.json"), "utf8")));
  const sql = join(out, "fresh.sql");
  writeFileSync(sql, [...databaseFiles().map((f) => readFileSync(f, "utf8")), roster].join("\n;\n"));
  const res = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", state, "-c", "apps/web/wrangler.jsonc"].concat([
      "--file",
      sql,
      "--yes",
    ]),
    { cwd: root, encoding: "utf8" },
  );
  rmSync(sql, { force: true });
  if (res.status !== 0) throw new Error(`journeys: the fresh D1 failed (${res.status})\n${res.stdout}${res.stderr}`);
}

/** Vite in apps/team, in a process group of its own (so stopping it stops workerd too), its output in app.log. */
function startApp(port) {
  const log = openSync(logFile, "w");
  const app = spawn(
    process.execPath,
    [join(root, "node_modules/vite/bin/vite.js"), "--port", String(port), "--strictPort"],
    {
      cwd: join(root, "apps/team"),
      detached: true,
      stdio: ["ignore", log, log],
      // vite.config.ts: the journeys' database and Vite cache, and no taking over 4510
      env: { ...process.env, COUGARS_JOURNEYS: out },
    },
  );
  closeSync(log);
  app.unref();
  writeFileSync(pidFile, String(app.pid));
  return app;
}

/** Until the app answers; it exiting or not answering in time fails the setup, with the end of its log. */
async function answering(app, port) {
  let exited = null;
  app.once("exit", (code) => (exited = code ?? "a signal"));
  for (const end = Date.now() + START_MS; Date.now() < end; await sleep(500)) {
    if (exited !== null) throw new Error(`journeys: the team app exited (${exited})\n${logTail()}`);
    if (await answers(port)) return;
  }
  stopGroup(app.pid);
  throw new Error(`journeys: the team app didn't answer in ${START_MS / 1000}s\n${logTail()}`);
}

/** The teardown: the app stopped, unless `npm run journeys -- --keep` asked to leave it up. */
async function stopApp(app, port) {
  if (process.env.JOURNEY_KEEP === "1") {
    console.log(
      `journeys: the team app stays up on http://localhost:${port}/ (kill -- -${app.pid} stops it; so does the next run)`,
    );
    return;
  }
  await stopGroup(app.pid);
  rmSync(pidFile, { force: true });
}

/** A team app an earlier run left up (--keep, or a run stopped half way): only ever the journeys' own Vite. */
async function stopLeftOver() {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8"));
  rmSync(pidFile, { force: true });
  if (!commandLine(pid).includes("vite")) return; // gone, or not ours
  console.log(`journeys: stopping the team app an earlier run left up (process ${pid})`);
  await stopGroup(pid);
}

function commandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return "";
  }
}

async function stopGroup(pid) {
  const signal = (sig) => {
    try {
      process.kill(-pid, sig);
      return true;
    } catch {
      return false; // the group's gone
    }
  };
  if (!signal("SIGTERM")) return;
  for (const end = Date.now() + 5000; Date.now() < end; await sleep(100)) if (!signal(0)) return;
  signal("SIGKILL");
}

const answers = (port) =>
  new Promise((done) => {
    const req = get(
      { host: "127.0.0.1", port, path: "/favicon.ico", timeout: 5000 },
      (res) => (res.resume(), done(true)),
    );
    req.on("error", () => done(false));
    req.on("timeout", () => (req.destroy(), done(false)));
  });

function logTail() {
  try {
    return readFileSync(logFile, "utf8").trimEnd().split("\n").slice(-30).join("\n");
  } catch {
    return "";
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const secs = (since) => `${((Date.now() - since) / 1000).toFixed(0)}s`;
