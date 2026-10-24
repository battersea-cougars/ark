// Show the user a checkout's apps on their ports (ADR 0115, docs/development.md#worktrees): 4500 the website, 4510 the team
// app, 4520 the Studio. The one way to run them: the supervisor (scripts/app-supervisor.mjs) runs each app, keeps it
// up and stops it, so nothing is started with & or nohup, and nothing is left behind.
//
//   npm run app                      this checkout's website and team app, shown on 4500 and 4510
//   npm run app -- studio            any of web, team, studio: just those (the Studio also starts when 4520 is opened)
//   npm run app -- --private         run them without showing them: prints their own ports, for an agent's checks
//   npm run app -- --own-db          this checkout's own local D1 (a copy of main's, for a branch that changes
//                                    db/schema.sql); --shared-db goes back to main's
//   npm run app main                 show the main checkout
//   npm run app status               what's shown and every app (in a browser: localhost:4500/__app)
//   npm run app restart [service]    start this checkout's apps (or one) again
//   npm run app stop [service]       stop this checkout's apps (or one)
//   npm run app logs <service> [--follow]
//   npm run app down                 stop the supervisor and every app
//
//   npm run dev / team / studio      show this checkout, start that app afresh and follow its log (Ctrl-C stops
//                                    following; the app keeps running)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { envProblems } from "./lib/env-guard.mjs";
import { alive, appLog, ask, showPaths, sleep } from "./lib/show.mjs";
import { SERVICES, checkoutOf, mainCheckout, publicPorts } from "./lib/worktrees.mjs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const words = args.filter((a) => !a.startsWith("--"));
const COMMANDS = ["main", "status", "restart", "stop", "logs", "down", "dev"];
const sub = COMMANDS.includes(words[0]) ? words[0] : "show";
const services = words.filter((w) => w in SERVICES);
// Asking for help, or a flag it doesn't know, never shows anything: `npm run app -- --help` once switched 4510 over
if (args.some((a) => ["--help", "-h", "help"].includes(a))) usage("what it does", 0);
const FLAGS = ["--private", "--own-db", "--shared-db", "--follow"];
const unknown = [
  ...words.filter((w) => !(w in SERVICES) && !COMMANDS.includes(w)),
  ...args.filter((a) => a.startsWith("--") && !FLAGS.includes(a)),
];
if (unknown.length) usage(`unknown: ${unknown.join(" ")}`);

const main = mainCheckout();
const here = checkoutOf();
const paths = showPaths(main);
const ports = publicPorts();
const nameOf = (dir) => (dir === main ? "main" : basename(dir));
const t0 = Date.now();
const took = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

/** The supervisor, started (detached, its own session) if it isn't running. */
async function supervisor() {
  try {
    if (!(await ask(paths.sock, { cmd: "status" })).closing) return;
  } catch {
    // not running, or stopping: let it finish first
  }
  if (!(await gone())) throw new Error(`a supervisor is still stopping; see ${paths.log}`);
  mkdirSync(paths.dir, { recursive: true });
  const out = openSync(paths.log, "a");
  spawn(process.execPath, [join(import.meta.dirname, "app-supervisor.mjs")], {
    cwd: main,
    detached: true,
    stdio: ["ignore", out, out],
  }).unref();
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try {
      await ask(paths.sock, { cmd: "status" });
      return;
    } catch {
      // not listening yet
    }
  }
  throw new Error(`the supervisor didn't start; see ${paths.log}`);
}

/**
 * Waits until the supervisor's pid file is gone: it removes it last, once every app is stopped. A pid file whose
 * process isn't running is left by a supervisor that never got to stop (the container restarted): it's gone already.
 */
async function gone() {
  for (let i = 0; i < 300; i++, await sleep(100)) {
    if (!existsSync(paths.pid)) return true;
    const pid = Number(readFileSync(paths.pid, "utf8"));
    if (!pid || !alive(pid)) {
      rmSync(paths.pid, { force: true });
      return true;
    }
  }
  return false;
}

/** Asks, starting a fresh supervisor if the one asked stops meanwhile (another session's `down`). */
async function request(req) {
  for (let i = 0; i < 3; i++) {
    await supervisor();
    try {
      const a = await ask(paths.sock, req);
      if (a.error !== "the supervisor is stopping") return a;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  throw new Error("the supervisor kept stopping");
}

function report(a, swap) {
  for (const app of a.apps ?? []) {
    const where = swap
      ? `http://localhost:${ports[app.service]}/ (its own port ${app.port})`
      : `http://localhost:${app.port}/`;
    console.log(`app: ${app.label} ${app.ok ? "up" : app.state}: ${where}${app.note ? ` (${app.note})` : ""}`);
    if (!app.ok && app.log) console.log(app.log.replace(/^/gm, "    "));
  }
  if (!a.ok) process.exitCode = 1;
}

function follow(service, lines = 30) {
  const file = appLog(paths, here, service);
  const t = spawn("tail", ["-n", String(lines), ...(flag("--follow") || sub === "dev" ? ["-F"] : []), file], {
    stdio: "inherit",
  });
  process.on("SIGINT", () => t.kill());
  return new Promise((done) => t.on("exit", done));
}

switch (sub) {
  case "show":
  case "main":
  case "dev": {
    const dir = sub === "main" ? main : here;
    const swap = !flag("--private");
    const ownDb = flag("--own-db") ? true : flag("--shared-db") ? false : undefined;
    if (sub === "dev" && services.length !== 1) usage("dev takes one of web, team, studio");
    refuseSecretsInEnv([...new Set([main, here])]);
    if (swap)
      console.log(`app: ${Object.values(ports).join("/")} now show ${nameOf(dir)} (each says so while it starts)`);
    const a = await request({
      cmd: "show",
      dir,
      swap,
      ownDb,
      services: services.length ? services : undefined,
      fresh: sub === "dev",
    });
    if (a.error) throw new Error(a.error);
    console.log(`app: ${a.name} in ${took()}${dir !== main ? (ownDb ? ", its own local D1" : "") : ""}`);
    report(a, swap);
    if (sub === "dev") {
      console.log(
        `app: its log follows. Ctrl-C stops following; the ${SERVICES[services[0]].label} keeps running ` +
          `(npm run app stop ${services[0]}; every checkout: http://localhost:${ports.web}/__app)\n`,
      );
      await follow(services[0], 15);
    }
    break;
  }
  case "restart":
  case "stop": {
    const a = await request({ cmd: sub, dir: here, services: services.length ? services : undefined });
    if (a.error) throw new Error(a.error);
    if (sub === "stop") console.log(`app: stopped ${services.join(", ") || "every app"} of ${nameOf(here)}`);
    else report(a, false);
    break;
  }
  case "logs":
    if (services.length !== 1) usage("logs takes one of web, team, studio");
    if (!existsSync(appLog(paths, here, services[0]))) throw new Error(`no log yet for ${services[0]} here`);
    await follow(services[0], 60);
    break;
  case "status": {
    const s = await request({ cmd: "status" });
    console.log(
      `${Object.entries(s.ports)
        .map(([k, p]) => `${p} ${k}`)
        .join(
          ", ",
        )} show ${s.shown ? nameOf(s.shown) : "nothing"}   (supervisor pid ${s.supervisor}, log ${paths.log})`,
    );
    for (const c of s.checkouts) {
      console.log(`${c.shown ? "→" : " "} ${c.name}${c.ownDb ? " (own D1)" : ""}  ${c.dir}`);
      for (const a of c.apps)
        console.log(
          `    ${a.service.padEnd(7)} ${a.state.padEnd(9)} port ${a.port}  pid ${a.pid ?? "-"}  idle ${a.idle}m${a.note ? `  ${a.note}` : ""}`,
        );
    }
    break;
  }
  case "down": {
    try {
      await ask(paths.sock, { cmd: "down" });
    } catch {
      console.log("app: the supervisor wasn't running");
      break;
    }
    if (!(await gone())) throw new Error(`the supervisor didn't stop in 30s; see ${paths.log}`);
    console.log("app: the supervisor and every app stopped");
    break;
  }
}

/** A secret in .env stops the apps starting (ADR 0002, #149): it says where, never what. */
function refuseSecretsInEnv(dirs) {
  const problems = envProblems(dirs);
  if (!problems.length) return;
  for (const p of problems) console.error(`app: ${p}`);
  console.error(
    "app: .env is for non-secret settings only. Store each in Bitwarden (localhost:4500/__secrets), then delete the line.",
  );
  process.exit(1);
}

function usage(why, code = 2) {
  console.error(`app: ${why}`);
  console.error(
    "Usage: npm run app [-- [web|team|studio…] [--private] [--own-db|--shared-db]]\n" +
      "       npm run app main|status|down\n" +
      "       npm run app restart|stop [web|team|studio]\n" +
      "       npm run app logs <web|team|studio> [--follow]",
  );
  process.exit(code);
}
