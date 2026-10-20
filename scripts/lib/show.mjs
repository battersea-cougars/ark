// The show switch's parts (scripts/app-supervisor.mjs, ADR 0115): where it keeps its files, how a client asks it
// something, what each public port forwards to, and stopping a whole app (its session, so nothing it started outlives
// it). Linux only, as the devcontainer is: processes are read from /proc.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";

/** Every process the switch starts carries this, set to the supervisor's pid. */
export const OWNER_ENV = "COUGARS_APP_SUPERVISOR";
/** A branch's app nobody has shown or asked for in this long stops (main's never, nor the one shown). */
export const IDLE_MS = 3 * 60 * 60_000;

/**
 * The supervisor's files, beside the worktrees: its pid, control socket, log, state and each app's log.
 * COUGARS_SHOW_DIR moves them (a test supervisor beside the user's).
 */
export function showPaths(main, env = process.env) {
  const dir = env.COUGARS_SHOW_DIR || join(main, ".worktrees", ".show");
  return {
    dir,
    pid: join(dir, "pid"),
    sock: join(dir, "sock"),
    log: join(dir, "supervisor.log"),
    state: join(dir, "state.json"),
    logs: join(dir, "logs"),
  };
}

/** One app's log file: `<checkout folder>.<service>.log`. */
export const appLog = (paths, dir, service) => join(paths.logs, `${dir.split("/").pop()}.${service}.log`);

/** Asks the supervisor one thing (a JSON line each way); rejects when it isn't running. */
export function ask(sock, req) {
  return new Promise((resolve, reject) => {
    const s = connect(sock);
    let buf = "";
    s.on("connect", () => s.write(JSON.stringify(req) + "\n"));
    s.on("data", (d) => (buf += d));
    s.on("end", () => {
      try {
        resolve(JSON.parse(buf));
      } catch {
        reject(new Error("the supervisor closed without answering"));
      }
    });
    s.on("error", reject);
  });
}

// ---- what a public port shows -----------------------------------------------------------------------------------

/**
 * What the public port of `service` forwards to: the shown checkout's app when it answers, else a reason for the
 * holding page, and whether to start the app (a port someone opens starts its app: the Studio, or one stopped).
 * `app` is the shown checkout's app for that service, if the supervisor has one.
 */
export function target({ shown, app, service, label }) {
  if (!shown) return { up: false, title: "Nothing shown", detail: "In a checkout: npm run app" };
  const where = shown.name;
  if (!app)
    return {
      up: false,
      start: true,
      title: `${where}: starting its ${label}`,
      detail: "This page opens it when it answers.",
    };
  if (app.state === "up") return { up: true, port: app.port };
  if (app.state === "failed")
    return {
      up: false,
      title: `${where}: its ${label} failed`,
      detail: `${app.note ?? "It stopped"}. Restart it below, or in that checkout: npm run app restart ${service}`,
      log: true,
    };
  return {
    up: false,
    title: `${where}: its ${label} is starting`,
    detail: `${app.note ? `${app.note}. ` : ""}This page opens it when it answers.`,
    log: app.crashes > 0,
  };
}

/** The apps to stop now: checkouts gone, and branches' apps idle past IDLE_MS (never main's, never the one shown). */
export function toStop(apps, { shown, main, now, exists }) {
  return apps.filter(
    (a) => !exists(a.dir) || (a.dir !== shown && a.dir !== main && a.child && now - a.asked > IDLE_MS),
  );
}

/**
 * Where a checkout's apps keep local D1 and the rest of wrangler's state: main's own (apps/web/.wrangler/state) by
 * default, so every checkout sees your data and your sign-in; a branch that changes db/schema.sql opts into its own
 * copy (`npm run app -- --own-db`). Undefined: the checkout's own, the apps' default.
 */
export const localState = ({ dir, main, ownDb }) =>
  dir === main || ownDb ? undefined : join(main, "apps", "web", ".wrangler", "state");

/**
 * The supervisor's environment for its apps, without what marks a process as run by an agent (the apps are the
 * user's, and Astro backgrounds itself under an agent) or by npm (`npm run app`'s own script variables).
 */
export const appEnv = (env) =>
  Object.fromEntries(
    Object.entries(env).filter(([k]) => !/^(CLAUDE|AI_AGENT|CURSOR_|CODEX_|GEMINI_CLI|npm_|INIT_CWD$)/.test(k)),
  );

// ---- forwarding -------------------------------------------------------------------------------------------------

/** Forwards one request to `port` on this machine, streaming both ways (SSE is never buffered). */
export function forward(req, res, port, onfail) {
  const up = request({ host: "127.0.0.1", port, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    res.flushHeaders();
    r.pipe(res);
  });
  up.on("error", () => (res.headersSent ? res.destroy() : onfail()));
  res.on("close", () => up.destroy());
  req.pipe(up);
}

/** Forwards a WebSocket upgrade (Vite's and Astro's hot reload) to `port`, as raw bytes both ways. */
export function forwardUpgrade(req, socket, head, port) {
  const up = connect(port, "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  const end = () => (up.destroy(), socket.destroy());
  up.on("error", end);
  socket.on("error", end);
  up.on("close", () => socket.destroy());
  socket.on("close", () => up.destroy());
}

// ---- processes --------------------------------------------------------------------------------------------------

/** One process from /proc: pid, parent, session, command; undefined when it's gone, a zombie or not ours to read. */
export function proc(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // "pid (comm) state ppid pgrp session …": comm may hold spaces and parens, so read after the last ")"
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (f[0] === "Z") return undefined;
    const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim();
    return { pid, ppid: Number(f[1]), sid: Number(f[3]), cmd };
  } catch {
    return undefined;
  }
}

export const procs = () =>
  readdirSync("/proc")
    .filter((d) => /^\d+$/.test(d))
    .map((d) => proc(Number(d)))
    .filter(Boolean);

/** One environment variable of a process, if we can read it. */
export function envOf(pid, name) {
  try {
    const line = readFileSync(`/proc/${pid}/environ`, "utf8")
      .split("\0")
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1);
  } catch {
    return undefined;
  }
}

export const alive = (pid) => existsSync(`/proc/${pid}`) && proc(pid) !== undefined;

/** A process and everything under it, by parent links. */
export function tree(root, all = procs()) {
  const out = [root];
  for (let i = 0; i < out.length; i++)
    for (const p of all) if (p.ppid === out[i] && !out.includes(p.pid)) out.push(p.pid);
  return out;
}

const signal = (pid, sig) => {
  try {
    process.kill(pid, sig);
  } catch {
    // already gone
  }
};

/**
 * Stops every process in a session (each app starts as its own session leader) and anything that left the session
 * but still descends from it: TERM, then KILL after `graceMs`. Resolves once none is left.
 */
export function stopSession(sid, graceMs = 4000) {
  return stopAll(() => {
    const all = procs();
    const ids = new Set(all.filter((p) => p.sid === sid).map((p) => p.pid));
    for (const pid of [...ids]) for (const d of tree(pid, all)) ids.add(d);
    return [...ids];
  }, graceMs);
}

/** Stops a process and everything under it, as stopSession does. */
export const stopTree = (pid, graceMs = 4000) => stopAll(() => tree(pid).filter(alive), graceMs);

async function stopAll(members, graceMs) {
  for (const pid of members()) signal(pid, "SIGTERM");
  for (const end = Date.now() + graceMs; Date.now() < end; await sleep(100)) if (!members().length) return;
  for (let i = 0; i < 20; i++) {
    const left = members();
    if (!left.length) return;
    for (const pid of left) signal(pid, "SIGKILL");
    await sleep(100);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
