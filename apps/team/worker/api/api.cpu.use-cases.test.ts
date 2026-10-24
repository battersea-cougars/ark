// The Worker's CPU time per request, for a club of 120 with Fridays and a year of Kumites behind it
// (bootstrap.testing.ts, docs/load-testing.md): the free plan allows 10 ms a request, and waiting on D1 is free, so
// what counts is the Worker's own work (reading the session, shaping the club into JSON). Driven through the real
// handlers in the fake world (ADR 0031); the process's CPU time for the request, less the time spent inside SQLite
// (D1's work, not the Worker's). On this machine, V8 as on Cloudflare; the median of many, after a warm-up. LOAD_CPU=1
// prints the numbers and holds each to the free plan's 10 ms (npm run load -- cpu), so opening the app can't creep
// back over it (#175). A busy machine reads high: run it again on a quiet one before believing a failure.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type testWorld } from "../testing";
import { clubWithHistory } from "./bootstrap.testing";

/** The free plan's CPU a request (ADR 0003). */
const FREE_CPU_MS = 10;
const RUNS = 60;
const WARM = 20;
/** A year of Kumites, a few a year (ADR 0009); LOAD_KUMITES=12 for three years of them. */
const KUMITES = Number(process.env.LOAD_KUMITES ?? 4);

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
let dana: Browser;
let members: Browser[];
let ids: number[];
let friday: number;

/** The Worker's own CPU for one request: the process's, less SQLite's. */
async function workerCpu(run: () => Promise<unknown>) {
  const sql = w.db.sqlMs;
  const before = process.cpuUsage();
  await run();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000 - (w.db.sqlMs - sql);
}
/** The median of RUNS after WARM to warm up (V8's compiler at work); `run` is told which it is, from 0, each once. */
async function median(run: (i: number) => Promise<unknown>) {
  for (let i = 0; i < WARM; i++) await run(i);
  const times: number[] = [];
  for (let i = WARM; i < RUNS + WARM; i++) times.push(await workerCpu(() => run(i)));
  return times.sort((a, b) => a - b)[Math.floor(RUNS / 2)];
}
const said: string[] = [];
const say = (what: string, ms: number) => said.push(`${what}: ${ms.toFixed(2)} ms`);

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  ({ w, dana, ids, friday } = await clubWithHistory(KUMITES));
  members = [];
  for (let i = 1; i <= 40; i++) members.push(await w.signedIn(`m${i}@example.com`));
  // A Worker that's been answering a while: each member's first open, and V8's compiler done with the club's shaping
  for (const m of [...members, ...members]) await send(m, "GET", "/api/bootstrap");
});

/** A request as the phone sends it, its reply read but not parsed: the parsing is the phone's, not the Worker's. */
async function send(b: Browser, method: string, path: string, payload?: unknown, headers?: Record<string, string>) {
  const res = await b.open(method, path, { headers }, payload);
  await res.arrayBuffer();
  return res;
}

/** Tournaments to delete, one a run: the scrimmage a load run leaves, its three teams and fixtures (#175). */
function scrimmages(n: number) {
  const made = w.db.raw.prepare(
    `INSERT INTO tournaments (type_id, name, held_on, start_time, end_time, status, kind)
     VALUES (NULL, 'Scrimmage', '2026-10-06', '10:00', '15:00', 'planned', 'teams') RETURNING id`,
  );
  return Array.from({ length: n }, () => (made.get() as { id: number }).id);
}

describe.runIf(process.env.LOAD_CPU)(
  "the Worker's CPU a request, a club of 120 with years of Kumites behind it (LOAD_CPU=1)",
  () => {
    it("opening the app, as anyone, the club unchanged (304), a tap In then Out and a tournament deleted keep under the free plan's 10 ms", async () => {
      const bootstrap = await median((i) => send(members[i % members.length], "GET", "/api/bootstrap"));
      say("bootstrap, a member", bootstrap);
      const admin = await median(() => send(dana, "GET", "/api/bootstrap"));
      say("bootstrap, an admin (sees everything)", admin);
      const tags = await Promise.all(members.map(async (m) => (await send(m, "GET", "/api/bootstrap")).headers));
      const unchanged = await median((i) =>
        send(members[i % members.length], "GET", "/api/bootstrap", undefined, {
          "if-none-match": tags[i % members.length].get("etag")!,
        }),
      );
      say("bootstrap, unchanged (304)", unchanged);
      const tap = await median((i) =>
        send(members[i % members.length], "POST", `/api/sessions/${friday}/answer`, { answer: i % 2 ? "out" : "in" }),
      );
      say("a tap, In or Out (the charges worked out again)", tap);
      expect((await dana.call("PUT", "/api/me/view-as", { memberId: ids[5] })).status).toBe(200);
      const viewing = await median(() => send(dana, "GET", "/api/bootstrap"));
      say("bootstrap, an admin viewing as a member", viewing);
      expect((await dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
      const gone = scrimmages(RUNS + WARM);
      const deleted = await median((i) => send(dana, "DELETE", `/api/tournaments/${gone[i]}`));
      say("a tournament deleted (its reply: every tournament)", deleted);
      process.stdout.write(
        `\nWorker CPU a request, ${KUMITES} Kumites behind the club, median of ${RUNS}:\n  ${said.join("\n  ")}\n`,
      );
      for (const ms of [bootstrap, admin, unchanged, tap, viewing, deleted]) expect(ms).toBeLessThan(FREE_CPU_MS);
    });
  },
);

it("runs only when asked (LOAD_CPU=1): CPU times depend on the machine", () => {
  expect(friday).toBeGreaterThan(0);
});
