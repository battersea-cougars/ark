// Nights and Kumites, in any order (#186): random sequences of what admins do, through the real Worker handlers as
// the app sends them, checked after every step against a model of the rule (ADR 0122). The user: "make sure that you
// have handled all the weird permutations of adding/cancelling, overlapping dates". Seeded (mulberry32), so a failure
// says its seed and its steps, and comes out the same again; one found is shrunk by hand into a named use case in
// training.nights-off.use-cases.test.ts.
//
// Two windows of a few weeks: October 2026 (the clocks go back on Sunday 25th) and March 2027 (forward on the 28th),
// Friday Training and a second training on Fridays (Juniors, 17:00), Reg in on every night. The steps:
//   a Kumite made on a Friday, the Thursday before or the Saturday after, in the evening, the afternoon, or running past
//   midnight (into a Friday from a Thursday), or only a season; the clash question answered Cancel it or Keep both;
//   moved: to another day, its hours only, to a season, back to a day (asked again when the day or hours move);
//   finished early (#182); deleted (a Kumite has no cancel of its own: deleting it is how it's called off);
//   a night called off by hand, and put back on (It's back on);
//   a one-off on a day, over the trainings, Cancel it or Keep both (a one-off's Cancel is a hand cancellation);
//   the clock moved on, past a night's 06:00 the morning after (its register closes) and across the clock change.
// The invariants, after every step:
//   1. a night that's open is off exactly when it's called off by hand or a Kumite still keeps it off (one the admin
//      cancelled it for, still on its London day, or one on its day when it was already off), and says so (offByHand,
//      offFor); a night whose register has closed never changes;
//   2. It's back on works on every open night (a step), and is refused on a closed one;
//   3. Reg is still in every night he said he was in; he's told a night's off at most once for each time it went off,
//      and at least once if it ever did;
//   4. the calendar's agenda says what the nights say; it has every Kumite with a day and none that's gone;
//   5. the Kumite's page is on the one the club's full list says (status, then the date, #182): opening the app sends
//      it; Home's Kumite (the lead, or Coming up's row) is the same one; Coming up is in date order;
//   6. a Kumite's clash question lists exactly the trainings' nights on its London day(s) that are on, from today.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { londonDay, londonISO } from "@cougars/shared/london";
import { testWorld } from "../testing";
import { addDays } from "../../src/lib/recurrence";
import { registerClosed } from "../../src/lib/register-closes";
import { currentOf } from "../../src/lib/edition";
import { nightPhase, tournamentPhase } from "../../src/lib/phase";
import { londonEvening } from "../../src/lib/dates";
import type { Tournament, TournamentType } from "../../src/demo/model";

// Home's feed, as the app works it out: loaded by a path the Worker's type check doesn't follow, as it reaches the
// draft room's browser code (lib/draft-room.ts), which the Worker's types don't have
const HOME_FEED = "../../src/lib/home-feed";
type UpcomingEvent = Json;
const { homeFeed } = (await import(/* @vite-ignore */ HOME_FEED)) as {
  homeFeed: (input: Json) => {
    lead: { kind: string; key: string } | null;
    upcoming: { key: string; on: { at: string; season?: unknown; tbc?: boolean } }[];
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** How many sequences, and steps in each: 20 in every run (about 30 s), a few hundred in a deep run
 * (SEQUENCES=400 STEPS=16 npx vitest run apps/team/worker/training/training.nights-off.sequences.test.ts). */
const SEQUENCES = Number(process.env.SEQUENCES ?? 20);
const STEPS = Number(process.env.STEPS ?? 12);
const FIRST_SEED = Number(process.env.SEED ?? 1);

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];

interface Window {
  name: string;
  start: Date;
  fridays: string[];
  season: { name: string; heldOn: string };
}
const WINDOWS: Window[] = [
  {
    name: "October 2026",
    start: new Date(londonISO("2026-10-06", "12:00")),
    fridays: ["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"],
    season: { name: "autumn", heldOn: "2026-11-30" },
  },
  {
    name: "March 2027",
    start: new Date(londonISO("2027-03-15", "12:00")),
    fridays: ["2027-03-19", "2027-03-26", "2027-04-02", "2027-04-09"],
    season: { name: "spring", heldOn: "2027-05-31" },
  },
];

/** mulberry32: small, seeded, the same each run. */
function random(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return { next, int, pick: <T>(xs: readonly T[]) => xs[int(xs.length)], chance: (p: number) => next() < p };
}

type Hours = { startTime: string; endTime: string };
const HOURS: Record<string, Hours> = {
  evening: { startTime: "18:00", endTime: "22:00" },
  afternoon: { startTime: "12:00", endTime: "16:00" },
  "past midnight": { startTime: "21:00", endTime: "01:00" },
};

/** A Kumite as the model has it. */
interface Kumite {
  id: number;
  name: string;
  heldOn: string;
  hours: keyof typeof HOURS;
  season: string | null;
  finished: boolean;
}
/** A night's reasons, as the model has them. */
interface Reasons {
  hand: boolean;
  for: Set<number>;
}
/** The London days a Kumite is on: its day, and the next if it runs past midnight; none while it's a season. */
const daysOf = (k: Pick<Kumite, "heldOn" | "hours" | "season">) =>
  k.season ? [] : k.hours === "past midnight" ? [k.heldOn, addDays(k.heldOn, 1)] : [k.heldOn];

/** The world's first Kumite (packages/shared/testing/kumite.ts): next summer, a season, never touched here. */
const FIRST_KUMITE: Kumite = {
  id: 1,
  name: "The Cougars Kumite",
  heldOn: "2027-08-31",
  hours: "afternoon",
  season: "summer",
  finished: false,
};

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** One sequence: its window, its seed's steps, every invariant after each. Throws with what happened, in words. */
async function sequence(seed: number) {
  const rnd = random(seed);
  const win = WINDOWS[seed % WINDOWS.length];
  let now = win.start;
  const log: string[] = [`seed ${seed}, ${win.name}`];
  const say = (line: string) => log.push(line);

  /** Signed in at the window's start: a session made then, as one would be. */
  const signIn = async (email: string) => {
    const b = w.browser();
    const { devCode } = await w.ask(b, email, now);
    expect((await b.call("POST", "/api/auth/verify", { code: devCode }, { now })).status).toBe(200);
    return b;
  };
  const dana = await signIn("dana@example.com");
  const reg = await signIn("reg@example.com");
  await reg.call("PUT", "/api/auth/device", { token: "reg-phone", platform: "ios" }, { now });
  const call = async (method: string, path: string, payload?: unknown) => dana.call(method, path, payload, { now });
  const ok = async (method: string, path: string, payload?: unknown) => {
    const res = await call(method, path, payload);
    if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as Json;
  };
  const raw = w.db.raw;
  const today = () => londonDay(now.toISOString());

  // The first Kumite the world has (a season, next summer) stays as it is: a Kumite on the list that's never touched
  // A second training on Fridays, Juniors at 17:00, its nights made with it
  const juniors = (
    await ok("POST", "/api/series", {
      name: "Juniors",
      shortName: "Juniors",
      icon: "skate",
      tone: "green",
      repeatEvery: 1,
      weekdays: ["fri"],
      startsOn: today(),
      endsOn: null,
      startTime: "17:00",
      endTime: "18:30",
      venue: "The Rink",
      capacity: 16,
      goalieCapacity: 2,
      signupOpensDays: 2,
      public: false,
      active: true,
      fees: [],
    })
  ).id as number;
  const SERIES = [1, juniors];
  await ok("GET", "/api/bootstrap");

  // Every night of ours made (the weeks ahead usually have; one past them is made as the clash sheet makes it)
  const nightKey = (series: number, day: string) => `${series}:${day}`;
  const nightIds = new Map<string, number>();
  for (const series of SERIES)
    for (const day of win.fridays)
      nightIds.set(nightKey(series, day), (await ok("POST", `/api/series/${series}/sessions`, { heldOn: day })).id);
  const NIGHTS = [...nightIds.keys()];
  const dayOfNight = (key: string) => key.split(":")[1];

  // Reg's in on every night, as its sign-up opens (two days before)
  for (const [key, id] of nightIds) {
    const opened = new Date(londonISO(addDays(dayOfNight(key), -2), "12:00"));
    const res = await reg.call("POST", `/api/sessions/${id}/answer`, { answer: "in" }, { now: opened });
    expect(res.status, `Reg in on ${key}`).toBe(200);
  }

  // The model
  const kumites = new Map<number, Kumite>();
  const reasons = new Map<string, Reasons>(NIGHTS.map((k) => [k, { hand: false, for: new Set() }]));
  /** How often each night went off through its cancel (what Reg may be told). */
  const wentOff = new Map<string, number>(NIGHTS.map((k) => [k, 0]));
  /** A night's cancelled_at as it was when its register closed: never to change after. */
  const closedAs = new Map<string, string | null>();
  const isOff = (r: Reasons) => r.hand || r.for.size > 0;
  const closed = (key: string) => registerClosed(dayOfNight(key), now);
  const row = (key: string) =>
    raw
      .prepare("SELECT id, cancelled_at cancelledAt, called_off_at calledOffAt FROM training_sessions WHERE id = ?")
      .get(nightIds.get(key)) as { id: number; cancelledAt: string | null; calledOffAt: string | null };
  const linksOf = (key: string) =>
    (
      raw
        .prepare("SELECT tournament_id t FROM training_session_offs WHERE session_id = ? ORDER BY t")
        .all(nightIds.get(key)) as { t: number }[]
    ).map((l) => l.t);

  /** The model's side of a night going off through its cancel: counted if it was on. */
  const offThroughCancel = (key: string, change: (r: Reasons) => void) => {
    const r = reasons.get(key)!;
    const was = isOff(r);
    change(r);
    if (!was && isOff(r)) wentOff.set(key, wentOff.get(key)! + 1);
  };
  /** A night already off on a Kumite's days is off for it too (after any save of it). */
  const offOnItsDays = (k: Kumite) => {
    for (const key of NIGHTS)
      if (daysOf(k).includes(dayOfNight(key)) && !closed(key) && isOff(reasons.get(key)!))
        reasons.get(key)!.for.add(k.id);
  };

  /** The clash question for a Kumite's day and hours, as its editor asks it; the trainings' nights it lists. */
  const ask = async (k: Kumite) => {
    const h = HOURS[k.hours];
    const startsAt = londonISO(k.heldOn, h.startTime);
    let endsAt = londonISO(k.heldOn, h.endTime);
    if (h.endTime < h.startTime) endsAt = new Date(Date.parse(endsAt) + 86_400_000).toISOString();
    const q = new URLSearchParams({ startsAt, endsAt, except: `tournament:${k.id}` });
    return ((await ok("GET", `/api/calendar/clashes?${q}`)).clashes as Json[]).filter((c) => c.source === "session");
  };
  /** The admin's answer to it, after the save: each night Cancel it (off for the Kumite), or Keep both. */
  const answer = async (k: Kumite, cancel: boolean) => {
    const listed = await ask(k);
    say(
      `  asked: ${listed.map((c) => `${c.seriesId}:${c.day}`).join(", ") || "nothing"} → ${cancel ? "Cancel" : "Keep"}`,
    );
    if (!cancel) return;
    for (const c of listed) {
      const key = nightKey(c.seriesId, c.day);
      const id = c.id ?? (await ok("POST", `/api/series/${c.seriesId}/sessions`, { heldOn: c.day })).id;
      await ok("POST", `/api/sessions/${id}/cancelled`, { cancelled: true, tournamentId: k.id });
      if (reasons.has(key)) offThroughCancel(key, (r) => r.for.add(k.id));
    }
  };
  const body = (k: Kumite) => ({
    typeId: 1,
    name: k.name,
    heldOn: k.season ? win.season.heldOn : k.heldOn,
    season: k.season,
    ...HOURS[k.hours],
    location: "The Rink",
    feePence: 0,
    kind: "teams",
    teams: [],
    ...(k.finished ? { status: "finished" } : {}),
  });
  const DAYS = win.fridays.flatMap((f) => [addDays(f, -1), f, addDays(f, 1)]);
  const someDay = () => rnd.pick(DAYS);
  const someHours = () => rnd.pick(Object.keys(HOURS)) as keyof typeof HOURS;

  // ─── The steps ───
  let made = 0;
  const steps: Record<string, { weight: number; run: () => Promise<void> }> = {
    make: {
      weight: 5,
      run: async () => {
        const k: Kumite = {
          id: 0,
          name: `Kumite ${++made}`,
          heldOn: someDay(),
          hours: someHours(),
          season: rnd.chance(0.1) ? win.season.name : null,
          finished: false,
        };
        const cancel = rnd.chance(0.6);
        say(`make ${k.name} on ${k.season ?? k.heldOn} (${k.hours})`);
        k.id = (await ok("POST", "/api/tournaments", body(k))).id;
        kumites.set(k.id, k);
        offOnItsDays(k);
        if (!k.season) await answer(k, cancel);
      },
    },
    "two on one day": {
      weight: 1,
      run: async () => {
        const other = rnd.pick([...kumites.values()].filter((k) => !k.season));
        if (!other) return;
        const k: Kumite = { ...other, id: 0, name: `Kumite ${++made}`, hours: someHours(), finished: false };
        say(`make ${k.name} on ${k.heldOn} too (${k.hours}), beside ${other.name}`);
        k.id = (await ok("POST", "/api/tournaments", body(k))).id;
        kumites.set(k.id, k);
        offOnItsDays(k);
        await answer(k, rnd.chance(0.6));
      },
    },
    move: {
      weight: 4,
      run: async () => {
        const k = rnd.pick([...kumites.values()]);
        if (!k) return;
        const before = { ...k };
        const how = rnd.pick(["day", "hours", "season", "day"] as const);
        if (how === "day") [k.heldOn, k.season] = [someDay(), null];
        if (how === "hours") k.hours = someHours();
        if (how === "season") k.season = win.season.name;
        say(`move ${k.name} (${how}) to ${k.season ?? k.heldOn} (${k.hours})`);
        await ok("PUT", `/api/tournaments/${k.id}`, body(k));
        // Off for it only on its days now; a night it leaves comes back unless something else keeps it off
        for (const key of NIGHTS)
          if (!closed(key) && !daysOf(k).includes(dayOfNight(key))) reasons.get(key)!.for.delete(k.id);
        offOnItsDays(k);
        // Its editor asks again only when the day or hours moved (lib/clashes.ts tournamentWindow)
        const moved = !k.season && (before.season || before.heldOn !== k.heldOn || before.hours !== k.hours);
        if (moved) await answer(k, rnd.chance(0.6));
      },
    },
    "finish early": {
      weight: 1,
      run: async () => {
        const k = rnd.pick([...kumites.values()].filter((x) => !x.finished));
        if (!k) return;
        k.finished = true;
        say(`finish ${k.name} early`);
        await ok("PUT", `/api/tournaments/${k.id}`, body(k));
        offOnItsDays(k);
      },
    },
    delete: {
      weight: 3,
      run: async () => {
        const k = rnd.pick([...kumites.values()]);
        if (!k) return;
        say(`delete ${k.name}`);
        await ok("DELETE", `/api/tournaments/${k.id}`);
        kumites.delete(k.id);
        for (const key of NIGHTS) if (!closed(key)) reasons.get(key)!.for.delete(k.id);
      },
    },
    "call off by hand": {
      weight: 3,
      run: async () => {
        const key = rnd.pick(NIGHTS);
        say(`call off ${key} by hand${closed(key) ? " (closed)" : ""}`);
        const res = await call("POST", `/api/sessions/${nightIds.get(key)}/cancelled`, { cancelled: true });
        if (closed(key)) return void expect(res.status, log.join("\n")).toBe(409);
        expect(res.status, log.join("\n")).toBe(200);
        offThroughCancel(key, (r) => (r.hand = true));
      },
    },
    "back on": {
      weight: 3,
      run: async () => {
        const key = rnd.pick(NIGHTS);
        say(`It's back on: ${key}${closed(key) ? " (closed)" : ""}`);
        const res = await call("POST", `/api/sessions/${nightIds.get(key)}/cancelled`, { cancelled: false });
        if (closed(key)) return void expect(res.status, log.join("\n")).toBe(409);
        expect(res.status, log.join("\n")).toBe(200);
        reasons.set(key, { hand: false, for: new Set() });
        expect(row(key).cancelledAt, log.join("\n")).toBeNull();
      },
    },
    "one-off": {
      weight: 1,
      run: async () => {
        const day = someDay();
        const cancel = rnd.chance(0.5);
        const startsAt = londonISO(day, "19:00");
        const endsAt = londonISO(day, "23:00");
        say(`a one-off on ${day} → ${cancel ? "Cancel" : "Keep"}`);
        const q = new URLSearchParams({ startsAt, endsAt });
        const clashes = ((await ok("GET", `/api/calendar/clashes?${q}`)).clashes as Json[]).filter(
          (c) => c.source === "session",
        );
        await ok("POST", "/api/club-events", {
          title: `Social on ${day}`,
          startsAt,
          endsAt,
          venue: "The Fox",
          description: "",
          public: false,
          signup: false,
        });
        if (!cancel) return;
        for (const c of clashes) {
          const id = c.id ?? (await ok("POST", `/api/series/${c.seriesId}/sessions`, { heldOn: c.day })).id;
          await ok("POST", `/api/sessions/${id}/cancelled`, { cancelled: true });
          const key = nightKey(c.seriesId, c.day);
          if (reasons.has(key)) offThroughCancel(key, (r) => (r.hand = true));
        }
      },
    },
    "clock on": {
      weight: 2,
      run: async () => {
        // To a moment a day or few on: some just before, some just after a Saturday's 06:00
        const day = addDays(londonDay(now.toISOString()), 1 + rnd.int(4));
        const time = rnd.pick(["05:59", "06:01", "12:00", "21:00", "23:30"]);
        const next = new Date(londonISO(day, time));
        if (next <= now) return;
        now = next;
        say(`clock on to ${day} ${time} (London)`);
        // A night whose register closed now: as it was is what it stays
        for (const key of NIGHTS) if (closed(key) && !closedAs.has(key)) closedAs.set(key, row(key).cancelledAt);
        await ok("GET", "/api/bootstrap");
      },
    },
  };
  const bag = Object.entries(steps).flatMap(([name, s]) => Array(s.weight).fill(name) as string[]);

  // ─── The invariants ───
  const slugs = new Map(
    (raw.prepare("SELECT id, slug FROM training_series").all() as { id: number; slug: string }[]).map((x) => [
      x.id,
      x.slug,
    ]),
  );
  const pushesFor = (key: string) => {
    const [series, day] = key.split(":");
    const path = `/training/${slugs.get(Number(series))}/${day}`;
    return w.pushes.filter((p) => p.token === "reg-phone" && p.path === path && / is off$/.test(p.title)).length;
  };
  async function check() {
    const where = log.join("\n");
    // 1. Each night: off exactly when the model says, and why; a closed one as it was
    for (const key of NIGHTS) {
      const r = row(key);
      if (closedAs.has(key)) {
        expect(r.cancelledAt, `${key} changed after its register closed\n${where}`).toBe(closedAs.get(key));
        continue;
      }
      const m = reasons.get(key)!;
      expect(r.cancelledAt !== null, `${key} off?\n${where}`).toBe(isOff(m));
      expect(r.calledOffAt !== null, `${key} called off by hand?\n${where}`).toBe(m.hand);
      expect(linksOf(key), `${key} off for which Kumites?\n${where}`).toEqual([...m.for].sort((a, b) => a - b));
    }
    // 3. Reg's still in, told at most once each time a night went off, and at least once if it did
    for (const key of NIGHTS) {
      const signup = raw
        .prepare(
          "SELECT signup FROM attendance WHERE session_id = ? AND member_id = (SELECT id FROM members WHERE email = ?)",
        )
        .get(nightIds.get(key), "reg@example.com") as { signup: string } | undefined;
      expect(signup?.signup, `Reg's answer on ${key}\n${where}`).toBe("in");
      const told = pushesFor(key);
      const times = wentOff.get(key)!;
      expect(told, `Reg told ${key}'s off ${told} times, it went off ${times}\n${where}`).toBeLessThanOrEqual(times);
      if (times) expect(told, `Reg never told ${key}'s off\n${where}`).toBeGreaterThan(0);
    }
    // 4. The calendar's agenda: the nights as they are, every Kumite with a day, none that's gone
    const boot = await ok("GET", "/api/bootstrap");
    for (const a of boot.agenda as Json[]) {
      if (a.source === "session") {
        const s = raw.prepare("SELECT cancelled_at c FROM training_sessions WHERE id = ?").get(a.sourceId) as Json;
        expect(!!a.cancelled, `the agenda's ${a.day} ${a.title} cancelled?\n${where}`).toBe(s.c !== null);
      }
      if (a.source === "tournament")
        expect(
          raw.prepare("SELECT 1 FROM tournaments WHERE id = ?").get(a.sourceId),
          `${a.title} gone\n${where}`,
        ).toBeTruthy();
    }
    for (const k of kumites.values())
      if (!k.season && !k.finished && k.heldOn >= today())
        expect(
          (boot.agenda as Json[]).some((a) => a.source === "tournament" && a.sourceId === k.id && a.day === k.heldOn),
          `${k.name} on the agenda on ${k.heldOn}\n${where}`,
        ).toBe(true);
    // 5. The Kumite's page, opening the app and Home agree, by status then the date
    const evening = londonEvening(now);
    const sent = (boot.tournaments as Tournament[]).filter((t) => t.typeId === 1);
    const current = currentOf(sent, evening);
    // The model's: at its after-party the evening one finished is on; else the soonest not finished, by its day (a
    // season's is its last day), then its hours, the world's first Kumite (next summer, a season) among them
    const listed = [...kumites.values(), FIRST_KUMITE];
    const dayOf = (k: Kumite) => (k.season ? (k === FIRST_KUMITE ? k.heldOn : win.season.heldOn) : k.heldOn);
    const expected =
      listed.find((k) => k.finished && !k.season && k.heldOn === evening) ??
      listed
        .filter((k) => !k.finished)
        .sort(
          (a, b) =>
            dayOf(a).localeCompare(dayOf(b)) ||
            HOURS[a.hours].startTime.localeCompare(HOURS[b.hours].startTime) ||
            a.id - b.id,
        )[0];
    expect(current?.id, `the Kumite that's on, as opening the app sends it\n${where}`).toBe(expected?.id);
    if (current && tournamentPhase(current) !== "past") homeAgrees(boot, current, where);
    // 6. A Kumite's clash question: the trainings' nights on its London days that are on, from today
    const k = rnd.pick([...kumites.values()].filter((x) => !x.season));
    if (k) {
      const listed = (await ask(k)).map((c) => `${c.seriesId}:${c.day}`).sort();
      const expected = SERIES.flatMap((series) =>
        daysOf(k)
          .filter((day) => day >= today() && new Date(`${day}T12:00:00Z`).getUTCDay() === 5)
          .filter((day) => {
            const s = raw
              .prepare("SELECT cancelled_at c FROM training_sessions WHERE series_id = ? AND held_on = ?")
              .get(series, day) as Json;
            return !s || s.c === null;
          })
          .map((day) => `${series}:${day}`),
      ).sort();
      expect(listed, `${k.name}'s clash question\n${where}`).toEqual(expected);
    }
  }
  /** Home's lead and Coming up, from what opening the app sends, as Home reads them: its Kumite is the one that's on. */
  function homeAgrees(boot: Json, current: Tournament, where: string) {
    const type = (boot.tournamentTypes as TournamentType[]).find((t) => t.id === 1)!;
    const events: UpcomingEvent[] = [
      ...(boot.sessions as Json[]).map((s) => {
        const series = (boot.series as Json[]).find((x) => x.id === s.seriesId);
        const startsAt = londonISO(s.heldOn, s.startTime ?? series.startTime);
        return {
          key: `session:${s.id}`,
          kind: "training",
          filter: `series:${s.seriesId}`,
          icon: "stick",
          title: series.name,
          startsAt,
          endsAt: londonISO(s.heldOn, s.endTime ?? series.endTime),
          venue: "",
          cancelled: !!s.cancelledAt,
          phase: nightPhase({ heldOn: s.heldOn, startsAt, registerClosedAt: s.registerClosedAt }, now),
          standing: null,
          asking: false,
        } as UpcomingEvent;
      }),
      ...(boot.tournaments as Tournament[]).map(
        (t) =>
          ({
            key: `tournament:${t.id}`,
            kind: "tournament",
            filter: `type:${t.typeId}`,
            icon: "trophy",
            title: t.name,
            startsAt: londonISO(t.heldOn, t.startTime),
            endsAt: londonISO(t.heldOn, t.endTime),
            venue: "",
            dateTbc: !!t.season,
            season: t.season ? { name: t.season, year: Number(t.heldOn.slice(0, 4)) } : undefined,
            phase: tournamentPhase(t),
            standing: null,
            asking: false,
          }) as UpcomingEvent,
      ),
    ];
    const feed = homeFeed({
      me: 0,
      today: today(),
      now: now.toISOString(),
      runsDrafts: false,
      agenda: [],
      tournaments: boot.tournaments,
      types: [type],
      upcoming: [],
      club: null,
      events,
    });
    const dated = feed.upcoming.filter((r) => !r.on.season && !r.on.tbc).map((r) => r.on.at);
    expect(dated, `Coming up in date order\n${where}`).toEqual([...dated].sort());
    const kumite =
      feed.lead?.kind === "event" && feed.lead.key.startsWith("tournament:")
        ? feed.lead.key
        : feed.upcoming.find((r) => r.key.startsWith("tournament:"))?.key;
    if (kumite === undefined && feed.upcoming.length >= 7) return;
    expect(kumite, `Home's Kumite is the one that's on\n${where}`).toBe(`tournament:${current.id}`);
  }

  await check();
  for (let i = 0; i < STEPS; i++) {
    await steps[rnd.pick(bag)].run();
    await check();
  }
}

describe("nights and Kumites, in any order: random sequences checked after every step", () => {
  for (let seed = FIRST_SEED; seed < FIRST_SEED + SEQUENCES; seed++)
    it(`sequence ${seed}`, async () => {
      await sequence(seed);
    });
});
