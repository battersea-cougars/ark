// The Worker's CPU time per request, for a club of 120 with a season behind it (docs/load-testing.md): the free plan
// allows 10 ms a request, and waiting on D1 is free, so what counts is the Worker's own work (reading the session,
// shaping the club into JSON). Driven through the real handlers in the fake world (ADR 0031); the process's CPU
// time for the request, less the time spent inside SQLite (D1's work, not the Worker's). On this machine, V8 as on
// Cloudflare; the median of many, after a warm-up. LOAD_CPU=1 prints the numbers (npm run load -- cpu).
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";

const MEMBERS = 120;
const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...Array.from({ length: MEMBERS - 1 }, (_, i) => ({
    name: `Member ${i + 1}`,
    position: i % 30 === 0 ? "G" : i % 3 ? "F" : "D",
    rating: 40 + (i % 40),
    email: `m${i + 1}@example.com`,
  })),
];
/** The free plan's CPU a request (ADR 0003). */
const FREE_CPU_MS = 10;
const RUNS = 30;

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
let dana: Browser;
let members: Browser[];
let friday: number;

/** The Worker's own CPU for one request: the process's, less SQLite's. */
async function workerCpu(run: () => Promise<unknown>) {
  const sql = w.db.sqlMs;
  const before = process.cpuUsage();
  await run();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000 - (w.db.sqlMs - sql);
}
async function median(run: (i: number) => Promise<unknown>) {
  for (let i = 0; i < 5; i++) await run(i);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) times.push(await workerCpu(() => run(i)));
  return times.sort((a, b) => a - b)[Math.floor(RUNS / 2)];
}
const said: string[] = [];
const say = (what: string, ms: number) => said.push(`${what}: ${ms.toFixed(2)} ms`);

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body;
  const series = boot.series[0];
  expect(
    (await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [{ pence: 800, from: "2026-01-01" }] }))
      .status,
  ).toBe(200);
  members = [];
  for (let i = 1; i <= 40; i++) members.push(await w.signedIn(`m${i}@example.com`));
  // A season behind it: the last eight Fridays, 40 at each, all charged
  const fridays = w.db.raw
    .prepare("SELECT id FROM training_sessions WHERE held_on < ? ORDER BY held_on DESC LIMIT 8")
    .all(NOW.toISOString().slice(0, 10)) as { id: number }[];
  const ids = boot.members.map((m: { id: number }) => m.id).slice(1, 41);
  const insert = w.db.raw.prepare(
    "INSERT OR IGNORE INTO attendance (session_id, member_id, signup, signed_up_at, attended) VALUES (?, ?, 'in', ?, 1)",
  );
  for (const f of fridays) for (const m of ids) insert.run(f.id, m, NOW.toISOString());
  expect((await dana.call("POST", `/api/members/${ids[0]}/payments`, { via: "cash", pence: 800 })).status).toBe(200);
  friday = boot.sessions.find((s: { heldOn: string }) => s.heldOn >= "2026-10-06").id;
});

describe.runIf(process.env.LOAD_CPU)("the Worker's CPU a request, a club of 120 (LOAD_CPU=1)", () => {
  it("a member opening the app, the club unchanged (304), and a tap In then Out keep under the free plan's 10 ms", async () => {
    const bootstrap = await median((i) => members[i % members.length].call("GET", "/api/bootstrap"));
    say("bootstrap, a member", bootstrap);
    const admin = await median(() => dana.call("GET", "/api/bootstrap"));
    say("bootstrap, an admin (sees everything)", admin);
    const tags = await Promise.all(members.map(async (m) => (await m.call("GET", "/api/bootstrap")).headers));
    const unchanged = await median((i) =>
      members[i % members.length].call("GET", "/api/bootstrap", undefined, {
        headers: { "if-none-match": tags[i % members.length].get("etag")! },
      }),
    );
    say("bootstrap, unchanged (304)", unchanged);
    const tap = await median((i) =>
      members[i % members.length].call("POST", `/api/sessions/${friday}/answer`, { answer: i % 2 ? "out" : "in" }),
    );
    say("a tap, In or Out (the charges worked out again)", tap);
    process.stdout.write(`\nWorker CPU a request, median of ${RUNS}:\n  ${said.join("\n  ")}\n`);
    for (const ms of [bootstrap, unchanged, tap]) expect(ms).toBeLessThan(FREE_CPU_MS);
  });
});

it("runs only when asked (LOAD_CPU=1): CPU times depend on the machine", () => {
  expect(friday).toBeGreaterThan(0);
});
