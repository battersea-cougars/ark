// The show switch (ADR 0115): the user's ports show the checkout last shown, say why while its app isn't answering,
// pass hot reload's websocket through, and stop a whole app when it stops one.
import { spawn } from "node:child_process";
import { createServer, get } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  IDLE_MS,
  alive,
  appEnv,
  forward,
  forwardUpgrade,
  localState,
  procs,
  stopSession,
  target,
  toStop,
} from "./show.mjs";

const servers = [];
const listen = (s) =>
  new Promise((done) => {
    servers.push(s);
    s.listen(0, "127.0.0.1", () => done(s.address().port));
  });
afterEach(() => servers.splice(0).forEach((s) => s.close()));

const shown = { dir: "/src/.worktrees/web-gallery", name: "web/gallery" };
const look = (app) => target({ shown, app, service: "team", label: "team app" });

describe("what a port shows", () => {
  it("forwards to the shown checkout's app once it answers", () => {
    expect(look({ state: "up", port: 41234 })).toEqual({ up: true, port: 41234 });
  });

  it("says nothing is shown before anyone ran npm run app", () => {
    expect(target({ shown: null, service: "web", label: "website" })).toMatchObject({
      up: false,
      title: "Nothing shown",
    });
  });

  it("starts an app that isn't running when its port is opened (the Studio on demand)", () => {
    expect(look(undefined)).toMatchObject({ up: false, start: true, title: "web/gallery: starting its team app" });
  });

  it("says it's starting, with the log once it has crashed", () => {
    expect(look({ state: "starting", crashes: 0 })).toMatchObject({ up: false, log: false });
    expect(look({ state: "down", crashes: 2, note: "exited 1" })).toMatchObject({ up: false, log: true });
    expect(look({ state: "starting" }).start).toBeUndefined();
  });

  it("says a failed app failed, and doesn't start it again by itself", () => {
    const t = look({ state: "failed", note: "stopped after 5 crashes" });
    expect(t).toMatchObject({ up: false, log: true });
    expect(t.start).toBeUndefined();
    expect(t.detail).toContain("npm run app restart team");
  });
});

describe("what stops by itself", () => {
  const main = "/src";
  const now = Date.now();
  const app = (dir, idleMs, child = {}) => ({ dir, asked: now - idleMs, child });
  const exists = (dir) => dir !== "/src/.worktrees/gone";

  it("a branch's app nobody has looked at in hours, never main's or the one shown", () => {
    const apps = [
      app("/src/.worktrees/old", IDLE_MS + 1),
      app("/src/.worktrees/fresh", IDLE_MS - 60_000),
      app(main, IDLE_MS * 10),
      app(shown.dir, IDLE_MS * 10),
    ];
    expect(toStop(apps, { shown: shown.dir, main, now, exists }).map((a) => a.dir)).toEqual(["/src/.worktrees/old"]);
  });

  it("an app whose worktree was removed", () => {
    expect(toStop([app("/src/.worktrees/gone", 0)], { shown: null, main, now, exists })).toHaveLength(1);
  });
});

describe("local D1", () => {
  it("is main's for a worktree, so your data and sign-in are there", () => {
    expect(localState({ dir: "/src/.worktrees/web-x", main: "/src" })).toBe("/src/apps/web/.wrangler/state");
  });

  it("is the checkout's own for main, and for a worktree that asked for its own", () => {
    expect(localState({ dir: "/src", main: "/src" })).toBeUndefined();
    expect(localState({ dir: "/src/.worktrees/db-x", main: "/src", ownDb: true })).toBeUndefined();
  });
});

it("runs the apps as the user's: no agent markers (Astro would background itself), no npm script variables", () => {
  const env = appEnv({ PATH: "/bin", CLAUDECODE: "1", AI_AGENT: "x", npm_lifecycle_event: "app", SANITY: "keep" });
  expect(env).toEqual({ PATH: "/bin", SANITY: "keep" });
});

describe("forwarding", () => {
  it("streams an answer as it comes (live pages' SSE is never held back)", async () => {
    const upstream = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: first\n\n");
        setTimeout(() => res.end("data: last\n\n"), 2000);
      }),
    );
    const front = await listen(createServer((req, res) => forward(req, res, upstream, () => res.end("down"))));
    const first = await new Promise((done) => {
      const t0 = Date.now();
      get({ host: "127.0.0.1", port: front, path: "/events" }, (res) =>
        res.once("data", (d) => (done({ chunk: String(d), ms: Date.now() - t0 }), res.destroy())),
      );
    });
    expect(first.chunk).toBe("data: first\n\n");
    expect(first.ms).toBeLessThan(1000);
  });

  it("passes a websocket upgrade through, both ways (hot reload)", async () => {
    const upstream = createServer();
    upstream.on("upgrade", (req, socket) => {
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      socket.on("data", (d) => socket.write(`echo ${d} ${req.url}`));
    });
    const upPort = await listen(upstream);
    const front = createServer();
    front.on("upgrade", (req, socket, head) => forwardUpgrade(req, socket, head, upPort));
    const port = await listen(front);
    const reply = await new Promise((done) => {
      const s = connect(port, "127.0.0.1", () =>
        s.write("GET /?token=t HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"),
      );
      let buf = "";
      s.on("data", (d) => {
        buf += d;
        if (buf.includes("101") && !buf.includes("echo")) s.write("ping");
        if (buf.includes("echo")) {
          s.destroy();
          done(buf);
        }
      });
    });
    expect(reply).toContain("101 Switching Protocols");
    expect(reply).toContain("echo ping /?token=t");
  });

  it("says why when the app isn't answering", async () => {
    const closed = await listen(createServer());
    servers.pop().close();
    const front = await listen(createServer((req, res) => forward(req, res, closed, () => res.end("not answering"))));
    const body = await new Promise((done) =>
      get({ host: "127.0.0.1", port: front, path: "/" }, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => done(b));
      }),
    );
    expect(body).toBe("not answering");
  });
});

it("stops an app's whole session: nothing it started outlives it", async () => {
  // A leader that starts a child that starts a grandchild, as npm → vite → workerd do
  const leader = spawn("sh", ["-c", "sh -c 'sleep 60 & sleep 60' & sleep 60"], { detached: true, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 300));
  const members = () => procs().filter((p) => p.sid === leader.pid);
  expect(members().length).toBeGreaterThanOrEqual(3);
  await stopSession(leader.pid, 1000);
  expect(members()).toEqual([]);
  expect(alive(leader.pid)).toBe(false);
});
