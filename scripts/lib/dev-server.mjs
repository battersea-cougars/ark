// A dev server started by hand (`npx vite` in apps/team) takes over its port (ADR 0022): it stops another of our dev
// servers serving there, so you never hunt for a process. Anything else on the port is an error, and the show switch
// (scripts/app-supervisor.mjs, ADR 0115) says how to show this checkout instead. The switch itself takes 4500, 4510
// and 4520 over the same way when it starts (stopDevServerOn).
import { readFileSync, readdirSync, readlinkSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import net from "node:net";

const OURS = /\b(vite|astro|sanity)\b/;
/** The show switch's own command line. */
const SWITCH = /scripts\/app-supervisor\.mjs/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stops the dev server already on `port`, then records this process in `pidFile` as the one serving it.
 * Call it once per start; a restart inside the same process (Vite after a config edit) is let through.
 */
export async function takeOverPort(port, pidFile) {
  const mine = `${port}:${process.pid}`;
  if (process.env.COUGARS_DEV_SERVER === mine) return;
  const owner = readPid(pidFile) ?? listener(port);
  if (owner && alive(owner) && SWITCH.test(commandLine(owner)))
    throw new Error(`Port ${port} is the show switch (ADR 0115): npm run app shows this checkout there.`);
  await stopDevServerOn(port, owner);
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, String(process.pid));
  process.env.COUGARS_DEV_SERVER = mine;
  process.once("exit", () => readPid(pidFile) === process.pid && rmSync(pidFile, { force: true }));
}

/**
 * Stops our dev server listening on `port` (or `owner`, when known), then waits for the port to be free. Throws when
 * something else holds it.
 */
export async function stopDevServerOn(port, owner = listener(port)) {
  if (owner && alive(owner) && OURS.test(commandLine(owner)) && !SWITCH.test(commandLine(owner))) {
    process.kill(owner, "SIGTERM");
    if (!(await until(() => !alive(owner), 5000))) process.kill(owner, "SIGKILL");
    console.log(`Stopped the dev server that was on ${port} (process ${owner}).`);
  }
  if (!(await until(async () => !(await inUse(port)), 5000))) {
    throw new Error(`Port ${port} is in use by something that isn't one of our dev servers. Stop it, then retry.`);
  }
}

function readPid(file) {
  try {
    return Number(readFileSync(file, "utf8")) || undefined;
  } catch {
    return undefined;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function commandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
  } catch {
    return "vite"; // no /proc (macOS): trust the pid file, which only our dev servers write
  }
}

/** Linux only: the process listening on `port`, for a server started before it wrote a pid file. */
function listener(port) {
  try {
    const hex = port.toString(16).toUpperCase().padStart(4, "0");
    const inodes = new Set();
    for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      for (const row of readFileSync(table, "utf8").trim().split("\n").slice(1)) {
        const cols = row.trim().split(/\s+/);
        if (cols[1].endsWith(`:${hex}`) && cols[3] === "0A") inodes.add(cols[9]); // 0A: listening
      }
    }
    for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
      try {
        for (const fd of readdirSync(`/proc/${pid}/fd`)) {
          const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
          if (target.startsWith("socket:[") && inodes.has(target.slice(8, -1))) return Number(pid);
        }
      } catch {
        // not ours to read
      }
    }
  } catch {
    // no /proc
  }
  return undefined;
}

function inUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.setTimeout(500);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
    socket.once("error", () => resolve(false));
  });
}

async function until(check, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await check()) return true;
  return false;
}
