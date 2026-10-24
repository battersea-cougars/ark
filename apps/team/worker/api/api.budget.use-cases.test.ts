// Every route keeps to the D1 budget (ADR 0003, docs/api-budget.md): a request makes a small, bounded number of D1
// calls, whatever the club's size. Driven through the real handlers in the fake world (ADR 0031) on a club-sized
// fixture: 60 members, a season of Fridays behind them with their charges, a Kumite played to its end, another
// drafted and scored, sign-ups, dues, the calendar and the settings. Each route is driven on its happy path (a refusal
// costs less, so it would hide what the route costs), and the fake D1 counts every round trip its request makes: the
// wrapper's own (who's asking, the limits, the record, the version, the parts sent back) and what goes after the reply
// (the tests have no waitUntil). Then the same at 120 members: a route that costs more there reads a member at a time.
// A new route fails until it's driven here. BUDGET=1 prints the table, BUDGET=sql each dear route's statements, and
// BUDGET=plan each statement whose query plan reads a whole table.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ROUTES } from "./api";
import { issueBreakGlass } from "../../../../scripts/lib/break-glass.mjs";
import { nextSlots } from "../../src/lib/draft";
import { NOW, testWorld, type D1Spent, type Reply } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** Workers Free stops an invocation at 50 D1 queries (a batch is one, ADR 0123): no request may come near it. */
const WORKERS_FREE = 50;
/** D1 round trips a request may make: half the free plan's, so there's room for what a route grows into. */
export const D1_BUDGET = 25;
/** The routes that may spend more, and why: each still inside the free plan's 50. */
const OWN_BUDGET: Record<string, { most: number; why: string }> = {
  "POST /api/tournaments/:id/simulate": {
    most: 45,
    why: "dev only (ADR 0123): up to four moves in 30 queries, the request around them about 11",
  },
  "POST /api/tournaments/:id/move": {
    most: 40,
    why: "up to eight of the app's own jobs in one tap, each with its own guards (ADR 0074, 0121)",
  },
};
/** Sign-in's own routes (auth.ts handleAuth), answered before the route table. */
const AUTH_ROUTES = [
  "POST /api/auth/start",
  "POST /api/auth/verify",
  "POST /api/auth/request",
  "POST /api/auth/sign-out",
  "POST /api/auth/sign-out-everywhere",
  "PUT /api/auth/device",
  "DELETE /api/auth/device",
  "GET /api/auth/passkeys",
  "POST /api/auth/passkeys/register-options",
  "POST /api/auth/passkeys/register",
  "POST /api/auth/passkeys/sign-in-options",
  "POST /api/auth/passkeys/sign-in",
];

const roster = (size: number) => [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...Array.from({ length: size - 1 }, (_, i) => ({
    name: `Member ${i + 1}`,
    position: i % 10 === 0 ? "G" : i % 3 ? "F" : "D",
    rating: 40 + (i % 40),
    email: `m${i + 1}@example.com`,
  })),
];
/** Friday 13 November 2026, 19:30 GMT: the Kumite's evening. */
const EVENING = new Date("2026-11-13T19:30:00Z");
const KUMITE_TYPE = 1;

let w: ReturnType<typeof testWorld>;
type Phone = Awaited<ReturnType<typeof w.signedIn>>;
let dana: Phone;
let phones: Map<number, Phone>;
/** Member n's phone, signed in once. */
const member = async (n: number) => {
  if (!phones.has(n)) phones.set(n, await w.signedIn(`m${n}@example.com`));
  return phones.get(n)!;
};
let ids: Record<string, number>;

/** What each route cost, by its pattern: its dearest request. */
type Costs = Map<string, { d1: D1Spent; path: string }>;
let spent: Costs;
/** Each statement the requests sent, once, with the values it was first sent with (BUDGET=plan). */
let sent: Map<string, unknown[]>;

const pretty = (re: RegExp) =>
  re.source
    .replace(/^\^|\$$/g, "")
    .replace(/\(\\d\+\)/g, ":id")
    .replace(/\\\//g, "/");
const keyOf = (method: string, path: string) => {
  const bare = path.split("?")[0];
  const route = ROUTES.find((r) => r.method === method && r.path.test(bare));
  return route ? `${route.method} ${pretty(route.path)}` : `${method} ${bare}`;
};

/** One request, on its happy path, counted against its route. */
async function hit(as: Phone, method: string, path: string, payload?: unknown, now: Date = NOW): Promise<Reply> {
  const res = await as.call(method, path, payload ?? (method === "GET" ? undefined : {}), { now });
  if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
  const key = keyOf(method, path);
  const was = spent.get(key);
  if (!was || res.d1.roundTrips > was.d1.roundTrips) spent.set(key, { d1: res.d1, path });
  return res;
}
const boot = async (as: Phone = dana, now: Date = NOW) => (await hit(as, "GET", "/api/bootstrap", undefined, now)).body;

/** A club of `size` with a season behind it (a fee on Fridays, the last eight with 40 at each, all charged), walked. */
async function club(size: number) {
  w = testWorld(roster(size));
  w.luck(7);
  phones = new Map();
  spent = new Map();
  sent = new Map();
  if (process.env.BUDGET === "plan") watchStatements();
  dana = await w.signedIn("dana@example.com");
  const b = await boot();
  ids = Object.fromEntries(b.members.map((m: Json) => [m.name, m.id]));
  const series = b.series[0];
  await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [{ pence: 800, from: "2026-01-01" }] });
  const fridays = w.db.raw
    .prepare("SELECT id FROM training_sessions WHERE held_on < ? ORDER BY held_on DESC LIMIT 8")
    .all(NOW.toISOString().slice(0, 10)) as { id: number }[];
  const insert = w.db.raw.prepare(
    "INSERT OR IGNORE INTO attendance (session_id, member_id, signup, signed_up_at, attended) VALUES (?, ?, 'in', ?, 1)",
  );
  const forty = b.members.map((m: Json) => m.id).slice(1, 41);
  for (const f of fridays) for (const m of forty) insert.run(f.id, m, NOW.toISOString());
  await dana.call("POST", `/api/members/${forty[0]}/payments`, { via: "cash", pence: 800 });
  // The day's first open (the sessions made, what's due charged) is a request too: as if the day had just begun
  w.db.raw.prepare("UPDATE data_version SET sessions_made_on = NULL").run();
  await walk();
  await kumites();
  return spent;
}

/** Days, as the app sends them. */
const at = (day: string, time: string) => new Date(`${day}T${time}:00Z`).toISOString();
const NEXT_FRIDAY = "2026-10-09";
const ORIGIN = "https://team.test";

/** The club, as the routes walk it: the order matters (a team needs its players signed up). */
async function walk() {
  const b = await boot();
  const friday = b.sessions.find((s: Json) => s.heldOn === NEXT_FRIDAY);
  const series = b.series[0];
  const reg = await member(1);

  // The club, read
  await boot(reg);
  await hit(reg, "GET", "/api/slices?names=sessions,agenda,members");
  {
    // A stream: counted to its first byte (the hub holds it open from there), then closed
    const [trips, statements] = [w.db.roundTrips, w.db.statements];
    const res = await reg.open("GET", "/api/live");
    expect(res.status).toBe(200);
    const d1 = { roundTrips: w.db.roundTrips - trips, statements: w.db.statements - statements, sql: [] };
    spent.set("GET /api/live", { d1, path: "/api/live" });
    await res.body?.cancel();
  }

  // Announcements
  const ann = await hit(dana, "POST", "/api/announcements", { title: "Kit", body: "New shirts", endsOn: "2026-10-20" });
  await hit(reg, "GET", "/api/announcements");
  await hit(reg, "POST", `/api/announcements/${ann.body.id}/dismiss`);
  await hit(dana, "DELETE", `/api/announcements/${ann.body.id}`);

  // You
  await hit(reg, "GET", "/api/me/data");
  const me = b.members.find((m: Json) => m.id === ids["Member 1"]);
  await hit(reg, "PUT", "/api/me", { position: me.position, bio: "Stops pucks.", webName: null, phone: null });
  const asked = await hit(reg, "POST", "/api/me/email", { email: "member.one@example.com" });
  await hit(reg, "POST", "/api/me/email/confirm", { code: asked.body.devCode });
  await hit(await member(2), "PUT", "/api/me/plan", { quarter: "2027-Q1", quarterly: true });
  const memberRole = b.roles.find((r: Json) => r.name === "Member");
  await hit(dana, "PUT", "/api/me/everyday-role", { roleId: memberRole.id });
  await hit(dana, "PUT", "/api/me/everyday-role", { roleId: null });
  // Viewing the app as a member, and back (ADR 0024)
  await hit(dana, "PUT", "/api/me/view-as", { memberId: ids["Member 1"] });
  await hit(dana, "DELETE", "/api/me/view-as");
  await hit(reg, "GET", "/api/me/notifications");
  await hit(reg, "PUT", "/api/me/notifications", { announcements: false });

  // Members and roles
  const m2 = ids["Member 52"];
  await hit(dana, "PUT", `/api/members/${m2}/everyday-role`, { roleId: memberRole.id });
  await hit(dana, "GET", `/api/members/${m2}/attendance`);
  // Three nights still open: a past one's register closed the morning after (#11), so the coming ones
  const coming = b.sessions.filter((s: Json) => s.heldOn >= NOW.toISOString().slice(0, 10)).slice(0, 3);
  await hit(dana, "PUT", `/api/members/${m2}/attendance`, {
    marks: coming.map((s: Json) => ({ sessionId: s.id, here: false })),
  });
  await hit(dana, "PUT", `/api/members/${m2}/contact`, { email: "m52.new@example.com", phone: "07700 900001" });
  await hit(dana, "POST", `/api/members/${m2}/sign-out`);
  const nina = await hit(dana, "POST", "/api/members", { name: "Nina New", email: "nina@example.com", position: "G" });
  await hit(dana, "POST", `/api/members/${nina.body.id}/app-link`);
  await hit(dana, "POST", "/api/members/import", {
    file: "name,email,position\nIan Import,ian@example.com,F\nIvy Import,ivy@example.com,D\n",
  });
  const m3 = (await boot()).members.find((m: Json) => m.id === ids["Member 53"]);
  await hit(dana, "PUT", `/api/members/${m3.id}`, { ...m3, rating: m3.rating + 1 });
  await hit(dana, "DELETE", `/api/members/${nina.body.id}`);
  const role = await hit(dana, "POST", "/api/roles", { name: "Helper", description: "", actions: ["read:Audit"] });
  await hit(dana, "PUT", `/api/roles/${role.body.id}`, { name: "Helper", description: "", actions: ["read:Usage"] });

  // Ways in: sign-in, a passkey, a phone, break-glass
  {
    const fresh = w.browser();
    const started = await hit(fresh, "POST", "/api/auth/start", { email: "m55@example.com" });
    await hit(fresh, "POST", "/api/auth/verify", { code: started.body.devCode });
    await hit(w.browser(), "POST", "/api/auth/request", { name: "Ned New", email: "ned@example.com", position: "F" });
    const phone = w.authenticator();
    const options = await hit(fresh, "POST", "/api/auth/passkeys/register-options");
    await hit(fresh, "POST", "/api/auth/passkeys/register", { response: phone.create(options.body.options, ORIGIN) });
    await hit(fresh, "GET", "/api/auth/passkeys");
    const other = w.browser();
    const signInOptions = await hit(other, "POST", "/api/auth/passkeys/sign-in-options");
    await hit(other, "POST", "/api/auth/passkeys/sign-in", { response: phone.get(signInOptions.body.options, ORIGIN) });
    await hit(dana, "GET", `/api/members/${ids["Member 55"]}/passkeys`);
    await hit(dana, "DELETE", `/api/members/${ids["Member 55"]}/passkeys`);
    const push = w.webPush();
    await hit(other, "PUT", "/api/auth/device", { platform: "web", subscription: push.subscription() });
    await hit(other, "DELETE", "/api/auth/device", { token: push.subscription().endpoint });
    await hit(other, "POST", "/api/auth/sign-out");
    await hit(fresh, "POST", "/api/auth/sign-out-everywhere");
  }
  {
    const issue = (now: Date) =>
      issueBreakGlass(
        async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => {
          const st = w.db.raw.prepare(sql);
          return st.reader ? (st.all(...params) as Record<string, unknown>[]) : (st.run(...params), []);
        },
        { email: "dana@example.com", now, by: "operator@laptop" },
      );
    await issue(NOW);
    let glass = await hit(dana, "GET", "/api/break-glass");
    await hit(dana, "POST", `/api/break-glass/codes/${glass.body.breakGlass[0].id}/end`);
    const { code } = await issue(NOW);
    const locked = w.browser();
    await locked.call("POST", "/api/auth/start", { email: "dana@example.com" });
    await locked.call("POST", "/api/auth/verify", { code });
    glass = await hit(dana, "GET", "/api/break-glass");
    const session = glass.body.breakGlass.find((x: Json) => x.kind === "session");
    await hit(dana, "POST", `/api/break-glass/sessions/${session.id}/end`);
  }

  // Fridays: the night's sign-ups, its teams, the register
  for (let n = 1; n <= 30; n++)
    await hit(await member(n), "POST", `/api/sessions/${friday.id}/answer`, { answer: "in" });
  await hit(await member(30), "POST", `/api/sessions/${friday.id}/answer`, { answer: "out" });
  await hit(dana, "POST", `/api/sessions/${friday.id}/players`, { memberId: ids["Member 40"], in: true });
  const night = (await boot()).sessions.find((s: Json) => s.id === friday.id);
  await hit(dana, "POST", `/api/sessions/${friday.id}/let-in`, { memberId: night.waitlist[0] });
  const going = (await boot()).sessions.find((s: Json) => s.id === friday.id).going as number[];
  const teams = [
    { name: "Black", players: going.filter((_, i) => i % 2 === 0) },
    { name: "White", players: going.filter((_, i) => i % 2 === 1) },
  ];
  await hit(dana, "POST", `/api/sessions/${friday.id}/teams`, { teams });
  await hit(dana, "DELETE", `/api/sessions/${friday.id}/teams`);
  await hit(dana, "POST", `/api/sessions/${friday.id}/teams`, { teams });
  await hit(
    dana,
    "POST",
    `/api/sessions/${friday.id}/register`,
    { memberId: going[0], here: true },
    new Date(`${NEXT_FRIDAY}T21:00:00Z`),
  );
  const later = b.sessions.filter((s: Json) => s.heldOn > NEXT_FRIDAY);
  const opened = new Date(`${later[0].heldOn}T08:00:00Z`);
  await hit(dana, "POST", `/api/sessions/${later[0].id}/answer`, { answer: "in" }, opened);
  await hit(dana, "POST", `/api/sessions/${later[0].id}/reset`, {}, opened);
  await hit(dana, "POST", `/api/sessions/${later[1].id}/cancelled`, { cancelled: true });
  await hit(dana, "PUT", `/api/series/${series.id}`, { ...series, capacity: 22 });
  await hit(dana, "POST", `/api/series/${series.id}/more`);
  await hit(dana, "POST", `/api/series/${series.id}/sessions`, { heldOn: "2027-06-04" });
  await hit(dana, "POST", "/api/series", {
    name: "Juniors",
    shortName: "Juniors",
    icon: "skate",
    tone: "green",
    repeatEvery: 1,
    weekdays: ["sat"],
    startsOn: "2026-10-10",
    endsOn: "2026-12-19",
    startTime: "10:00",
    endTime: "11:00",
    venue: "The Rink",
    capacity: 16,
    goalieCapacity: 2,
    signupOpensDays: 4,
    public: false,
    active: true,
    fees: [],
    clashes: [],
  });

  // Dues
  const m6 = ids["Member 56"];
  await hit(dana, "POST", `/api/members/${m6}/quarterly`, { quarterly: true });
  await hit(dana, "POST", "/api/subscription-fees", { pence: 9000, from: "2026-10-01" });
  const charge = await hit(dana, "POST", `/api/members/${m6}/charges`, { quarter: "2026-Q3", pence: 5000 });
  await hit(dana, "POST", `/api/charges/${charge.body.id}/payment`, { via: "cash" });
  await hit(dana, "DELETE", `/api/charges/${charge.body.id}/payment`);
  await hit(dana, "DELETE", `/api/charges/${charge.body.id}`);
  await hit(dana, "POST", `/api/members/${m6}/adjustments`, { pence: 200, reason: "Puck" });
  await hit(dana, "POST", `/api/members/${m6}/payments`, { via: "transfer", pence: 1600 });
  await hit(dana, "POST", `/api/members/${m6}/recalculate`);
  const payment = w.db.raw.prepare("SELECT MAX(id) id FROM payments WHERE member_id = ?").get(m6) as Json;
  await hit(dana, "DELETE", `/api/payments/${payment.id}`);
  await hit(dana, "PUT", "/api/settings/bank", { name: "Cougars", sortCode: "12-34-56", account: "12345678" });
  await hit(dana, "GET", "/api/dues/reminders");
  w.gmail();
  await hit(dana, "POST", "/api/dues/reminders");

  // Everything else on the calendar
  await hit(
    dana,
    "GET",
    `/api/calendar/clashes?startsAt=${at("2026-10-16", "18:00")}&endsAt=${at("2026-10-16", "21:00")}`,
  );
  const event = await hit(dana, "POST", "/api/club-events", {
    title: "Curry",
    startsAt: at("2026-10-14", "19:00"),
    endsAt: at("2026-10-14", "22:00"),
    venue: "The Fox",
    description: "",
    public: false,
    signup: true,
    capacity: 30,
  });
  for (let n = 1; n <= 10; n++)
    await hit(await member(n), "POST", `/api/club-events/${event.body.id}/answer`, { answer: "in" });
  await hit(dana, "POST", `/api/club-events/${event.body.id}/players`, { memberId: ids["Member 20"], in: true });
  const curry = (await boot()).clubEvents.find((e: Json) => e.id === event.body.id);
  await hit(dana, "PUT", `/api/club-events/${event.body.id}`, { ...curry, capacity: 40 });
  await hit(dana, "POST", `/api/club-events/${event.body.id}/cancelled`, { cancelled: true });
  const venue = await hit(dana, "POST", "/api/venues", { name: "The Rink", address: "", mapUrl: "", active: true });
  await hit(dana, "PUT", `/api/venues/${venue.body.id}`, {
    name: "The Rink",
    address: "SW11",
    mapUrl: "",
    active: true,
  });

  // The club's own settings
  Object.assign(w.env, { CLOUDFLARE_ANALYTICS_TOKEN: undefined });
  await hit(dana, "GET", "/api/usage");
  // The apps' open issues: Sentry asked (two subrequests), the answer kept for the next few minutes
  const sentry = w.sentry();
  sentry.issues.team.push(sentry.issue({ title: "TypeError: x is undefined" }));
  await hit(dana, "GET", "/api/sentry/issues");
  await hit(dana, "GET", "/api/audit");
  await hit(dana, "PUT", "/api/settings", { liveRefreshSeconds: 10 });
  await hit(dana, "PUT", "/api/settings/bank", { name: "Cougars", sortCode: "12-34-56", account: "12345678" });
  await hit(dana, "GET", "/api/dev/mail");
  await hit(dana, "POST", "/api/dev/mail", { email: "mo@example.com" });
  await hit(dana, "DELETE", "/api/dev/mail", { email: "mo@example.com" });
  const quip = await hit(dana, "POST", "/api/quips", { kind: "in", text: "See you on court." });
  await hit(dana, "PUT", `/api/quips/${quip.body.id}`, { text: "See you on the rink." });
  await hit(dana, "DELETE", `/api/quips/${quip.body.id}`);
  await hit(dana, "GET", "/api/mail");
  await hit(dana, "POST", "/api/mail/reconnect");
  await hit(dana, "POST", "/api/mail/test");
  await hit(dana, "GET", "/api/mail/callback?code=x&state=y");
  await hit(dana, "GET", "/api/website");
  await hit(dana, "POST", "/api/website/rebuild");
  await hit(dana, "POST", "/api/website/refresh-media");

  // A member leaves: their account erased
  await hit(await member(59), "DELETE", "/api/me");
}

/** A tournament as the bootstrap has it. */
const kumite = async (id: number) => (await boot(dana, EVENING)).tournaments.find((t: Json) => t.id === id);
/** The team on the clock picks the next skater in (as whoever runs the draft picks for them). */
async function pickNext(id: number) {
  const t = await kumite(id);
  const order = t.teams as Json[];
  const taken = order.flatMap((x) => x.players.map((p: Json) => p.pick)).filter((n: unknown) => n != null) as number[];
  const slot = nextSlots(taken, 1)[0];
  const picked = new Set(order.flatMap((x) => [x.captainMemberId, ...x.players.map((p: Json) => p.memberId)]));
  const ins = (
    w.db.raw
      .prepare(
        "SELECT e.member_id id, m.position FROM tournament_entries e JOIN members m ON m.id = e.member_id WHERE e.tournament_id = ? AND e.signup = 'in' ORDER BY e.id",
      )
      .all(id) as Json[]
  ).filter((r) => r.position !== "G" && !picked.has(r.id));
  return hit(dana, "POST", `/api/tournaments/${id}/draft/picks`, { memberId: ins[0].id, turn: slot }, EVENING);
}
const SERIES_TYPE = {
  name: "Spring Series",
  shortName: "Series",
  icon: "trophy",
  tone: "blue",
  format: "round_robin",
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  gameMinutes: 12,
  penaltyRule: "sit_out",
  defaultPenaltyMinutes: 2,
  periods: 1,
  breakMinutes: 0,
  kind: "teams",
  active: true,
  defaultFeePence: 0,
  defaultStartTime: "11:00",
  defaultEndTime: "16:00",
  awards: [],
  playoffs: [],
};

/** Kumites on their evening, 24 in each: one played to its end, one drafted and scored, one moved about and deleted. */
async function kumites() {
  await boot(dana, EVENING);
  const make = async (name: string, heldOn: string, captains: number[]) => {
    const made = await hit(
      dana,
      "POST",
      "/api/tournaments",
      {
        typeId: KUMITE_TYPE,
        name,
        heldOn,
        startTime: "19:00",
        endTime: "21:30",
        status: "open",
        feePence: 0,
        kind: "draft",
        periods: 2,
        playoffs: [{ name: "Final", home: 1, away: 2 }],
        teams: captains.map((n) => ({ name: "", captainMemberId: ids[`Member ${n}`] })),
      },
      EVENING,
    );
    const id = made.body.id as number;
    for (let n = 11; n <= 34; n++)
      await hit(await member(n), "POST", `/api/tournaments/${id}/answer`, { answer: "in" }, EVENING);
    return id;
  };
  // One played to its end, by the simulator at Spin kick
  const done = await make("Kumite Autumn", "2026-11-13", [1, 2, 3, 4]);
  for (let i = 0; i < 200; i++) {
    const r = await hit(dana, "POST", `/api/tournaments/${done}/simulate`, { moves: 4 }, EVENING);
    if (r.body.done) break;
  }
  // The awards: a vote, confirmed, revealed
  const tDone = await kumite(done);
  await hit(
    await member(12),
    "POST",
    `/api/tournaments/${done}/votes`,
    {
      votes: [{ award: "Best keeper", memberId: ids["Member 21"] }],
    },
    EVENING,
  );
  await hit(
    dana,
    "PUT",
    `/api/tournaments/${done}/winners`,
    {
      winners: [
        { award: "The Judges' Call", memberId: ids["Member 13"], title: "Most Dramatic Fall" },
        { award: "Top scorer", memberId: ids["Member 14"] },
        { award: "Champions", teamId: tDone.teams[0].id },
        { award: "Best keeper", memberId: ids["Member 21"] },
      ],
    },
    EVENING,
  );
  await hit(dana, "POST", `/api/tournaments/${done}/awards/reveal`, { next: 0 }, EVENING);
  await hit(dana, "POST", `/api/tournaments/${done}/awards/next`, { at: 1 }, EVENING);
  await boot(dana, EVENING);
  await boot(await member(12), EVENING);

  // One mid-draft: drawn, opened, picked, undone, started again, half picked
  const mid = await make("Kumite Winter", "2026-11-13", [5, 6, 7, 8]);
  await hit(dana, "POST", `/api/tournaments/${mid}/players`, { memberId: ids["Member 40"], in: true }, EVENING);
  await hit(dana, "POST", `/api/tournaments/${mid}/signup/close`, {}, EVENING);
  const draft = async (picks: number) => {
    await hit(dana, "POST", `/api/tournaments/${mid}/draft/draw`, {}, EVENING);
    await hit(dana, "POST", `/api/tournaments/${mid}/draft/open`, {}, EVENING);
    for (let i = 0; i < picks; i++) await pickNext(mid);
  };
  await draft(4);
  await hit(dana, "DELETE", `/api/tournaments/${mid}/draft/picks/last`, undefined, EVENING);
  await hit(dana, "POST", `/api/tournaments/${mid}/draft/reset`, {}, EVENING);
  await draft(10);
  await boot(dana, EVENING);
  await boot(await member(12), EVENING);
  await hit(dana, "POST", `/api/tournaments/${mid}/draft/finish`, { leaveOut: true }, EVENING);
  await hit(dana, "POST", `/api/tournaments/${mid}/draft/reopen`, { fixtures: "clear" }, EVENING);
  await hit(dana, "POST", `/api/tournaments/${mid}/draft/close`, { leaveOut: true }, EVENING);
  await hit(dana, "POST", `/api/tournaments/${mid}/fixtures`, {}, EVENING);
  await hit(dana, "DELETE", `/api/tournaments/${mid}/fixtures`, undefined, EVENING);
  await hit(dana, "POST", `/api/tournaments/${mid}/fixtures`, {}, EVENING);
  let t = await kumite(mid);
  const [team] = t.teams;
  const captain = await member(5);
  const mine = t.teams.find((x: Json) => x.captainMemberId === ids["Member 5"]);
  await hit(captain, "PUT", `/api/tournaments/${mid}/teams/${mine.id}/look`, { name: "The Ants", logo: null }, EVENING);
  await hit(dana, "POST", `/api/tournaments/${mid}/teams/${team.id}/players`, { memberId: ids["Member 45"] }, EVENING);
  await hit(dana, "DELETE", `/api/tournaments/${mid}/teams/${team.id}/players/${ids["Member 45"]}`, undefined, EVENING);

  // A match scored live: the scoresheet, the clock, goals and penalties, an Undo of each, an admin taking over
  const game = t.games[0];
  const g = `/api/tournaments/${mid}/games/${game.id}`;
  const scorer = await member(50);
  await hit(scorer, "POST", `${g}/scorer`, { action: "claim" }, EVENING);
  await hit(scorer, "POST", `${g}/clock`, { action: "start" }, EVENING);
  const home = t.teams.find((x: Json) => x.id === game.homeTeamId);
  const shooter = home.players.find((p: Json) => p.memberId)?.memberId ?? null;
  for (let i = 0; i < 3; i++)
    await hit(scorer, "POST", `${g}/goals`, { teamId: game.homeTeamId, scorerId: shooter }, EVENING);
  await hit(scorer, "DELETE", `${g}/goals/last`, undefined, EVENING);
  await hit(scorer, "POST", `${g}/penalties`, { teamId: game.awayTeamId, infraction: "delay-of-game" }, EVENING);
  await hit(scorer, "POST", `${g}/penalties`, { teamId: game.awayTeamId, infraction: "delay-of-game" }, EVENING);
  await hit(scorer, "DELETE", `${g}/penalties/last`, undefined, EVENING);
  t = await kumite(mid);
  const goalId = w.db.raw
    .prepare("SELECT id FROM tournament_goals WHERE game_id = ? ORDER BY id LIMIT 1")
    .get(game.id) as Json;
  const penaltyId = w.db.raw
    .prepare("SELECT id FROM tournament_penalties WHERE game_id = ? ORDER BY id LIMIT 1")
    .get(game.id) as Json;
  await hit(dana, "POST", `${g}/scorer/admin`, { action: "takeover", from: ids["Member 50"] }, EVENING);
  await hit(dana, "POST", `${g}/clock`, { action: "end" }, EVENING);
  await hit(dana, "DELETE", `${g}/goals/${goalId.id}`, undefined, EVENING);
  await hit(dana, "DELETE", `${g}/penalties/${penaltyId.id}`, undefined, EVENING);
  await boot(dana, EVENING);
  await boot(await member(12), EVENING);
  await hit(dana, "PUT", `/api/tournaments/${mid}/games/${t.games[1].id}`, { homeGoals: 2, awayGoals: 1 }, EVENING);

  // A past one recorded (ADR 0126): the most teams, every match of their round robin and a final, every goal named
  const captains = [1, 2, 3, 4, 5, 6, 7, 8];
  const pastTeams = captains.map((n, i) => ({
    name: `Old ${n}`,
    captainMemberId: ids[`Member ${n}`],
    players: [11 + i * 3, 12 + i * 3, 13 + i * 3].map((p) => ids[`Member ${p}`]),
  }));
  const pastGames = captains.flatMap((_, home) =>
    captains.slice(home + 1).map((_n, j) => ({
      home,
      away: home + 1 + j,
      homeGoals: 2,
      awayGoals: 1,
      scorers: { home: [pastTeams[home].captainMemberId, pastTeams[home].players[0]], away: [null] },
    })),
  );
  const recorded = await hit(
    dana,
    "POST",
    "/api/tournaments/past",
    {
      typeId: KUMITE_TYPE,
      name: "Kumite Spring",
      heldOn: "2026-04-17",
      teams: pastTeams,
      games: [...pastGames, { home: 0, away: 1, homeGoals: 3, awayGoals: 2, final: true }],
      winners: [
        { award: "Champions", team: 0 },
        { award: "Top scorer", memberId: ids["Member 1"] },
        { award: "The Judges' Call", memberId: ids["Member 12"], title: "Best Celly" },
      ],
    },
    EVENING,
  );
  const reg = await member(1);
  // History (#175): a page of the played ones, every series' too, the all-time leaders, and the past one opened, by
  // itself, by one of its games and by one of its teams, its crest at its own address
  await hit(reg, "GET", `/api/tournament-types/${KUMITE_TYPE}/editions?limit=5`);
  await hit(dana, "GET", "/api/tournaments/editions");
  await hit(reg, "GET", `/api/tournament-types/${KUMITE_TYPE}/leaders`);
  const past = (await hit(reg, "GET", `/api/tournaments/${recorded.body.id}`)).body.tournament;
  await hit(reg, "GET", `/api/tournament-games/${past.games[0].id}/tournament`);
  await hit(reg, "GET", `/api/tournament-teams/${past.teams[0].id}/tournament`);
  // What used to look through every edition the app held, and every charge (#177): each its own small read
  await hit(reg, "GET", `/api/tournament-games/${past.games[0].id}/meetings`);
  await hit(dana, "GET", `/api/tournament-types/${KUMITE_TYPE}/brings?heldOn=2026-12-01`);
  await hit(dana, "GET", "/api/venues/used");
  await hit(reg, "GET", `/api/members/${ids["Member 1"]}/ledger`);
  const page = (await hit(dana, "GET", `/api/members/${ids["Member 1"]}/ledger?limit=3`)).body;
  if (page.next) await hit(dana, "GET", `/api/members/${ids["Member 1"]}/ledger?limit=3&before=${page.next}`);
  const nights = (await boot(dana)).sessions.slice(0, 8).map((s: { id: number }) => s.id);
  await hit(dana, "GET", `/api/dues/collected?sessions=${nights.join(",")}&tournaments=${past.id}`);
  const crest = "data:image/png;base64,iVBORw0KGgo=";
  await hit(dana, "PUT", `/api/tournaments/${past.id}/teams/${past.teams[0].id}/look`, { name: "Crest", logo: crest });
  await hit(reg, "GET", `/api/tournament-teams/${past.teams[0].id}/logo`);
  // A Kumite on a past day (dev, ADR 0123): made, then played out on that evening to its last award, at Spin kick
  const pastDay = await hit(dana, "POST", "/api/tournaments/past-day", { typeId: KUMITE_TYPE, heldOn: "2026-09-25" });
  for (let i = 0; i < 200; i++) {
    const r = await hit(dana, "POST", `/api/tournaments/${pastDay.body.id}/simulate`, { moves: 4, onItsDay: true });
    if (r.body.done) break;
  }

  // Setting up: a type, a tournament made, edited, moved on, stepped back, deleted
  const type = await hit(dana, "POST", "/api/tournament-types", SERIES_TYPE);
  await hit(dana, "PUT", `/api/tournament-types/${type.body.id}`, { ...SERIES_TYPE, penaltyRule: "power_play" });
  const spareCup = await make("Spring Cup", "2026-11-13", [9, 10]);
  const cup = await kumite(spareCup);
  await hit(dana, "PUT", `/api/tournaments/${spareCup}`, { ...cup, name: "Spring Cup 2026" }, EVENING);
  // Move to: the furthest forward (every job in turn), all the way back, then on to the fixtures and a step back
  await hit(dana, "POST", `/api/tournaments/${spareCup}/move`, { from: "signup", to: "afters" }, EVENING);
  await hit(dana, "POST", `/api/tournaments/${spareCup}/move`, { from: "afters", to: "signup" }, EVENING);
  await hit(dana, "POST", `/api/tournaments/${spareCup}/move`, { from: "signup", to: "fixtures" }, EVENING);
  await hit(dana, "POST", `/api/tournaments/${spareCup}/step-back`, { from: "fixtures" }, EVENING);
  await hit(dana, "DELETE", `/api/tournaments/${spareCup}`, undefined, EVENING);
}

/** From here on, every statement the fake D1 runs is kept, with its first values, for its query plan (BUDGET=plan). */
function watchStatements() {
  const raw = w.db.raw;
  const prepare = raw.prepare.bind(raw);
  (raw as Json).prepare = (sql: string) => {
    const st = prepare(sql) as Json;
    for (const m of ["all", "get", "run"]) {
      const f = st[m].bind(st);
      st[m] = (...params: unknown[]) => {
        if (!sent.has(sql)) sent.set(sql, params);
        return f(...params);
      };
    }
    return st;
  };
}

/** Each statement whose plan reads a whole table, not by an index: where to look for a missing one. */
function scans() {
  const out: string[] = [];
  for (const [sql, params] of sent) {
    if (/^\s*(EXPLAIN|PRAGMA)/i.test(sql)) continue;
    const plan = w.db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
    const whole = plan.filter((p) => /^SCAN /.test(p.detail) && !/USING (COVERING )?INDEX|CONSTANT ROW/.test(p.detail));
    if (whole.length)
      out.push(`${whole.map((p) => p.detail).join("; ")}\n    ${sql.replace(/\s+/g, " ").slice(0, 240)}`);
  }
  return out;
}

const budgetOf = (key: string) => OWN_BUDGET[key]?.most ?? D1_BUDGET;

describe("every route keeps to the D1 budget, on a club of 60 and of 120", () => {
  let at60: Costs;
  let at120: Costs;
  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    at60 = await club(60);
    if (process.env.BUDGET === "plan") process.stdout.write(`\n${scans().join("\n")}\n`);
    at120 = await club(120);
    // Every route twice, two clubs over: ~3 s alone, far longer beside the other suites (a hook's 10 s isn't enough)
  }, 120_000);

  it("drives every route on its happy path", () => {
    const keys = [...ROUTES.map((r) => `${r.method} ${pretty(r.path)}`), ...AUTH_ROUTES];
    expect(keys.filter((k) => !at60.has(k))).toEqual([]);
  });

  it(`a request makes at most ${D1_BUDGET} D1 calls (a few their own), all inside the free plan's ${WORKERS_FREE}`, () => {
    const rows = [...at60].sort((a, b) => b[1].d1.roundTrips - a[1].d1.roundTrips);
    if (process.env.BUDGET)
      process.stdout.write(
        `\n| Route | D1 calls | Statements |\n| --- | --: | --: |\n${rows
          .map(([k, v]) => `| \`${k}\` | ${v.d1.roundTrips} | ${v.d1.statements} |`)
          .join("\n")}\n`,
      );
    if (process.env.BUDGET === "sql")
      for (const [k, v] of rows.filter(([, v]) => v.d1.roundTrips > 15))
        process.stdout.write(`\n${k}\n${v.d1.sql.map((x) => `  ${x.join(" | ").slice(0, 200)}`).join("\n")}\n`);
    const over = rows.filter(([k, v]) => v.d1.roundTrips > budgetOf(k)).map(([k, v]) => `${k}: ${v.d1.roundTrips}`);
    expect(over).toEqual([]);
    for (const { most } of Object.values(OWN_BUDGET)) expect(most).toBeLessThan(WORKERS_FREE);
  });

  it("a club twice the size costs no route a call more: nothing is read or written a member at a time (no N+1)", () => {
    const grew = [...at60]
      .filter(([k, v]) => (at120.get(k)?.d1.roundTrips ?? 0) > v.d1.roundTrips)
      .map(([k, v]) => `${k}: ${v.d1.roundTrips} at 60, ${at120.get(k)!.d1.roundTrips} at 120`);
    expect(grew).toEqual([]);
  });
});
