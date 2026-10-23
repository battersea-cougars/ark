// Opening the phone app on the rink's poor signal (#115): the service worker (public/sw.js) opens the shell kept from
// last time unless the network answers quickly, and keeps the network's newest shell, with its files, for the next
// opening, so a deploy still reaches the phone. Run as a browser runs it: the real file, in a fake worker scope with
// its caches and a network that's fast, slow or gone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SOURCE from "../../public/sw.js?raw";
const ORIGIN = "https://team.test";
/** A request as the worker reads it (a navigation's mode can't be made with new Request). */
type Asked = { method: string; url: string; mode: string };

/** A page as the server sends it: this build's shell, naming its own files. */
const shell = (build: string) =>
  `<!doctype html><script type="module" src="/assets/index-${build}.js"></script>` +
  `<link rel="stylesheet" href="/assets/index-${build}.css">`;

function phone() {
  /** The server: what each path answers today, and the signal (how long it takes, or no answer at all). */
  const server = new Map<string, string>([
    ["/", shell("old")],
    ["/manifest.webmanifest", "{}"],
    ["/assets/index-old.js", "old js"],
    ["/assets/index-old.css", "old css"],
  ]);
  const signal = { delayMs: 0, offline: false };
  const asked: string[] = [];
  const answer = (path: string) => {
    const body = server.get(path);
    if (body === undefined) return new Response("Not found", { status: 404 });
    const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html";
    return new Response(body, { headers: { "content-type": type } });
  };
  const fetch = (input: Asked | string) => {
    const path = new URL(typeof input === "string" ? input : input.url, ORIGIN).pathname;
    asked.push(path);
    if (signal.offline) return Promise.reject(new TypeError("Failed to fetch"));
    if (!signal.delayMs) return Promise.resolve(answer(path));
    return new Promise<Response>((resolve) => setTimeout(() => resolve(answer(path)), signal.delayMs));
  };

  // The worker's caches, as the Cache API keeps them: by path, a copy of each reply
  const stores = new Map<string, Map<string, { body: string; init: ResponseInit }>>();
  const keyOf = (r: Asked | string) => new URL(typeof r === "string" ? r : r.url, ORIGIN).pathname;
  const cacheOf = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (r: Asked | string) => {
        const hit = store.get(keyOf(r));
        return hit && new Response(hit.body, hit.init);
      },
      put: async (r: Asked | string, res: Response) => {
        store.set(keyOf(r), { body: await res.text(), init: { status: res.status, headers: res.headers } });
      },
      addAll: async (paths: string[]) => {
        for (const p of paths) store.set(p, { body: await (await fetch(p)).text(), init: {} });
      },
    };
  };
  const caches = {
    open: async (name: string) => cacheOf(name),
    match: async (r: Asked | string) => {
      for (const name of stores.keys()) {
        const hit = await cacheOf(name).match(r);
        if (hit) return hit;
      }
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };

  const handlers = new Map<string, (event: unknown) => void>();
  const self = {
    location: { href: `${ORIGIN}/sw.js` },
    addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  // The worker's own globals, as its scope has them
  new Function("self", "caches", "fetch", "location", SOURCE)(self, caches, fetch, new URL(ORIGIN));

  /** Fires an event the way the browser does, and what it was kept alive for. */
  function fire(type: string, extra: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    let reply: Promise<Response> | undefined;
    handlers.get(type)!({
      ...extra,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<Response>) => (reply = p),
    });
    return { reply, done: Promise.all(waits) };
  }

  return {
    server,
    signal,
    asked,
    kept: (path: string) => stores.get("team-shell-v1")?.get(path)?.body,
    /** The app installed, as on its first opening with a signal. */
    async install() {
      await fire("install").done;
      await fire("activate").done;
      // The old build's files, cached as its page used them
      for (const p of ["/assets/index-old.js", "/assets/index-old.css"]) await this.get(p);
      await vi.advanceTimersByTimeAsync(0);
    },
    /** Opening the app (a navigation): the page it shows, and when it's done keeping what came. */
    open(path = "/") {
      const { reply, done } = fire("fetch", { request: { method: "GET", url: `${ORIGIN}${path}`, mode: "navigate" } });
      return { page: reply!.then((r) => r.text()), done };
    },
    /** A request the page makes; undefined when the worker leaves it to the network. */
    get(path: string) {
      const { reply } = fire("fetch", { request: { method: "GET", url: `${ORIGIN}${path}`, mode: "cors" } });
      return reply?.then((r) => r.text());
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Lets the clock run until the promise settles. */
async function waitFor<T>(p: Promise<T>, ms = 60_000): Promise<{ value: T; after: number }> {
  const start = Date.now();
  let settled = false;
  let value: T;
  void p.then((v) => {
    settled = true;
    value = v;
  });
  while (!settled && Date.now() - start < ms) await vi.advanceTimersByTimeAsync(50);
  if (!settled) throw new Error("never settled");
  return { value: value!, after: Date.now() - start };
}

describe("opening the phone app", () => {
  it("on a good signal shows the newest build, and keeps it with its files for next time", async () => {
    const p = phone();
    await p.install();
    p.server.set("/", shell("new")).set("/assets/index-new.js", "new js").set("/assets/index-new.css", "new css");
    const { page, done } = p.open();
    expect((await waitFor(page)).value).toBe(shell("new"));
    await waitFor(done);
    expect(p.kept("/")).toBe(shell("new"));
    expect(p.kept("/assets/index-new.js")).toBe("new js");
    expect(p.kept("/assets/index-new.css")).toBe("new css");
  });

  it("on poor signal shows the kept app within a second and a half, not when the network gets round to it", async () => {
    const p = phone();
    await p.install();
    p.signal.delayMs = 20_000;
    const { value, after } = await waitFor(p.open().page);
    expect(value).toBe(shell("old"));
    expect(after).toBeLessThanOrEqual(1600);
  });

  it("with no signal shows the kept app at once", async () => {
    const p = phone();
    await p.install();
    p.signal.offline = true;
    const { value, after } = await waitFor(p.open("/tournaments").page);
    expect(value).toBe(shell("old"));
    expect(after).toBeLessThan(100);
  });

  it("a deploy that arrives too late for this opening is the next one's, files and all, even with no signal then", async () => {
    const p = phone();
    await p.install();
    p.server.set("/", shell("new")).set("/assets/index-new.js", "new js").set("/assets/index-new.css", "new css");
    p.signal.delayMs = 5_000;
    const first = p.open();
    expect((await waitFor(first.page)).value).toBe(shell("old"));
    await waitFor(first.done);
    p.signal.offline = true;
    expect((await waitFor(p.open().page)).value).toBe(shell("new"));
    expect(await p.get("/assets/index-new.js")).toBe("new js");
  });

  it("a shell whose files can't all be fetched isn't kept: the one before still opens with no signal", async () => {
    const p = phone();
    await p.install();
    // The new page arrives, but its stylesheet doesn't
    p.server.set("/", shell("new")).set("/assets/index-new.js", "new js");
    const first = p.open();
    await waitFor(first.page);
    await waitFor(first.done);
    expect(p.kept("/")).toBe(shell("old"));
    p.signal.offline = true;
    expect((await waitFor(p.open().page)).value).toBe(shell("old"));
  });

  it("the very first opening waits for the network, however slow: there's nothing kept to show", async () => {
    const p = phone();
    p.signal.delayMs = 5_000;
    const { value, after } = await waitFor(p.open().page);
    expect(value).toBe(shell("old"));
    expect(after).toBeGreaterThanOrEqual(5_000);
  });

  it("never answers the club's data from a cache", async () => {
    const p = phone();
    await p.install();
    expect(p.get("/api/bootstrap")).toBeUndefined();
  });
});
