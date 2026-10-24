// The show supervisor (ADR 0115, docs/development.md#worktrees): the one process that runs every checkout's apps. Started by
// `npm run app` (or npm run dev / team / studio) when it isn't running; never by hand.
//
// It holds the user's ports (website 4500, team app 4510, Studio 4520) as a switch: each request, hot reload's
// websocket included, goes to the app of whichever checkout is shown, so showing another one is instant. Every app is
// its own child, a session of its own on a free private port, and only this process stops one, the whole session at
// once, so nothing it started outlives it:
// - it stops them all when it's stopped (`npm run app down`, TERM, INT, HUP or a crash);
// - started again after being killed outright, it first stops whatever its last run left;
// - an app whose checkout is gone stops, and so does a branch's app nobody has shown or asked for in IDLE_MS
//   (main's never, nor the one shown);
// - an app that crashes starts again, waiting longer each time; one that stops answering for STUCK_MS too.
import { spawn } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer as http, get } from "node:http";
import { createServer as net } from "node:net";
import { basename, join } from "node:path";
import { ensureToken, listSecrets, setSecret } from "./lib/bitwarden.mjs";
import { stopDevServerOn } from "./lib/dev-server.mjs";
import {
  OWNER_ENV,
  alive,
  appEnv,
  appLog,
  envOf,
  forward,
  forwardUpgrade,
  localState,
  proc,
  procs,
  showPaths,
  sleep,
  stopSession,
  stopTree,
  target,
  toStop,
} from "./lib/show.mjs";
import { documentedNames } from "./lib/secret-names.mjs";
import { secretsPage } from "./lib/secrets-page.mjs";
import { holdingPage, panelPage } from "./lib/show.pages.mjs";
import { SERVICES, checkouts, freePorts, mainCheckout, publicPorts } from "./lib/worktrees.mjs";

const START_MS = 180_000;
const STUCK_MS = 45_000;
const MAX_CRASHES = 5;
const main = mainCheckout(import.meta.dirname);
const paths = showPaths(main);
const PORTS = publicPorts();

// How each app runs, in its checkout, on its private port. The website first writes its club snapshot (as its
// predev did); --ignore-lock keeps Astro from backgrounding itself or being stopped by `astro dev stop`.
const RUN = {
  web: {
    cwd: "apps/web",
    secrets: true,
    probe: "/favicon.ico",
    cmd: (port) => ["sh", "-c", `node ../../scripts/club-snapshot.mjs; exec astro dev --port ${port} --ignore-lock`],
  },
  team: {
    cwd: "apps/team",
    secrets: true,
    probe: "/favicon.ico",
    cmd: (port) => ["vite", "--port", `${port}`, "--strictPort"],
  },
  studio: {
    cwd: "apps/studio",
    secrets: false,
    probe: "/",
    cmd: (port) => ["sanity", "dev", "--port", `${port}`, "--host", "0.0.0.0"],
  },
};

/** Every app, by "<checkout>#<service>". */
const apps = new Map();
/** Per checkout: { ownDb } (its own local D1 instead of main's). */
const options = new Map();
let shown = null;
let closing = false;

const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const keyOf = (dir, service) => `${dir}#${service}`;
/** The checkout's branch, as people know it (web/sanity-usage, main); read from git at most every 10 s. */
let branches = { at: 0, of: new Map() };
function branchOf(dir) {
  if (Date.now() - branches.at > 10_000)
    branches = { at: Date.now(), of: new Map(checkouts(main).map((c) => [c.dir, c.branch])) };
  return branches.of.get(dir) ?? basename(dir);
}
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

/** The end of an app's log, plain text (its terminal colours stripped), read from the last 64 KB only. */
function tail(app, lines = 40) {
  try {
    const file = appLog(paths, app.dir, app.service);
    const size = statSync(file).size;
    const length = Math.min(size, 65_536);
    const buf = Buffer.alloc(length);
    const fd = openSync(file, "r");
    readSync(fd, buf, 0, length, size - length);
    closeSync(fd);
    return buf.toString("utf8").replace(COLOUR, "").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

const save = () =>
  writeFileSync(
    paths.state,
    JSON.stringify({
      shown,
      checkouts: Object.fromEntries(
        [...new Set([...apps.values()].map((a) => a.dir))].map((dir) => [
          dir,
          { ...options.get(dir), services: [...apps.values()].filter((a) => a.dir === dir).map((a) => a.service) },
        ]),
      ),
    }),
  );

// ---- secrets ----------------------------------------------------------------------------------------------------

// The dev secrets, when your Bitwarden vault is unlocked (bw-unlock): each app then runs through env-pull.mjs, as
// `node scripts/env-pull.mjs -- npm run dev` did. Nobody is asked for a password here; locked, the apps run without.
let lockedUntil = 0;
function secretsAvailable() {
  if (process.env.BWS_ACCESS_TOKEN || process.env.COUGARS_LOCAL_BW_TOKEN) return true;
  if (Date.now() < lockedUntil) return false;
  try {
    ensureToken();
    return true;
  } catch {
    lockedUntil = Date.now() + 5 * 60_000;
    return false;
  }
}

/** The vault's token read again (after bw-unlock, or once it's changed), keeping the old one if that fails. */
function reconnect() {
  const old = { token: process.env.COUGARS_LOCAL_BW_TOKEN, session: process.env.BW_SESSION };
  delete process.env.COUGARS_LOCAL_BW_TOKEN;
  delete process.env.BW_SESSION;
  try {
    ensureToken();
    lockedUntil = 0;
  } catch (e) {
    if (old.token) process.env.COUGARS_LOCAL_BW_TOKEN = old.token;
    if (old.session) process.env.BW_SESSION = old.session;
    throw e;
  }
}

// The Secrets page (/__secrets, #149): hands a value to Bitwarden from this process, then restarts what reads them
const secrets = secretsPage({
  bitwarden: {
    list: () => (ensureToken(), listSecrets()),
    set: (name, value) => (ensureToken(), setSecret(name, value)),
    reconnect,
  },
  names: () => documentedNames(readFileSync(join(main, "docs", "secrets.md"), "utf8")),
  restart: restartForSecrets,
  log,
});

/** Every running app that reads secrets, started again so it has the new ones. */
async function restartForSecrets() {
  const readers = [...apps.values()].filter((a) => RUN[a.service].secrets && (a.child || a.restart));
  const out = [];
  for (const dir of new Set(readers.map((a) => a.dir))) {
    const services = readers.filter((a) => a.dir === dir).map((a) => a.service);
    const answer = await handle({ cmd: "restart", dir, services });
    out.push({ name: `${branchOf(dir)} ${services.join(" and ")}`, ok: !!answer.ok });
  }
  return out;
}

// ---- apps -------------------------------------------------------------------------------------------------------

function launch(app) {
  if (closing) return;
  const run = RUN[app.service];
  const secrets = run.secrets && secretsAvailable();
  const cmd = run.cmd(app.port);
  const argv = secrets ? [process.execPath, join(import.meta.dirname, "env-pull.mjs"), "--", ...cmd] : cmd;
  const state = localState({ dir: app.dir, main, ownDb: options.get(app.dir)?.ownDb });
  if (!state && app.dir !== main) {
    // Its own copy: main's data and sign-ins to start from, then the branch's own `npm run db:rebuild:local`
    const own = join(app.dir, "apps", "web", ".wrangler", "state");
    const mains = join(main, "apps", "web", ".wrangler", "state");
    if (!existsSync(own) && existsSync(mains)) cpSync(mains, own, { recursive: true });
  }
  mkdirSync(paths.logs, { recursive: true });
  const file = appLog(paths, app.dir, app.service);
  if (existsSync(file) && statSync(file).size > 5_000_000) rmSync(file);
  const out = openSync(file, "a");
  writeSync(
    out,
    `\n--- ${new Date().toISOString()} ${app.service} on port ${app.port}${secrets ? ", dev secrets" : ""} ---\n`,
  );
  app.state = "starting";
  app.note = secrets || !run.secrets ? undefined : "no dev secrets: vault locked (bw-unlock, then restart)";
  app.child = spawn(argv[0], argv.slice(1), {
    cwd: join(app.dir, run.cwd),
    detached: true, // its own session: stopping it stops everything it started
    stdio: ["ignore", out, out],
    env: {
      ...appEnv(process.env),
      PATH: `${join(app.dir, "node_modules", ".bin")}:${process.env.PATH}`,
      [OWNER_ENV]: String(process.pid),
      ...(state && { COUGARS_LOCAL_STATE: state }),
    },
  });
  closeSync(out);
  const child = app.child;
  log(`${app.name} ${app.service}: starting on ${app.port}, pid ${child.pid}${secrets ? " (dev secrets)" : ""}`);
  child.on("error", (e) => log(`${app.name} ${app.service}: ${e.message}`));
  child.on("exit", (code) => void exited(app, child, code));
  void watch(app, child);
}

async function exited(app, child, code) {
  if (app.child !== child) return; // stopped on purpose
  if (child.pid) await stopSession(child.pid, 1000); // whatever it left behind in its session goes too
  app.child = undefined;
  app.crashes++;
  if (app.crashes >= MAX_CRASHES) {
    app.state = "failed";
    app.note = `stopped after ${app.crashes} crashes (exit ${code})`;
    log(`${app.name} ${app.service}: ${app.note}`);
    return settle(app);
  }
  app.state = "down";
  const wait = Math.min(30_000, 1000 * 2 ** app.crashes);
  app.note = `exited ${code}, starting again in ${wait / 1000}s`;
  log(`${app.name} ${app.service}: ${app.note}`);
  app.restart = setTimeout(() => ((app.restart = undefined), launch(app)), wait);
}

/** Whether the app answers HTTP at all: a page's own error is still a server that's up. */
const answers = (port, path) =>
  new Promise((done) => {
    const req = get({ host: "127.0.0.1", port, path, timeout: 5000 }, (res) => (res.resume(), done(true)));
    req.on("error", () => done(false));
    req.on("timeout", () => (req.destroy(), done(false)));
  });

async function watch(app, child) {
  const born = Date.now();
  let downSince = 0;
  while (app.child === child) {
    const up = await answers(app.port, RUN[app.service].probe);
    if (app.child !== child) return;
    if (up && app.state !== "up") {
      log(`${app.name} ${app.service}: up in ${((Date.now() - (downSince || born)) / 1000).toFixed(1)}s`);
      Object.assign(app, {
        state: "up",
        crashes: 0,
        note: app.note?.startsWith("no dev secrets") ? app.note : undefined,
      });
      downSince = 0;
      settle(app);
    } else if (!up && app.state === "up") {
      app.state = "down";
      downSince = Date.now();
      log(`${app.name} ${app.service}: not answering (a reload?)`);
    } else if (!up && app.state === "down" && downSince && Date.now() - downSince > STUCK_MS) {
      log(`${app.name} ${app.service}: not answering for ${STUCK_MS / 1000}s, starting it again`);
      await stop(app);
      return launch(app);
    } else if (!up && app.state === "starting" && Date.now() - born > START_MS) {
      await stop(app);
      Object.assign(app, { state: "failed", note: `not answering after ${START_MS / 1000}s` });
      log(`${app.name} ${app.service}: ${app.note}`);
      return settle(app);
    }
    await sleep(app.state === "up" ? 5000 : 500);
  }
}

function settle(app) {
  for (const w of app.waiters.splice(0)) w();
}

async function stop(app) {
  clearTimeout(app.restart);
  app.restart = undefined;
  const child = app.child;
  app.child = undefined;
  app.state = "down";
  if (child?.pid) await stopSession(child.pid);
  settle(app);
}

/** The app, started if it isn't running; waits until it answers or fails unless `wait` is false. */
async function ensure(dir, service, wait = true) {
  const key = keyOf(dir, service);
  let app = apps.get(key);
  if (!app) {
    const [port] = await freePorts(1);
    app = { dir, service, name: branchOf(dir), port, state: "down", asked: Date.now(), crashes: 0, waiters: [] };
    apps.set(key, app);
  }
  app.asked = Date.now();
  if (app.state === "failed") app.crashes = 0;
  if (!app.child && !app.restart) launch(app);
  if (wait && app.state !== "up")
    await new Promise((done) => {
      const timer = setTimeout(done, START_MS + 5000);
      app.waiters.push(() => (clearTimeout(timer), done()));
    });
  return app;
}

async function remove(app) {
  await stop(app);
  apps.delete(keyOf(app.dir, app.service));
}

const running = (dir) => [...apps.values()].filter((a) => a.dir === dir);
const answer = (app) => ({
  service: app.service,
  label: SERVICES[app.service].label,
  ok: app.state === "up",
  state: app.state,
  port: app.port,
  note: app.note,
  log: app.state === "up" ? undefined : tail(app, 20),
});

// ---- the switch -------------------------------------------------------------------------------------------------

function serveSwitch(service) {
  const label = SERVICES[service].label;
  const look = () => {
    const app = shown && apps.get(keyOf(shown, service));
    if (app) app.asked = Date.now();
    const t = target({ shown: shown && { dir: shown, name: branchOf(shown) }, app, service, label });
    if (t.start && !closing) void ensure(shown, service, false);
    return { ...t, log: t.log ? tail(app, 30) : undefined };
  };
  const hold = (req, res, t) => {
    const page = (req.headers.accept ?? "").includes("text/html");
    res.writeHead(503, {
      "content-type": page ? "text/html; charset=utf-8" : "text/plain",
      "cache-control": "no-store",
    });
    res.end(page ? holdingPage(t) : `${t.title}. ${t.detail}\n`);
  };
  const server = http((req, res) => {
    if (req.url?.startsWith("/__app")) return void panel(req, res);
    if (req.url === "/__secrets" || req.url?.startsWith("/__secrets/")) return void secrets(req, res);
    const t = look();
    if (!t.up) return hold(req, res, t);
    forward(req, res, t.port, () =>
      hold(req, res, {
        title: `${branchOf(shown)}: its ${label} isn't answering`,
        detail: "It answered a moment ago.",
      }),
    );
  });
  server.on("upgrade", (req, socket, head) => {
    const t = look();
    if (!t.up) return socket.destroy();
    forwardUpgrade(req, socket, head, t.port);
  });
  server.requestTimeout = 0; // live streams (SSE, ADR 0072) stay open
  server.on("error", (e) => {
    log(`can't hold ${PORTS[service]} for the ${label}: ${e.message}`);
    void shutdown("a port is taken");
  });
  server.listen(PORTS[service], "0.0.0.0");
  return server;
}

// ---- the control page -------------------------------------------------------------------------------------------

async function panel(req, res) {
  const url = new URL(req.url ?? "/", "http://x");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && url.pathname === "/__app/status") return json(status());
  if (req.method === "POST") {
    const dir = url.searchParams.get("dir") ?? "";
    const service = url.searchParams.get("service");
    if (!checkouts(main).some((c) => c.dir === dir)) return json({ ok: false, error: "no such checkout" }, 404);
    const services = service ? [service] : undefined;
    const act = url.pathname.slice("/__app/".length);
    if (act === "show") return json(await handle({ cmd: "show", dir, swap: true }));
    if (act === "restart" || act === "stop") return json(await handle({ cmd: act, dir, services }));
    return json({ ok: false, error: "unknown action" }, 404);
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(panelPage());
}

function status() {
  const now = Date.now();
  return {
    shown,
    supervisor: process.pid,
    closing,
    ports: PORTS,
    checkouts: checkouts(main)
      .filter((c) => !basename(c.dir).startsWith("."))
      .map((c) => ({
        dir: c.dir,
        name: c.branch ?? basename(c.dir),
        shown: c.dir === shown,
        ownDb: !!options.get(c.dir)?.ownDb,
        apps: running(c.dir).map((a) => ({
          ...answer(a),
          pid: a.child?.pid,
          idle: Math.round((now - a.asked) / 60_000),
          log: tail(a),
        })),
      })),
  };
}

// ---- requests ---------------------------------------------------------------------------------------------------

/** What `npm run app` shows when asked for nothing in particular: the website and the team app. */
const DEFAULT = ["web", "team"];

async function handle(req) {
  if (closing && req.cmd !== "status") return { ok: false, error: "the supervisor is stopping" };
  const { dir } = req;
  if (dir && !existsSync(dir)) return { ok: false, error: `${dir} doesn't exist` };
  switch (req.cmd) {
    case "show": {
      // A change of local D1 restarts what reads it
      if (req.ownDb !== undefined && !!options.get(dir)?.ownDb !== req.ownDb) {
        options.set(dir, { ...options.get(dir), ownDb: req.ownDb });
        for (const app of running(dir)) if (app.service !== "studio") await stop(app).then(() => launch(app));
      }
      if (req.fresh)
        for (const s of req.services ?? []) if (apps.has(keyOf(dir, s))) await stop(apps.get(keyOf(dir, s)));
      // Shown at once: while an app starts, its port says so and opens it when it answers
      if (req.swap) shown = dir;
      const want = req.services ?? DEFAULT;
      const started = await Promise.all(want.map((s) => ensure(dir, s)));
      save();
      return {
        ok: started.every((a) => a.state === "up"),
        name: branchOf(dir),
        shown: dir === shown,
        ports: PORTS,
        apps: started.map(answer),
      };
    }
    case "restart": {
      const which = running(dir).filter((a) => !req.services || req.services.includes(a.service));
      if (!which.length) return { ok: false, error: "nothing running there; npm run app starts it" };
      lockedUntil = 0; // the vault may be unlocked now
      for (const app of which) {
        log(`${app.name} ${app.service}: restarting`);
        await stop(app);
        app.crashes = 0;
      }
      const done = await Promise.all(which.map((a) => ensure(a.dir, a.service)));
      return { ok: done.every((a) => a.state === "up"), name: branchOf(dir), apps: done.map(answer) };
    }
    case "stop": {
      for (const app of running(dir)) if (!req.services || req.services.includes(app.service)) await remove(app);
      save();
      return { ok: true };
    }
    case "status":
      return status();
    case "down":
      setTimeout(() => void shutdown("npm run app down"), 10);
      return { ok: true };
    default:
      return { ok: false, error: `unknown request ${req.cmd}` };
  }
}

const listening = [];
async function shutdown(why) {
  if (closing) return;
  closing = true;
  log(`stopping (${why}): ${apps.size} app(s)`);
  // No new requests and no new apps from here on, then every app, then anything still marked ours
  rmSync(paths.sock, { force: true });
  for (const l of listening) l.close();
  await Promise.all([...apps.values()].map(stop));
  for (const p of procs()) if (envOf(p.pid, OWNER_ENV) === String(process.pid)) await stopTree(p.pid, 1000);
  rmSync(paths.pid, { force: true });
  log("stopped");
  process.exit(0);
}

// ---- start ------------------------------------------------------------------------------------------------------

mkdirSync(paths.dir, { recursive: true });
try {
  writeFileSync(paths.pid, String(process.pid), { flag: "wx" });
} catch {
  const other = Number(readFileSync(paths.pid, "utf8"));
  if (other && alive(other) && proc(other)?.cmd.includes("app-supervisor.mjs")) {
    console.error(`already running (pid ${other})`);
    process.exit(0);
  }
  writeFileSync(paths.pid, String(process.pid));
}
rmSync(paths.sock, { force: true });

// What a supervisor killed outright left running: only processes it marked, never anything else
for (const p of procs()) {
  const owner = envOf(p.pid, OWNER_ENV);
  if (owner && owner !== String(process.pid) && !alive(Number(owner)) && p.pid !== process.pid) {
    log(`stopping pid ${p.pid}, left by supervisor ${owner}`);
    await stopTree(p.pid, 2000);
  }
}
// A dev server started by hand on one of the ports is taken over, as starting one always did (ADR 0022)
for (const port of Object.values(PORTS)) await stopDevServerOn(port).catch((e) => log(e.message));

for (const service of Object.keys(SERVICES)) listening.push(serveSwitch(service));
const control = net((sock) => {
  let buf = "";
  sock.on("data", (d) => {
    buf += d;
    const nl = buf.indexOf("\n");
    if (nl < 0) return;
    handle(JSON.parse(buf.slice(0, nl))).then(
      (ans) => sock.end(JSON.stringify(ans) + "\n"),
      (e) => sock.end(JSON.stringify({ ok: false, error: String(e) }) + "\n"),
    );
  });
  sock.on("error", () => {});
}).listen(paths.sock);
listening.push(control);
log(
  `supervisor ${process.pid}: the switch on ${Object.entries(PORTS)
    .map(([s, p]) => `${p} ${s}`)
    .join(", ")}`,
);

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => void shutdown(sig));
process.on("uncaughtException", (e) => {
  log(`crashed: ${e.stack ?? e}`);
  void shutdown("crash");
});

// Housekeeping: checkouts gone, branches' apps nobody looks at
setInterval(() => {
  for (const app of toStop([...apps.values()], { shown, main, now: Date.now(), exists: existsSync })) {
    log(`${app.name} ${app.service}: ${existsSync(app.dir) ? "idle" : "checkout gone"}, stopping`);
    void remove(app).then(save);
  }
}, 60_000);

// Every app the last supervisor ran comes back, the shown checkout shown, so restarting it costs nobody anything
try {
  const last = JSON.parse(readFileSync(paths.state, "utf8"));
  for (const [dir, { services, ownDb }] of Object.entries(last.checkouts ?? {}))
    if (existsSync(dir) && services.length) {
      options.set(dir, { ownDb });
      void handle({ cmd: "show", dir, services, swap: dir === last.shown });
    }
  if (last.shown && existsSync(last.shown)) shown = last.shown;
} catch {
  // first run
}
