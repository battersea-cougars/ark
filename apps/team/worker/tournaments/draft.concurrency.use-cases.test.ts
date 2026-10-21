// Draft night, everyone at once (docs/load-testing.md): eight captains with the page open, whoever runs the draft
// beside them, taps landing together. A real D1 runs each statement atomically but interleaves two requests'
// statements between their awaits; the fake D1 does the same (`interleave`, a seed each run). Driven through the real
// Worker handlers, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";
import { onTheClock } from "../../src/lib/draft";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const CAPTAINS = 8;
const PLAYERS = 24;
const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Dev Admin", position: "D", rating: 70, email: "dev@example.com", roles: ["Admin"] },
  ...Array.from({ length: CAPTAINS }, (_, i) => ({
    name: `Captain ${i + 1}`,
    position: "F",
    rating: 60,
    email: `c${i + 1}@example.com`,
  })),
  ...Array.from({ length: PLAYERS }, (_, i) => ({
    name: `Player ${i + 1}`,
    // Two goalies among them
    position: i < 2 ? "G" : i % 2 ? "F" : "D",
    rating: 50,
    email: `p${i + 1}@example.com`,
  })),
];
const SEEDS = [1, 2, 3, 4, 5];
const DRAFT_DAY = new Date("2026-12-08T19:30:00Z");
const at = { now: DRAFT_DAY };

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Phone = Awaited<ReturnType<typeof w.signedIn>>;

/** A draft-kind tournament with eight captains and everyone signed up, the order not yet set. */
async function draftNight() {
  const dana = await w.signedIn("dana@example.com");
  const dev = await w.signedIn("dev@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  const type = await dana.call("POST", "/api/tournament-types", {
    name: "Summer Cup",
    shortName: "Cup",
    icon: "trophy",
    tone: "green",
    kind: "draft",
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    gameMinutes: 12,
    active: true,
    defaultFeePence: 0,
    defaultStartTime: "19:30",
    defaultEndTime: "21:30",
    awards: [],
    location: "Battersea Park courts",
  });
  expect(type.status).toBe(201);
  const captains = Array.from({ length: CAPTAINS }, (_, i) => idOf(`Captain ${i + 1}`));
  const made = await dana.call("POST", "/api/tournaments", {
    typeId: type.body.id,
    name: "Winter Cup 2026",
    location: "",
    heldOn: "2026-12-12",
    startTime: "11:00",
    endTime: "16:00",
    capacity: 60,
    status: "open",
    feePence: 0,
    signupClosesOn: "2026-12-05",
    draftOn: "2026-12-08",
    teams: captains.map((captainMemberId) => ({ name: "", logo: null, captainMemberId, players: [] })),
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  const players = Array.from({ length: PLAYERS }, (_, i) => idOf(`Player ${i + 1}`));
  const phones = new Map<number, Phone>();
  for (let i = 1; i <= PLAYERS; i++) {
    const p = await w.signedIn(`p${i}@example.com`);
    expect((await p.call("POST", `/api/tournaments/${id}/answer`, { answer: "in" })).status).toBe(200);
    phones.set(players[i - 1], p);
  }
  const captainPhones: Phone[] = [];
  for (let i = 1; i <= CAPTAINS; i++) captainPhones.push(await w.signedIn(`c${i}@example.com`));
  const draft = (as: Phone, what: "draw" | "open" | "close") =>
    as.call("POST", `/api/tournaments/${id}/draft/${what}`, {}, at);
  /** A pick, for the turn the app sees now (the picks made so far), as the Draft page sends it. */
  const pick = (as: Phone, memberId: number, turn = picks().length) =>
    as.call("POST", `/api/tournaments/${id}/draft/picks`, { memberId, turn }, at);
  const undo = (as: Phone) => as.call("DELETE", `/api/tournaments/${id}/draft/picks/last`, undefined, at);
  const teams = () =>
    w.db.raw
      .prepare("SELECT id, captain_member_id captain, pick FROM tournament_teams WHERE tournament_id = ? ORDER BY pick")
      .all(id) as { id: number; captain: number; pick: number | null }[];
  const picks = () =>
    w.db.raw
      .prepare(
        `SELECT p.member_id member, p.team_id team, p.pick_number n FROM tournament_team_players p
         JOIN tournament_teams t ON t.id = p.team_id WHERE t.tournament_id = ? ORDER BY p.pick_number`,
      )
      .all(id) as { member: number; team: number; n: number }[];
  /** The captain's phone on the clock now, and the others. */
  const onClock = () => {
    const order = teams();
    const team = order[onTheClock(order.length, picks().length)];
    const i = captains.indexOf(team.captain);
    return { phone: captainPhones[i], others: captainPhones.filter((_, k) => k !== i), team };
  };
  /** The draft's invariants: each pick numbered 1…n in turn, each on the team whose turn it was, nobody twice. */
  const holds = () => {
    const order = teams();
    const all = picks();
    expect(all.map((p) => p.n)).toEqual(all.map((_, i) => i + 1));
    for (const p of all) expect(p.team).toBe(order[onTheClock(order.length, p.n - 1)].id);
    expect(new Set(all.map((p) => p.member)).size).toBe(all.length);
    for (const p of all) expect(captains).not.toContain(p.member);
  };
  const pool = () => {
    const taken = new Set(picks().map((p) => p.member));
    return players.filter((m) => !taken.has(m));
  };
  return {
    id,
    dana,
    dev,
    captains,
    players,
    phones,
    captainPhones,
    draft,
    pick,
    undo,
    teams,
    picks,
    onClock,
    holds,
    pool,
  };
}

async function opened() {
  const d = await draftNight();
  expect((await d.draft(d.dana, "draw")).status).toBe(200);
  expect((await d.draft(d.dana, "open")).status).toBe(200);
  return d;
}

describe("draft night: taps at once", () => {
  it.each(SEEDS)(
    "Set the order, tapped by two admins at once: one draw, every captain once from 1 (seed %i)",
    async (seed) => {
      const d = await draftNight();
      w.db.interleave(seed);
      const [a, b] = await Promise.all([d.draft(d.dana, "draw"), d.draft(d.dev, "draw")]);
      w.db.interleave(null);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(
        d
          .teams()
          .map((t) => t.pick)
          .sort((x, y) => x! - y!),
      ).toEqual(Array.from({ length: CAPTAINS }, (_, i) => i + 1));
    },
  );

  it.each(SEEDS)("every captain taps Pick at once: only the one on the clock gets a player (seed %i)", async (seed) => {
    const d = await opened();
    w.db.interleave(seed);
    const pool = d.pool();
    const { phone, team } = d.onClock();
    const replies = await Promise.all(d.captainPhones.map((p, i) => d.pick(p, pool[i])));
    w.db.interleave(null);
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(replies[d.captainPhones.indexOf(phone)].status).toBe(200);
    expect(d.picks()).toEqual([{ member: pool[d.captainPhones.indexOf(phone)], team: team.id, n: 1 }]);
    d.holds();
  });

  it.each(SEEDS)("the captain on the clock on two phones, two players at once: one pick (seed %i)", async (seed) => {
    const d = await opened();
    const { team } = d.onClock();
    const second = await w.signedIn(`c${d.captains.indexOf(team.captain) + 1}@example.com`);
    const pool = d.pool();
    w.db.interleave(seed);
    const replies = await Promise.all([d.pick(d.onClock().phone, pool[0]), d.pick(second, pool[1])]);
    w.db.interleave(null);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(d.picks()).toHaveLength(1);
    d.holds();
  });

  it.each(SEEDS)(
    "the captain whose snake turn comes twice running, on two phones: one pick, the next one still theirs (seed %i)",
    async (seed) => {
      const d = await opened();
      // Seven picks in: the eighth captain is on the clock, and picks again straight after (snake order)
      for (let k = 0; k < CAPTAINS - 1; k++) expect((await d.pick(d.onClock().phone, d.pool()[0])).status).toBe(200);
      const { phone, team } = d.onClock();
      const second = await w.signedIn(`c${d.captains.indexOf(team.captain) + 1}@example.com`);
      const pool = d.pool();
      w.db.interleave(seed);
      const replies = await Promise.all([d.pick(phone, pool[0]), d.pick(second, pool[1])]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(d.picks()).toHaveLength(CAPTAINS);
      expect(d.onClock().team.id).toBe(team.id);
      d.holds();
    },
  );

  it.each(SEEDS)(
    "the same player picked by the captain and whoever runs the draft at once: one wins (seed %i)",
    async (seed) => {
      const d = await opened();
      const [player] = d.pool();
      w.db.interleave(seed);
      const replies = await Promise.all([d.pick(d.onClock().phone, player), d.pick(d.dana, player)]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(d.picks().map((p) => p.member)).toEqual([player]);
      d.holds();
    },
  );

  it.each(SEEDS)(
    "an admin and the captain pick different players at once: one pick, for that turn (seed %i)",
    async (seed) => {
      const d = await opened();
      const [a, b] = d.pool();
      w.db.interleave(seed);
      const replies = await Promise.all([d.pick(d.onClock().phone, a), d.pick(d.dana, b)]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(d.picks()).toHaveLength(1);
      d.holds();
    },
  );

  it.each(SEEDS)(
    "Undo racing the next pick: the picks stay numbered in turn, each on its team (seed %i)",
    async (seed) => {
      const d = await opened();
      for (let k = 0; k < 5; k++) expect((await d.pick(d.onClock().phone, d.pool()[0])).status).toBe(200);
      w.db.interleave(seed);
      const [undone, picked] = await Promise.all([d.undo(d.dana), d.pick(d.onClock().phone, d.pool()[0])]);
      w.db.interleave(null);
      expect(undone.status).toBe(200);
      // Either the pick landed first and Undo took it back, or Undo went first and the pick (now out of turn) was
      // refused: four or five picks, never a gap or one on the wrong team
      expect([200, 409]).toContain(picked.status);
      expect(d.picks().length).toBe(picked.status === 200 ? 5 : 4);
      d.holds();
    },
  );

  it.each(SEEDS)(
    "a player says they're out just as they're picked: on a team and in, or neither (seed %i)",
    async (seed) => {
      const d = await opened();
      const [player] = d.pool();
      w.db.interleave(seed);
      await Promise.all([
        d.pick(d.onClock().phone, player),
        d.phones.get(player)!.call("POST", `/api/tournaments/${d.id}/answer`, { answer: "out" }, at),
      ]);
      w.db.interleave(null);
      const signup = (
        w.db.raw
          .prepare("SELECT signup FROM tournament_entries WHERE tournament_id = ? AND member_id = ?")
          .get(d.id, player) as { signup: string }
      ).signup;
      const onTeam = d.picks().some((p) => p.member === player);
      expect({ signup, onTeam }).toSatisfy(
        (x: { signup: string; onTeam: boolean }) => (x.signup === "in") === x.onTeam,
      );
    },
  );

  it.each(SEEDS)(
    "the whole draft with every captain tapping each turn: every player once, each in turn (seed %i)",
    async (seed) => {
      const d = await opened();
      w.db.interleave(seed);
      for (let turn = 0; d.pool().length; turn++) {
        const pool = d.pool();
        // Everyone taps someone; the goalies go when they go (one a team: a second is refused)
        await Promise.all(d.captainPhones.map((p, i) => d.pick(p, pool[(i + turn) % pool.length])));
        expect(turn).toBeLessThan(PLAYERS * 3);
      }
      w.db.interleave(null);
      expect(d.picks()).toHaveLength(PLAYERS);
      d.holds();
    },
  );

  it.each(SEEDS)(
    "an admin puts a goalie on a team just as its captain picks the other: still one goalie a team (seed %i)",
    async (seed) => {
      const d = await opened();
      const [g1, g2] = d.players.slice(0, 2);
      const { phone, team } = d.onClock();
      w.db.interleave(seed);
      await Promise.all([
        d.pick(phone, g1),
        d.dana.call("POST", `/api/tournaments/${d.id}/teams/${team.id}/players`, { memberId: g2 }, at),
      ]);
      w.db.interleave(null);
      const goalies = w.db.raw
        .prepare(
          `SELECT COUNT(*) n FROM tournament_team_players p JOIN members m ON m.id = p.member_id
           WHERE p.team_id = ? AND m.position = 'G'`,
        )
        .get(team.id) as { n: number };
      expect(goalies.n).toBeLessThanOrEqual(1);
    },
  );
});
