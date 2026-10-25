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
/**
 * A year of Fridays, every member at each, charged and paid every four weeks, every fifth member owing the last
 * twelve (#177); LOAD_WEEKS=8 for the last eight, to compare.
 */
const WEEKS = Number(process.env.LOAD_WEEKS ?? 52);

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
  ({ w, dana, ids, friday } = await clubWithHistory(KUMITES, { weeks: WEEKS, everyone: true, paying: true }));
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

/** SQLite's time a request takes, the mean of RUNS: what grows with the rows D1 reads. */
async function sqlite(run: () => unknown) {
  const before = w.db.sqlMs;
  for (let i = 0; i < RUNS; i++) await run();
  return (w.db.sqlMs - before) / RUNS;
}
/** A reply's size, in KB. */
const kb = async (b: Browser, path: string) =>
  ((await (await b.open("GET", path)).arrayBuffer()).byteLength / 1024).toFixed(0);

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
    it("opening the app, as anyone, the club unchanged (304), a page opened, a tap In then Out, a past one opened, a page of History and a tournament deleted keep under the free plan's 10 ms", async () => {
      const bootstrap = await median((i) => send(members[i % members.length], "GET", "/api/bootstrap"));
      say("bootstrap, a member", bootstrap);
      const bytes = (await (await members[0].open("GET", "/api/bootstrap")).arrayBuffer()).byteLength;
      said.push(`bootstrap, a member's bytes: ${(bytes / 1024).toFixed(0)} KB`);
      const admin = await median(() => send(dana, "GET", "/api/bootstrap"));
      say("bootstrap, an admin (sees everything)", admin);
      const adminBytes = (await (await dana.open("GET", "/api/bootstrap")).arrayBuffer()).byteLength;
      said.push(`bootstrap, an admin's bytes: ${(adminBytes / 1024).toFixed(0)} KB`);
      // D1's own time on an admin's open: what grows with the rows it reads (not the Worker's CPU, but its trend is)
      const sqlBefore = w.db.sqlMs;
      for (let i = 0; i < RUNS; i++) await send(dana, "GET", "/api/bootstrap");
      say("bootstrap, an admin, SQLite's time (rows read)", (w.db.sqlMs - sqlBefore) / RUNS);
      say(
        "bootstrap, a member, SQLite's time (rows read)",
        await sqlite(() => send(members[0], "GET", "/api/bootstrap")),
      );
      // Each page's own (#178): the members page, an admin's; a training night's, every member's, the roster and the
      // weeks just held as everyone of a role shares them, kept at the edge, each member's own answers from D1
      const adminPage = "/api/slices?names=members,pastSessions,clubDues,reminders";
      const admins = await median(() => send(dana, "GET", adminPage));
      say("the members page, an admin (the roster, the weeks just held, everyone's dues)", admins);
      said.push(`the members page, an admin's bytes: ${await kb(dana, adminPage)} KB`);
      const night = "/api/slices?names=members,pastSessions";
      const shared = await median((i) => send(members[i % members.length], "GET", night));
      say("a training night's page, a member, its shared rows kept", shared);
      say(
        "a training night's page, a member, its shared rows kept, SQLite's time",
        await sqlite(() => send(members[1], "GET", night)),
      );
      said.push(`a training night's page, a member's bytes: ${await kb(members[0], night)} KB`);
      // Nothing kept: something unsaid changed (the version moved on by a script), so the next open reads D1
      const fresh = () => w.db.raw.prepare("UPDATE data_version SET version = version + 1").run();
      const unkept = await median((i) => (fresh(), send(members[i % members.length], "GET", night)));
      say("a training night's page, a member, nothing kept (each read from D1)", unkept);
      say(
        "a training night's page, nothing kept, SQLite's time",
        await sqlite(() => (fresh(), send(members[1], "GET", night))),
      );
      const pageTag = (await send(members[2], "GET", night)).headers.get("etag")!;
      const samePage = await median(() => send(members[2], "GET", night, undefined, { "if-none-match": pageTag }));
      say("a page, unchanged (304)", samePage);
      // A member's ledger, a page at a time (#177): what opening the app no longer sends
      const ledger = await median((i) => send(dana, "GET", `/api/members/${ids[i % ids.length]}/ledger`));
      say("a member's ledger, its first page", ledger);
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
      // What a tap's reply carries (#178): tonight's nights, your own charges and dues, not the weeks just held
      const tapReply = (i: number) =>
        send(members[i % members.length], "POST", `/api/sessions/${friday}/answer`, { answer: i % 2 ? "out" : "in" });
      let taps = 0;
      say("a tap, SQLite's time", await sqlite(() => tapReply(taps++)));
      const tapped = await members[3].open("POST", `/api/sessions/${friday}/answer`, {}, { answer: "in" });
      said.push(`a tap's reply: ${((await tapped.arrayBuffer()).byteLength / 1024).toFixed(1)} KB`);
      expect((await dana.call("PUT", "/api/me/view-as", { memberId: ids[5] })).status).toBe(200);
      const viewing = await median(() => send(dana, "GET", "/api/bootstrap"));
      say("bootstrap, an admin viewing as a member", viewing);
      expect((await dana.call("DELETE", "/api/me/view-as")).status).toBe(200);
      // A past one opened, and a page of History (#175): what opening the app no longer sends
      const pastOne = (
        w.db.raw.prepare("SELECT MIN(id) id FROM tournaments WHERE status = 'finished'").get() as { id: number }
      ).id;
      const opened = await median((i) => send(members[i % members.length], "GET", `/api/tournaments/${pastOne}`));
      say("a past Kumite opened, in full", opened);
      const history = await median((i) => send(members[i % members.length], "GET", "/api/tournament-types/1/editions"));
      say("a page of History", history);
      const gone = scrimmages(RUNS + WARM);
      const deleted = await median((i) => send(dana, "DELETE", `/api/tournaments/${gone[i]}`));
      say("a tournament deleted (its reply: every tournament)", deleted);
      process.stdout.write(
        `\nWorker CPU a request, ${KUMITES} Kumites and ${WEEKS} weeks of Fridays behind the club, median of ${RUNS}:\n  ${said.join("\n  ")}\n`,
      );
      for (const ms of [
        bootstrap,
        admin,
        unchanged,
        tap,
        viewing,
        opened,
        history,
        deleted,
        ledger,
        admins,
        shared,
        unkept,
        samePage,
      ])
        expect(ms).toBeLessThan(FREE_CPU_MS);
    });
  },
);

it("runs only when asked (LOAD_CPU=1): CPU times depend on the machine", () => {
  expect(friday).toBeGreaterThan(0);
});
