// Scoring a game live, taps landing together (docs/load-testing.md): the scorekeeper may have the game open on two
// phones (ADR 0072), and a tap can land just as another does. A real D1 runs each statement atomically but interleaves
// two requests' statements between their awaits; the fake D1 does the same (`interleave`, a seed each run). Driven
// through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Captain", position: "F", rating: 60, email: "reg@example.com" },
];
const SEEDS = seeds(5);
const at = (minutes: number) => ({ now: new Date(NOW.getTime() + minutes * 60_000) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Phone = Awaited<ReturnType<typeof w.signedIn>>;

/**
 * A three-team cup in three periods, its first game on: its scorekeeper (the team sitting it out) holds the sheet on
 * one phone and has it open on a second, signed in as themselves.
 */
async function gameOn() {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  const captains = { Ants: idOf("Cara Captain"), Bees: idOf("Cole Captain"), Cats: idOf("Reg Captain") };
  const res = await dana.call("POST", "/api/tournaments", {
    name: "Summer Cup",
    location: "Battersea Park",
    heldOn: "2026-11-14",
    startTime: "10:00",
    endTime: "15:00",
    status: "planned",
    feePence: 0,
    kind: "teams",
    playoffs: [],
    periods: 3,
    teams: Object.entries(captains).map(([name, captainMemberId]) => ({
      name,
      logo: null,
      captainMemberId,
      players: [],
    })),
  });
  expect(res.status).toBe(201);
  const id = res.body.id as number;
  expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
  const t = ((await dana.call("GET", "/api/bootstrap")).body as Json).tournaments.find((x: Json) => x.id === id);
  const game = t.games[0];
  const keeperEmail = ROSTER.find(
    (r) => idOf(r.name) === t.teams.find((x: Json) => x.id === game.scoringTeamId).captainMemberId,
  )!.email;
  const phone = await w.signedIn(keeperEmail);
  const other = await w.signedIn(keeperEmail);
  const path = `/api/tournaments/${id}/games/${game.id}`;
  expect((await phone.call("POST", `${path}/scorer`, { action: "claim" }, at(0))).status).toBe(200);
  expect((await phone.call("POST", `${path}/clock`, { action: "start" }, at(0))).status).toBe(200);
  const home = game.homeTeamId as number;
  const away = game.awayTeamId as number;
  const scorer = t.teams.find((x: Json) => x.id === home).captainMemberId as number;
  const goal = (p: Phone, teamId = home, when = 3) =>
    p.call("POST", `${path}/goals`, { teamId, scorerId: teamId === home ? scorer : null }, at(when));
  const penalty = (p: Phone, when = 3) =>
    p.call("POST", `${path}/penalties`, { teamId: away, infraction: "delay-of-game" }, at(when));
  const clock = (p: Phone, action: string, when: number, extra: object = {}) =>
    p.call("POST", `${path}/clock`, { action, ...extra }, at(when));
  const row = () =>
    w.db.raw
      .prepare("SELECT status, period, home_goals home, away_goals away FROM tournament_games WHERE id = ?")
      .get(game.id) as { status: string; period: number; home: number; away: number };
  const goals = () =>
    w.db.raw.prepare("SELECT team_id team FROM tournament_goals WHERE game_id = ? ORDER BY id").all(game.id) as {
      team: number;
    }[];
  const penalties = () =>
    (w.db.raw.prepare("SELECT COUNT(*) n FROM tournament_penalties WHERE game_id = ?").get(game.id) as { n: number }).n;
  /** What the record says the result was, each time it was called. */
  const results = () =>
    (
      w.db.raw.prepare("SELECT detail FROM audit_log WHERE action = 'game.scored' ORDER BY id").all() as {
        detail: string;
      }[]
    ).map((r) => JSON.parse(r.detail).to as { homeGoals: number; awayGoals: number } | null);
  return { path, phone, other, home, away, goal, penalty, clock, row, goals, penalties, results };
}

describe("scoring live: taps at once", () => {
  it.each(SEEDS)(
    "the same goal sent from the scorekeeper's two phones at once is two goals; Undo takes one back (seed %i)",
    async (seed) => {
      // Nothing retries a change on its own (backend.ts `save`), and a goal has no id from the phone (#114), so two posts
      // are two goals, the way two goals a second apart are. The scorekeeper sees 2–0 and takes one back
      const g = await gameOn();
      w.db.interleave(seed);
      const replies = await Promise.all([g.goal(g.phone), g.goal(g.other)]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status)).toEqual([200, 200]);
      expect(g.row()).toMatchObject({ home: 2, away: 0 });
      expect((await g.phone.call("DELETE", `${g.path}/goals/last`, undefined, at(4))).status).toBe(200);
      expect(g.row()).toMatchObject({ home: 1, away: 0 });
    },
  );

  it.each(SEEDS)("end of the 1st period said by both phones at once: the 2nd, not the 3rd (seed %i)", async (seed) => {
    const g = await gameOn();
    w.db.interleave(seed);
    const replies = await Promise.all([
      g.clock(g.phone, "period", 12, { period: 1 }),
      g.clock(g.other, "period", 12, { period: 1 }),
    ]);
    w.db.interleave(null);
    expect(replies.map((r) => r.status)).toEqual([200, 200]);
    expect(g.row()).toMatchObject({ status: "live", period: 2 });
  });

  it.each(SEEDS)("full time called twice at once: one result, as scored (seed %i)", async (seed) => {
    const g = await gameOn();
    await g.goal(g.phone);
    w.db.interleave(seed);
    const replies = await Promise.all([g.clock(g.phone, "end", 12), g.clock(g.other, "end", 12)]);
    w.db.interleave(null);
    expect(replies.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(g.row()).toMatchObject({ status: "done", home: 1, away: 0 });
    for (const r of g.results()) expect(r).toEqual(expect.objectContaining({ homeGoals: 1, awayGoals: 0 }));
  });

  // Seed 35: the goal goes in while the game's on, full time lands and its result is read (0–0), and only then the
  // goal's score; the result said 0–0 and the game 1–0, until the goal and its score went in one batch
  it.each(seeds(5, 35))(
    "a goal landing just as full time is called: in the result, or refused, never after it (seed %i)",
    async (seed) => {
      const g = await gameOn();
      w.db.interleave(seed);
      const [scored] = await Promise.all([g.goal(g.other, g.home, 11), g.clock(g.phone, "end", 11)]);
      w.db.interleave(null);
      expect(g.row().status).toBe("done");
      // What the record says the result was is the score on the game: no goal slipped in after the whistle
      const result = g.results()[0]!;
      expect(g.row()).toMatchObject({ home: result.homeGoals, away: result.awayGoals });
      expect(g.goals()).toHaveLength(scored.status === 200 ? g.row().home : 0);
    },
  );

  it.each(SEEDS)("goals and penalties at once all land, and the score counts the goals (seed %i)", async (seed) => {
    const g = await gameOn();
    w.db.interleave(seed);
    await Promise.all([
      g.goal(g.phone, g.home, 2),
      g.penalty(g.other, 2),
      g.goal(g.other, g.away, 2),
      g.penalty(g.phone, 2),
      g.goal(g.phone, g.home, 2),
    ]);
    w.db.interleave(null);
    expect(g.row()).toMatchObject({ home: 2, away: 1 });
    expect(g.goals()).toHaveLength(3);
    expect(g.penalties()).toBe(2);
  });
});
