// Scoring's edges (ADR 0061): every tap the game's state doesn't allow is refused and changes nothing (a goal before
// the start or after full time, ending a period twice or the last one, Undo with nothing to undo, starting a game
// that's over), who may do what (not signed in, a member who isn't holding the sheet, a scorekeeper on another game,
// an admin), what a tap may say (wrong types, out of range, a game or team from another tournament), and an admin's
// corrections after the day, playoffs included. Driven through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Captain", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Member", position: "G", rating: 55, email: "mo@example.com" },
];
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Phone = { call: Json };
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A cup three teams entered, each captained by a member, with its fixtures made (and its playoffs, if any). */
async function cup(playoffs: { name: string; home: number; away: number }[] = [], extra: object = {}) {
  const dana = await w.signedIn("dana@example.com");
  const sees = async (as: Phone = dana, now = NOW) =>
    (await as.call("GET", "/api/bootstrap", undefined, { now })).body as Json;
  const boot = await sees();
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
    playoffs,
    ...extra,
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
  const tournament = async (as: Phone = dana, now = NOW) =>
    (await sees(as, now)).tournaments.find((t: Json) => t.id === id);
  const t = await tournament();
  const emailOf = new Map<number, string>(
    t.teams.map((team: Json) => [team.id, ROSTER.find((r) => idOf(r.name) === team.captainMemberId)!.email]),
  );
  const path = (gameId: number) => `/api/tournaments/${id}/games/${gameId}`;
  const as = async (teamId: number) => w.signedIn(emailOf.get(teamId)!);
  const clock = (who: Phone, gameId: number, action: string, now = NOW, more: object = {}) =>
    who.call("POST", `${path(gameId)}/clock`, { action, ...more }, { now });
  const goal = (who: Phone, gameId: number, body: object, now = NOW) =>
    who.call("POST", `${path(gameId)}/goals`, body, { now });
  const penalty = (who: Phone, gameId: number, body: object, now = NOW) =>
    who.call("POST", `${path(gameId)}/penalties`, body, { now });
  const sheet = (who: Phone, gameId: number, action: "claim" | "release", now = NOW) =>
    who.call("POST", `${path(gameId)}/scorer`, { action }, { now });
  const score = (gameId: number, homeGoals: unknown, awayGoals: unknown, who: Phone = dana) =>
    who.call("PUT", path(gameId), { homeGoals, awayGoals });
  const keeperOf = async (game: Json) => {
    const k = await as(game.scoringTeamId);
    expect((await sheet(k, game.id, "claim")).status).toBe(200);
    return k;
  };
  const game = async (gameId: number) => (await tournament()).games.find((x: Json) => x.id === gameId);
  const captainOf = (teamId: number) => t.teams.find((x: Json) => x.id === teamId).captainMemberId as number;
  return {
    dana,
    id,
    path,
    tournament,
    game,
    first: t.games[0] as Json,
    games: t.games as Json[],
    teams: t.teams as Json[],
    as,
    clock,
    goal,
    penalty,
    sheet,
    score,
    keeperOf,
    captainOf,
    idOf,
    gameMinutes: t.gameMinutes as number,
  };
}

/** What the game's row says, straight from D1: so a refused tap is seen to change nothing. */
const row = (gameId: number) =>
  w.db.raw
    .prepare(
      `SELECT status, period, home_goals home, away_goals away, keeper_member_id keeper, clock_left_ms leftMs,
              clock_started_at startedAt FROM tournament_games WHERE id = ?`,
    )
    .get(gameId) as Json;
const goalsIn = (gameId: number) =>
  (w.db.raw.prepare("SELECT count(*) n FROM tournament_goals WHERE game_id = ?").get(gameId) as { n: number }).n;
const penaltiesIn = (gameId: number) =>
  (w.db.raw.prepare("SELECT count(*) n FROM tournament_penalties WHERE game_id = ?").get(gameId) as { n: number }).n;

describe("the game's state: a tap it doesn't allow is refused and changes nothing", () => {
  it("before the clock's started, a goal, a penalty, a pause, a period's end, full time and Undo are all refused", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    const before = row(c.first.id);
    for (const res of [
      await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }),
      await c.penalty(keeper, c.first.id, { teamId: c.first.homeTeamId, infraction: "delay-of-game" }),
      await c.clock(keeper, c.first.id, "pause"),
      await c.clock(keeper, c.first.id, "set", NOW, { leftMs: 60_000 }),
      await c.clock(keeper, c.first.id, "period", NOW, { period: 1 }),
      await c.clock(keeper, c.first.id, "end"),
      await keeper.call("DELETE", `${c.path(c.first.id)}/goals/last`),
      await keeper.call("DELETE", `${c.path(c.first.id)}/penalties/last`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/isn't on/);
    }
    expect(row(c.first.id)).toEqual(before);
    expect(goalsIn(c.first.id) + penaltiesIn(c.first.id)).toBe(0);
  });

  it("Undo with no goals or penalties yet says so, and the score stays 0–0", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    const goal = await keeper.call("DELETE", `${c.path(c.first.id)}/goals/last`, undefined, { now: at(1) });
    expect(goal.status).toBe(409);
    expect(goal.body.error).toMatch(/No goals/);
    const pen = await keeper.call("DELETE", `${c.path(c.first.id)}/penalties/last`, undefined, { now: at(1) });
    expect(pen.status).toBe(409);
    expect(pen.body.error).toMatch(/No penalties/);
    expect(row(c.first.id)).toMatchObject({ status: "live", home: 0, away: 0 });
  });

  it("Undo takes back only goals, not a penalty; Undo of a penalty only penalties", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }, at(1));
    await c.penalty(keeper, c.first.id, { teamId: c.first.awayTeamId, infraction: "delay-of-game" }, at(2));
    expect((await keeper.call("DELETE", `${c.path(c.first.id)}/goals/last`, undefined, { now: at(3) })).status).toBe(
      200,
    );
    expect(penaltiesIn(c.first.id)).toBe(1);
    expect(row(c.first.id)).toMatchObject({ home: 0, away: 0 });
    // Nothing left to undo of goals, the penalty still on
    expect((await keeper.call("DELETE", `${c.path(c.first.id)}/goals/last`, undefined, { now: at(3) })).status).toBe(
      409,
    );
    expect(penaltiesIn(c.first.id)).toBe(1);
  });

  it("starting the clock while it's running is refused; pausing a paused clock does nothing", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    expect((await c.clock(keeper, c.first.id, "start", at(0))).status).toBe(200);
    const again = await c.clock(keeper, c.first.id, "start", at(1));
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already running/);
    expect((await c.clock(keeper, c.first.id, "pause", at(2))).status).toBe(200);
    const paused = row(c.first.id);
    expect((await c.clock(keeper, c.first.id, "pause", at(5))).status).toBe(200);
    // Three minutes paused took nothing off the clock
    expect(row(c.first.id)).toEqual(paused);
    expect(paused.leftMs).toBe(c.gameMinutes * 60_000 - 2 * 60_000);
  });

  it("a game that's over can't be started, scored or ended again by its scorekeeper", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }, at(1));
    expect((await c.clock(keeper, c.first.id, "end", at(12))).status).toBe(200);
    const done = row(c.first.id);
    for (const action of ["start", "pause", "end"]) {
      const res = await c.clock(keeper, c.first.id, action, at(13));
      expect(res.status).toBe(409);
    }
    expect((await keeper.call("DELETE", `${c.path(c.first.id)}/goals/last`, undefined, { now: at(13) })).status).toBe(
      409,
    );
    expect(row(c.first.id)).toEqual(done);
    expect(goalsIn(c.first.id)).toBe(1);
  });

  it("a game that's over can't have its scoresheet taken on again", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    await c.clock(keeper, c.first.id, "end", at(12));
    expect((await c.sheet(keeper, c.first.id, "release", at(13))).status).toBe(200);
    const res = await c.sheet(keeper, c.first.id, "claim", at(13));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/over/);
  });

  it("a one-period game has no end of period: the scorekeeper calls full time", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    const res = await c.clock(keeper, c.first.id, "period", at(12), { period: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/last period/);
    expect(row(c.first.id)).toMatchObject({ status: "live", period: 1 });
  });

  it("in three periods: ending a period not yet reached is refused; one already ended does nothing; the 3rd's end is full time's job", async () => {
    const c = await cup([], { periods: 3 });
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    const ahead = await c.clock(keeper, c.first.id, "period", at(1), { period: 2 });
    expect(ahead.status).toBe(409);
    expect(ahead.body.error).toMatch(/1st/);
    expect((await c.clock(keeper, c.first.id, "period", at(12), { period: 1 })).status).toBe(200);
    // A second phone, or a retry, saying the 1st is over again: still the 2nd
    expect((await c.clock(keeper, c.first.id, "period", at(13), { period: 1 })).status).toBe(200);
    expect(row(c.first.id).period).toBe(2);
    await c.clock(keeper, c.first.id, "start", at(14));
    await c.clock(keeper, c.first.id, "period", at(26), { period: 2 });
    await c.clock(keeper, c.first.id, "start", at(28));
    const last = await c.clock(keeper, c.first.id, "period", at(40), { period: 3 });
    expect(last.status).toBe(409);
    expect(row(c.first.id)).toMatchObject({ status: "live", period: 3 });
    expect((await c.clock(keeper, c.first.id, "end", at(40))).status).toBe(200);
  });

  it("full time can be called in the 1st of three periods (a game cut short), and it's the result as it stands", async () => {
    const c = await cup([], { periods: 3 });
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    await c.goal(keeper, c.first.id, { teamId: c.first.awayTeamId }, at(2));
    expect((await c.clock(keeper, c.first.id, "end", at(5))).status).toBe(200);
    expect(row(c.first.id)).toMatchObject({ status: "done", period: 1, home: 0, away: 1 });
  });

  it("the clock never goes below nothing: a goal after it's run out is timed at the end of the period", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    // Long past the period's length, the clock still running
    expect((await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }, at(c.gameMinutes + 7))).status).toBe(200);
    const g = await c.game(c.first.id);
    expect(g.goals[0].atMs).toBe(c.gameMinutes * 60_000);
    await c.clock(keeper, c.first.id, "pause", at(c.gameMinutes + 8));
    expect(row(c.first.id).leftMs).toBe(0);
  });

  it("a game further down the day can't be started while the first isn't over, even by its own scorekeeper", async () => {
    const c = await cup();
    const second = c.games[1];
    const k = await c.as(second.scoringTeamId);
    // Can't take it on: not up next
    expect((await c.sheet(k, second.id, "claim")).status).toBe(409);
    expect((await c.clock(k, second.id, "start")).status).toBe(403);
    expect(row(second.id)).toMatchObject({ status: "next", keeper: null });
  });

  it("a game started again after a pause runs on from where it stopped", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    await c.clock(keeper, c.first.id, "pause", at(3));
    await c.clock(keeper, c.first.id, "start", at(10));
    await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }, at(11));
    // Three minutes, then one: four minutes in, the seven paused not counted
    expect((await c.game(c.first.id)).goals[0].atMs).toBe(4 * 60_000);
  });
});

describe("who can score: everyone else is refused", () => {
  it("someone not signed in can't take the scoresheet, run the clock, log a goal or a penalty, undo, or type a result", async () => {
    const c = await cup();
    const stranger = w.browser();
    const p = c.path(c.first.id);
    for (const [method, path, body] of [
      ["POST", `${p}/scorer`, { action: "claim" }],
      ["POST", `${p}/clock`, { action: "start" }],
      ["POST", `${p}/goals`, { teamId: c.first.homeTeamId }],
      ["POST", `${p}/penalties`, { teamId: c.first.homeTeamId, infraction: "delay-of-game" }],
      ["DELETE", `${p}/goals/last`, undefined],
      ["DELETE", `${p}/penalties/last`, undefined],
      ["DELETE", `${p}/goals/1`, undefined],
      ["DELETE", `${p}/penalties/1`, undefined],
      ["PUT", p, { homeGoals: 1, awayGoals: 0 }],
    ] as const) {
      const res = await stranger.call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(row(c.first.id)).toMatchObject({ status: "next", keeper: null });
  });

  it("a member who isn't holding the scoresheet can't run the clock, log, or undo; the holder's game carries on", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }, at(1));
    // A player in the game, and a member watching
    const player = await c.as(c.first.homeTeamId);
    const mo = await w.signedIn("mo@example.com");
    for (const who of [player, mo]) {
      for (const res of [
        await c.clock(who, c.first.id, "pause", at(2)),
        await c.clock(who, c.first.id, "end", at(2)),
        await c.clock(who, c.first.id, "set", at(2), { leftMs: 0 }),
        await c.clock(who, c.first.id, "period", at(2), { period: 1 }),
        await c.goal(who, c.first.id, { teamId: c.first.homeTeamId }, at(2)),
        await c.penalty(who, c.first.id, { teamId: c.first.awayTeamId, infraction: "delay-of-game" }, at(2)),
        await who.call("DELETE", `${c.path(c.first.id)}/goals/last`, undefined, { now: at(2) }),
        await who.call("DELETE", `${c.path(c.first.id)}/penalties/last`, undefined, { now: at(2) }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Someone else/);
      }
      // Nor let go of someone else's sheet
      expect((await c.sheet(who, c.first.id, "release", at(2))).status).toBe(403);
    }
    expect(row(c.first.id)).toMatchObject({ status: "live", home: 1, away: 0 });
  });

  it("a member can't type in a result or take a goal off a finished game: only an admin", async () => {
    const c = await cup();
    const mo = await w.signedIn("mo@example.com");
    expect((await c.score(c.first.id, 1, 0, mo)).status).toBe(403);
    await c.score(c.first.id, 2, 0);
    const g = await c.game(c.first.id);
    expect((await mo.call("DELETE", `${c.path(c.first.id)}/goals/${g.goals[0].id}`)).status).toBe(403);
    expect((await c.goal(mo, c.first.id, { teamId: c.first.awayTeamId })).status).toBe(403);
    expect(row(c.first.id)).toMatchObject({ home: 2, away: 0 });
  });

  it("an admin can't log a goal in a game someone else is scoring live: they hand it over first", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    const res = await c.goal(c.dana, c.first.id, { teamId: c.first.homeTeamId }, at(1));
    expect(res.status).toBe(403);
    // Let go by the admin, it's theirs to take on
    expect((await c.sheet(c.dana, c.first.id, "release", at(2))).status).toBe(200);
    expect((await c.sheet(c.dana, c.first.id, "claim", at(2))).status).toBe(200);
    expect((await c.goal(c.dana, c.first.id, { teamId: c.first.homeTeamId }, at(3))).status).toBe(200);
    expect((await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }, at(4))).status).toBe(403);
    expect(row(c.first.id)).toMatchObject({ home: 1, keeper: c.idOf("Dana Admin") });
  });

  it("taking the scoresheet you already hold is fine; one someone else holds is refused", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    expect((await c.sheet(keeper, c.first.id, "claim")).status).toBe(200);
    const mo = await w.signedIn("mo@example.com");
    const res = await c.sheet(mo, c.first.id, "claim");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Someone else/);
  });
});

describe("what a tap says: anything wrong is refused, nothing written", () => {
  it("a goal for a team not in this game, or a team from another tournament, is refused", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    const sittingOut = c.first.scoringTeamId;
    expect((await c.goal(keeper, c.first.id, { teamId: sittingOut }, at(1))).status).toBe(400);
    expect((await c.goal(keeper, c.first.id, { teamId: 999_999 }, at(1))).status).toBe(400);
    expect(goalsIn(c.first.id)).toBe(0);
  });

  it("a goal scored by someone on the other side, sitting out, or a keeper not on the team is refused", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    const home = c.first.homeTeamId;
    for (const scorerId of [
      c.captainOf(c.first.awayTeamId),
      c.captainOf(c.first.scoringTeamId),
      c.idOf("Mo Member"),
      999_999,
    ]) {
      const res = await c.goal(keeper, c.first.id, { teamId: home, scorerId }, at(1));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not on that team/);
    }
    // An assist from the other side too
    expect(
      (
        await c.goal(
          keeper,
          c.first.id,
          { teamId: home, scorerId: c.captainOf(home), assistId: c.captainOf(c.first.awayTeamId) },
          at(1),
        )
      ).status,
    ).toBe(400);
    expect(goalsIn(c.first.id)).toBe(0);
    expect(row(c.first.id)).toMatchObject({ home: 0, away: 0 });
  });

  it("numbers sent as text, fractions, negatives and unknown actions are refused", async () => {
    const c = await cup([], { periods: 3 });
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    const home = c.first.homeTeamId;
    for (const body of [
      { teamId: String(home) },
      { teamId: home + 0.5 },
      { teamId: -home },
      {},
      { teamId: home, scorerId: "1" },
    ])
      expect((await c.goal(keeper, c.first.id, body, at(1))).status, JSON.stringify(body)).toBe(400);
    for (const [action, more] of [
      ["rewind", {}],
      ["", {}],
      ["set", { leftMs: -1 }],
      ["set", { leftMs: 60 * 60_000 + 1 }],
      ["set", { leftMs: "600000" }],
      ["set", {}],
      ["period", { period: 0 }],
      ["period", { period: 4 }],
      ["period", {}],
    ] as const)
      expect((await c.clock(keeper, c.first.id, action, at(1), more)).status, `${action} ${JSON.stringify(more)}`).toBe(
        400,
      );
    expect((await c.sheet(keeper, c.first.id, "steal" as never)).status).toBe(400);
    expect(goalsIn(c.first.id)).toBe(0);
    expect(row(c.first.id)).toMatchObject({ status: "live", period: 1 });
  });

  it("a penalty of an unknown length or for something not on the list (a huge string, an emoji) is refused", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    const teamId = c.first.homeTeamId;
    const memberId = c.captainOf(teamId);
    for (const body of [
      { teamId, memberId, infraction: "tripping", minutes: 3 },
      { teamId, memberId, infraction: "tripping", minutes: 0 },
      { teamId, memberId, infraction: "tripping", minutes: 10 },
      { teamId, memberId, infraction: "tripping", minutes: "2" },
      { teamId, memberId, infraction: "x".repeat(100_000) },
      { teamId, memberId, infraction: "🏒" },
      { teamId, memberId },
      { teamId, memberId: c.captainOf(c.first.awayTeamId), infraction: "tripping" },
    ])
      expect((await c.penalty(keeper, c.first.id, body, at(1))).status).toBe(400);
    expect(penaltiesIn(c.first.id)).toBe(0);
  });

  it("a typed-in result must be two whole numbers from 0 to 99", async () => {
    const c = await cup();
    for (const [h, a] of [
      [-1, 0],
      [100, 0],
      [1.5, 0],
      ["1", 0],
      [null, 0],
      [1, undefined],
    ])
      expect((await c.score(c.first.id, h, a)).status, `${h}–${a}`).toBe(400);
    expect(row(c.first.id)).toMatchObject({ status: "next", home: null, away: null });
    expect((await c.score(c.first.id, 99, 0)).status).toBe(200);
    expect(goalsIn(c.first.id)).toBe(99);
  });

  it("a game asked for under another tournament's id isn't found, and nothing changes", async () => {
    const a = await cup();
    const b = await cup();
    const other = `/api/tournaments/${a.id}/games/${b.first.id}`;
    expect((await a.dana.call("PUT", other, { homeGoals: 1, awayGoals: 0 })).status).toBe(404);
    expect((await a.dana.call("POST", `${other}/scorer`, { action: "claim" })).status).toBe(404);
    expect((await a.dana.call("POST", `${other}/goals`, { teamId: b.first.homeTeamId })).status).toBe(404);
    expect(row(b.first.id)).toMatchObject({ status: "next", keeper: null, home: null });
    expect(
      (await a.dana.call("PUT", `/api/tournaments/999999/games/${a.first.id}`, { homeGoals: 1, awayGoals: 0 })).status,
    ).toBe(404);
  });

  it("an admin's goal after the day is at a time inside the period, in a period the tournament has", async () => {
    const c = await cup([], { periods: 2 });
    await c.score(c.first.id, 0, 0);
    const teamId = c.first.homeTeamId;
    expect((await c.goal(c.dana, c.first.id, { teamId, atMs: c.gameMinutes * 60_000 + 1 })).status).toBe(400);
    expect((await c.goal(c.dana, c.first.id, { teamId, atMs: -1 })).status).toBe(400);
    expect((await c.goal(c.dana, c.first.id, { teamId, atMs: 60_000, period: 3 })).status).toBe(400);
    expect((await c.goal(c.dana, c.first.id, { teamId, atMs: 60_000, period: 0 })).status).toBe(400);
    expect(goalsIn(c.first.id)).toBe(0);
    // The last moment of the 2nd is fine
    expect((await c.goal(c.dana, c.first.id, { teamId, atMs: c.gameMinutes * 60_000, period: 2 })).status).toBe(200);
    expect((await c.game(c.first.id)).goals[0]).toMatchObject({ atMs: c.gameMinutes * 60_000, period: 2 });
  });

  it("an admin taking off a goal or penalty that isn't this game's gets Not found, and both games stay as they were", async () => {
    const c = await cup();
    await c.score(c.first.id, 1, 0);
    await c.score(c.games[1].id, 0, 1);
    const otherGoal = (await c.game(c.games[1].id)).goals[0].id;
    expect((await c.dana.call("DELETE", `${c.path(c.first.id)}/goals/${otherGoal}`)).status).toBe(404);
    expect((await c.dana.call("DELETE", `${c.path(c.first.id)}/goals/999999`)).status).toBe(404);
    expect((await c.dana.call("DELETE", `${c.path(c.first.id)}/penalties/999999`)).status).toBe(404);
    expect(row(c.first.id)).toMatchObject({ home: 1, away: 0 });
    expect(row(c.games[1].id)).toMatchObject({ home: 0, away: 1 });
  });
});

describe("an admin's corrections after the day", () => {
  it("putting a result right twice is the same as once: the goals match the score each time", async () => {
    const c = await cup();
    for (const [h, a] of [
      [3, 2],
      [3, 2],
      [0, 0],
      [5, 1],
    ]) {
      expect((await c.score(c.first.id, h, a)).status).toBe(200);
      const g = await c.game(c.first.id);
      expect(g).toMatchObject({ homeGoals: h, awayGoals: a });
      expect(g.goals).toHaveLength(h + a);
    }
  });

  it("lowering a typed-in score takes off the goals nobody said who scored first, keeping the named ones", async () => {
    const c = await cup();
    await c.score(c.first.id, 0, 0);
    const teamId = c.first.homeTeamId;
    const scorerId = c.captainOf(teamId);
    await c.goal(c.dana, c.first.id, { teamId, scorerId, atMs: 60_000 });
    await c.score(c.first.id, 3, 0);
    expect((await c.game(c.first.id)).goals).toHaveLength(3);
    await c.score(c.first.id, 1, 0);
    const g = await c.game(c.first.id);
    expect(g.goals).toEqual([expect.objectContaining({ scorerId, atMs: 60_000 })]);
  });

  it("a game's result typed in while it's being scored live ends it: the scorekeeper's next goal is refused", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }, at(1));
    expect((await c.score(c.first.id, 2, 2)).status).toBe(200);
    expect((await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }, at(2))).status).toBe(403);
    const g = await c.game(c.first.id);
    expect(g).toMatchObject({ status: "done", homeGoals: 2, awayGoals: 2 });
    expect(g.goals).toHaveLength(4);
  });

  it("the fixtures can't be made again once a game is on, even at 0–0", async () => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    const res = await c.dana.call("POST", `/api/tournaments/${c.id}/fixtures`);
    expect(res.status).toBe(409);
    expect(row(c.first.id)).toMatchObject({ status: "live" });
  });
});

describe("playoffs, after the group", () => {
  /**
   * A Final of 1st v 2nd, and the group's results typed in, in the day's order (only the game up next takes one):
   * `scores` says each pair's goals, first team's first. Unless said, the table is Ants, Bees, Cats.
   */
  async function groupPlayed(
    c?: Awaited<ReturnType<typeof cup>>,
    scores?: (ids: number[]) => [number, number, number, number][],
  ) {
    c ??= await cup([{ name: "Final", home: 1, away: 2 }]);
    const [ants, bees, cats] = c.teams.map((t: Json) => t.id as number);
    const group = c.games.filter((g: Json) => g.stage === "group");
    const between = (x: number, y: number) =>
      group.find((g: Json) => [g.homeTeamId, g.awayTeamId].sort().join() === [x, y].sort().join());
    /** A game's score, as `x` scored `xGoals` and `y` `yGoals`: typed in, or put right if it's played. */
    const result = async (x: number, y: number, xGoals: number, yGoals: number) => {
      const g = between(x, y);
      const res = await c.score(g.id, g.homeTeamId === x ? xGoals : yGoals, g.homeTeamId === x ? yGoals : xGoals);
      expect(res.status).toBe(200);
      return g;
    };
    const wanted = (
      scores ??
      (() => [
        [ants, bees, 2, 0],
        [ants, cats, 1, 0],
        [bees, cats, 1, 0],
      ])
    )([ants, bees, cats]);
    for (const g of group) {
      const [x, y, xGoals, yGoals] = wanted.find(([x, y]) => between(x, y).id === g.id)!;
      await result(x, y, xGoals, yGoals);
    }
    const final = (await c.tournament()).games.find((g: Json) => g.stage === "playoff");
    return { ...c, ants, bees, cats, result, final };
  }

  it("the Final waits for the last group game: its teams aren't known, so it can't be scored or typed in", async () => {
    const c = await cup([{ name: "Final", home: 1, away: 2 }]);
    const final = c.games.find((g: Json) => g.stage === "playoff");
    expect(final).toMatchObject({ homeTeamId: null, awayTeamId: null, scoringTeamId: null });
    // Two of three played: still waiting
    const group = c.games.filter((g: Json) => g.stage === "group");
    await c.score(group[0].id, 1, 0);
    await c.score(group[1].id, 1, 0);
    expect((await c.game(final.id)).homeTeamId).toBeNull();
    const typed = await c.score(final.id, 1, 0);
    expect(typed.status).toBe(409);
  });

  it("a group where every game was 0–0 sends the first two in the order the teams entered to the Final", async () => {
    const c = await cup([{ name: "Final", home: 1, away: 2 }]);
    for (const g of c.games.filter((x: Json) => x.stage === "group")) await c.score(g.id, 0, 0);
    const final = (await c.tournament()).games.find((g: Json) => g.stage === "playoff");
    expect([final.homeTeamId, final.awayTeamId]).toEqual([c.teams[0].id, c.teams[1].id]);
  });

  it("an admin putting a group result right before the Final starts changes who's in it", async () => {
    const c = await groupPlayed();
    expect([c.final.homeTeamId, c.final.awayTeamId]).toEqual([c.ants, c.bees]);
    // Cats actually beat Bees, 3–0: Cats are 2nd
    const g = await c.result(c.bees, c.cats, 0, 3);
    expect(row(g.id)).toMatchObject({ status: "done" });
    const final = await c.game(c.final.id);
    expect([final.homeTeamId, final.awayTeamId]).toEqual([c.ants, c.cats]);
  });

  it("taking a goal off a group game that's been played refills the Final from the table", async () => {
    const c = await groupPlayed();
    // Bees beat Cats 1–0; the goal off, it's 0–0: Bees 1 pt, Cats 1 pt; Bees on GD −2, Cats −1: Cats 2nd
    const game = c.games.find(
      (g: Json) => g.stage === "group" && [g.homeTeamId, g.awayTeamId].sort().join() === [c.bees, c.cats].sort().join(),
    );
    const goalId = (await c.game(game.id)).goals[0].id;
    expect((await c.dana.call("DELETE", `${c.path(game.id)}/goals/${goalId}`)).status).toBe(200);
    const final = await c.game(c.final.id);
    expect([final.homeTeamId, final.awayTeamId]).toEqual([c.ants, c.cats]);
  });

  // An admin's correction to a group game refills only the playoffs still to start: one being played keeps its teams,
  // and the goals already logged stay with them (#122)
  it("an admin putting a group result right while the Final's being played doesn't change who's playing it", async () => {
    const c = await groupPlayed();
    const keeper = await c.keeperOf(c.final);
    await c.clock(keeper, c.final.id, "start", at(0));
    await c.goal(keeper, c.final.id, { teamId: c.bees }, at(1));
    // Meanwhile, an admin puts Bees v Cats right: Cats won it, 3–0
    await c.result(c.bees, c.cats, 0, 3);
    const final = await c.game(c.final.id);
    expect([final.homeTeamId, final.awayTeamId]).toEqual([c.ants, c.bees]);
    expect(final).toMatchObject({ status: "live", awayGoals: 1 });
  });

  it("a finished Final keeps its teams when a group result is put right after it", async () => {
    const c = await groupPlayed();
    await c.score(c.final.id, 2, 1);
    await c.result(c.bees, c.cats, 0, 3);
    const final = await c.game(c.final.id);
    expect([final.homeTeamId, final.awayTeamId]).toEqual([c.ants, c.bees]);
    expect(final).toMatchObject({ status: "done", homeGoals: 2, awayGoals: 1 });
  });

  // A typed-in result (scoreGame) or full time (clockGame) can't make a playoff level, and nor can taking a goal off
  // it (#123: it could, and the Final then crowned nobody)
  it("an admin can't take a goal off a finished playoff if that would leave it level: a playoff needs a winner", async () => {
    const c = await groupPlayed();
    await c.score(c.final.id, 1, 0);
    const goalId = (await c.game(c.final.id)).goals[0].id;
    const res = await c.dana.call("DELETE", `${c.path(c.final.id)}/goals/${goalId}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/winner/);
    expect(row(c.final.id)).toMatchObject({ home: 1, away: 0 });
  });

  it.each(seeds(5))(
    "two admins each taking a goal off a 3–1 Final at once: one comes off, the other would leave it level (seed %i)",
    async (seed) => {
      const c = await groupPlayed();
      await c.score(c.final.id, 3, 1);
      const final = await c.game(c.final.id);
      const home = final.goals.filter((g: Json) => g.teamId === final.homeTeamId).map((g: Json) => g.id);
      w.db.interleave(seed);
      const replies = await Promise.all(
        home.slice(0, 2).map((goalId: number) => c.dana.call("DELETE", `${c.path(c.final.id)}/goals/${goalId}`)),
      );
      w.db.interleave(null);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(row(c.final.id)).toMatchObject({ home: 2, away: 1 });
    },
  );

  // Adding a goal missed on the day can leave it level as well (#159): a Final won 1–0, an away goal, 1–1
  it("an admin can't add a goal to a finished playoff if that would leave it level", async () => {
    const c = await groupPlayed();
    await c.score(c.final.id, 1, 0);
    const final = await c.game(c.final.id);
    const res = await c.goal(c.dana, c.final.id, { teamId: final.awayTeamId });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/winner: put the right score in instead/);
    expect(row(c.final.id)).toMatchObject({ status: "done", home: 1, away: 0 });
  });

  it("an admin can add a goal to a finished playoff that still leaves a winner", async () => {
    const c = await groupPlayed();
    await c.score(c.final.id, 2, 0);
    const final = await c.game(c.final.id);
    expect((await c.goal(c.dana, c.final.id, { teamId: final.awayTeamId })).status).toBe(200);
    expect(row(c.final.id)).toMatchObject({ status: "done", home: 2, away: 1 });
  });

  it.each(seeds(5))(
    "two admins each adding an away goal to a 3–1 Final at once: one goes in, the other would leave it level (seed %i)",
    async (seed) => {
      const c = await groupPlayed();
      await c.score(c.final.id, 3, 1);
      const final = await c.game(c.final.id);
      // Two admins: two phones signed in as one does the same
      const other = await w.signedIn("dana@example.com");
      w.db.interleave(seed);
      const replies = await Promise.all(
        [c.dana, other].map((who) => c.goal(who, c.final.id, { teamId: final.awayTeamId })),
      );
      w.db.interleave(null);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(row(c.final.id)).toMatchObject({ home: 3, away: 2 });
    },
  );

  it("an admin can take a goal off a finished playoff that still leaves a winner", async () => {
    const c = await groupPlayed();
    await c.score(c.final.id, 3, 1);
    const goalId = (await c.game(c.final.id)).goals[0].id;
    expect((await c.dana.call("DELETE", `${c.path(c.final.id)}/goals/${goalId}`)).status).toBe(200);
    expect(row(c.final.id)).toMatchObject({ status: "done" });
    expect(row(c.final.id).home + row(c.final.id).away).toBe(3);
  });
});

describe("taps at once, outside the live game (ADR 0121)", () => {
  it.each(seeds(5))(
    "two members pressing Start scoring at once: one holds the sheet, the other's told (seed %i)",
    async (seed) => {
      const c = await cup();
      const a = await w.signedIn("mo@example.com");
      const b = await c.as(c.first.scoringTeamId);
      w.db.interleave(seed);
      const replies = await Promise.all([c.sheet(a, c.first.id, "claim"), c.sheet(b, c.first.id, "claim")]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      const holder = replies[0].status === 200 ? c.idOf("Mo Member") : c.captainOf(c.first.scoringTeamId);
      expect(row(c.first.id).keeper).toBe(holder);
    },
  );

  // A typed-in result, its goals made to match and the count they're matched against are one batch: two saves of the
  // same result at once (a double tap on Save, or two admins) leave the game with as many goals as its score (#124).
  // Seeds 2, 3 and 5 found it
  it.each(seeds(5))(
    "an admin's typed-in result saved twice at once: the game has as many goals as its score (seed %i)",
    async (seed) => {
      const c = await cup();
      w.db.interleave(seed);
      const replies = await Promise.all([c.score(c.first.id, 2, 1), c.score(c.first.id, 2, 1)]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status)).toEqual([200, 200]);
      expect(row(c.first.id)).toMatchObject({ home: 2, away: 1 });
      expect(goalsIn(c.first.id)).toBe(3);
    },
  );

  // Undo says which goal it takes back, the last one the page shows (#114): a double tap on Undo takes that one off
  // once, and the second finds it gone. Seeds 1 to 5 took two off when it said only "the last goal"
  it.each([1, 2, 3, 4, 5])("Undo tapped twice at once takes back one goal, not two (seed %i)", async (seed) => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }, at(1));
    await c.goal(keeper, c.first.id, { teamId: c.first.homeTeamId }, at(2));
    const last = (await c.game(c.first.id)).goals.at(-1).id;
    const undo = () =>
      keeper.call("DELETE", `${c.path(c.first.id)}/goals/last?goal=${last}`, undefined, { now: at(3) });
    w.db.interleave(seed);
    const replies = await Promise.all([undo(), undo()]);
    w.db.interleave(null);
    expect(replies.map((r) => r.status)).toEqual([200, 200]);
    expect(goalsIn(c.first.id)).toBe(1);
    expect(row(c.first.id)).toMatchObject({ home: 1 });
  });

  it.each([1, 2, 3, 4, 5])("Undo of a penalty tapped twice at once takes back one penalty (seed %i)", async (seed) => {
    const c = await cup();
    const keeper = await c.keeperOf(c.first);
    await c.clock(keeper, c.first.id, "start", at(0));
    const called = { teamId: c.first.homeTeamId, infraction: "delay-of-game" };
    await c.penalty(keeper, c.first.id, called, at(1));
    await c.penalty(keeper, c.first.id, called, at(2));
    const last = (await c.game(c.first.id)).penalties.reduce((a: Json, b: Json) => (b.id > a.id ? b : a)).id;
    const undo = () =>
      keeper.call("DELETE", `${c.path(c.first.id)}/penalties/last?penalty=${last}`, undefined, { now: at(3) });
    w.db.interleave(seed);
    const replies = await Promise.all([undo(), undo()]);
    w.db.interleave(null);
    expect(replies.map((r) => r.status)).toEqual([200, 200]);
    expect(penaltiesIn(c.first.id)).toBe(1);
  });
});
