// Scoring a game as it's played (ADR 0061): each game suggests a team sitting it out to keep score, but one person
// keeps it: whoever presses Start scoring holds the scoresheet, and nobody else can score until they (or an admin)
// let it go. They start the clock, log each goal as it goes in (who scored, who assisted), pause, and call full time,
// which makes the score the result. Everyone sees the score as it happens. Driven through the real Worker handlers
// (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";

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
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A cup three teams entered, each captained by a member, with its fixtures made (and its playoffs, if any). */
async function cup(playoffs: { name: string; home: number; away: number }[] = [], extra: object = {}) {
  const dana = await w.signedIn("dana@example.com");
  const sees = async (as = dana, now = NOW) =>
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
  const tournament = async (as = dana, now = NOW) => (await sees(as, now)).tournaments.find((t: Json) => t.id === id);
  const t = await tournament();
  // Who's who, by team id: its captain's email
  const emailOf = new Map<number, string>(
    t.teams.map((team: Json) => [team.id, ROSTER.find((r) => idOf(r.name) === team.captainMemberId)!.email]),
  );
  const first = t.games[0];
  const as = async (teamId: number) => w.signedIn(emailOf.get(teamId)!);
  const clock = (who: { call: Json }, gameId: number, action: string, now = NOW) =>
    who.call("POST", `/api/tournaments/${id}/games/${gameId}/clock`, { action }, { now });
  const goal = (who: { call: Json }, gameId: number, body: object, now = NOW) =>
    who.call("POST", `/api/tournaments/${id}/games/${gameId}/goals`, body, { now });
  const penalty = (who: { call: Json }, gameId: number, body: object, now = NOW) =>
    who.call("POST", `/api/tournaments/${id}/games/${gameId}/penalties`, body, { now });
  /** Start scoring (take the scoresheet) or let it go. */
  const sheet = (who: { call: Json }, gameId: number, action: "claim" | "release", now = NOW) =>
    who.call("POST", `/api/tournaments/${id}/games/${gameId}/scorer`, { action }, { now });
  /** The suggested team's captain, holding the scoresheet. */
  const keeperOf = async (game: Json) => {
    const k = await as(game.scoringTeamId);
    expect((await sheet(k, game.id, "claim")).status).toBe(200);
    return k;
  };
  const captainOf = (teamId: number) => t.teams.find((x: Json) => x.id === teamId).captainMemberId as number;
  return {
    dana,
    id,
    tournament,
    first,
    games: t.games as Json[],
    as,
    clock,
    goal,
    penalty,
    sheet,
    keeperOf,
    captainOf,
    idOf,
    gameMinutes: t.gameMinutes as number,
  };
}

describe("scoring a game as it's played", () => {
  it("each game suggests a team sitting it out to keep score", async () => {
    const { games } = await cup();
    for (const g of games) {
      expect(g.scoringTeamId).toBeTruthy();
      expect([g.homeTeamId, g.awayTeamId]).not.toContain(g.scoringTeamId);
    }
  });

  it("the team keeping score starts the clock, logs each goal with who scored and assisted, and calls full time: that's the result", async () => {
    const { first, keeperOf, clock, goal, captainOf, tournament, gameMinutes } = await cup();
    const keeper = await keeperOf(first);
    expect((await clock(keeper, first.id, "start", at(0))).status).toBe(200);
    expect(
      (await goal(keeper, first.id, { teamId: first.homeTeamId, scorerId: captainOf(first.homeTeamId) }, at(3))).status,
    ).toBe(200);
    expect((await clock(keeper, first.id, "pause", at(5))).status).toBe(200);

    let g = (await tournament(undefined, at(5))).games.find((x: Json) => x.id === first.id);
    expect(g).toMatchObject({ status: "live", homeGoals: 1, awayGoals: 0, clockStartedAt: null });
    expect(g.clockLeftMs).toBe(gameMinutes * 60_000 - 5 * 60_000);
    expect(g.goals).toEqual([
      expect.objectContaining({
        teamId: first.homeTeamId,
        scorerId: captainOf(first.homeTeamId),
        assistId: null,
        atMs: 180_000,
      }),
    ]);

    expect((await clock(keeper, first.id, "start", at(8))).status).toBe(200);
    expect(
      (await goal(keeper, first.id, { teamId: first.awayTeamId, scorerId: captainOf(first.awayTeamId) }, at(9))).status,
    ).toBe(200);
    expect((await clock(keeper, first.id, "end", at(15))).status).toBe(200);
    g = (await tournament(undefined, at(15))).games.find((x: Json) => x.id === first.id);
    expect(g).toMatchObject({ status: "done", homeGoals: 1, awayGoals: 1 });
    // Over: the scorekeeper's done with it (an admin puts a result right)
    expect((await goal(keeper, first.id, { teamId: first.homeTeamId }, at(16))).status).toBe(403);
  });

  it("everyone sees the score as it happens", async () => {
    const { first, keeperOf, clock, goal, tournament } = await cup();
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    await goal(keeper, first.id, { teamId: first.awayTeamId }, at(2));
    const mo = await w.signedIn("mo@example.com");
    const g = (await tournament(mo, at(2))).games.find((x: Json) => x.id === first.id);
    expect(g).toMatchObject({ status: "live", homeGoals: 0, awayGoals: 1 });
    expect(g.clockStartedAt).toBe(at(0).toISOString());
  });

  it("one person keeps score: whoever presses Start scoring holds the scoresheet, and nobody else can score", async () => {
    const { first, clock, sheet, tournament, idOf } = await cup();
    const mo = await w.signedIn("mo@example.com");
    // Not the suggested team, but stepping in: anyone can take it while nobody has
    expect((await clock(mo, first.id, "start")).status).toBe(403);
    expect((await sheet(mo, first.id, "claim")).status).toBe(200);
    expect((await tournament()).games[0].keeperId).toBe(idOf("Mo Member"));
    expect((await clock(mo, first.id, "start")).status).toBe(200);
    // Somebody else, even from the suggested team, even an admin, can't score it or take it
    const cara = await w.signedIn("cara@example.com");
    expect((await sheet(cara, first.id, "claim")).status).toBe(409);
    expect((await clock(cara, first.id, "pause")).status).toBe(403);
  });

  it("scoring's taken on for the game up next, not one further down the day", async () => {
    const { games, sheet, clock } = await cup();
    const mo = await w.signedIn("mo@example.com");
    expect((await sheet(mo, games[1].id, "claim")).status).toBe(409);
    expect((await sheet(mo, games[0].id, "claim")).status).toBe(200);
    await clock(mo, games[0].id, "start", at(0));
    await clock(mo, games[0].id, "end", at(12));
    // Game 1's done: game 2's up next
    expect((await sheet(mo, games[1].id, "claim")).status).toBe(200);
  });

  it("the scorekeeper sets the time on the clock: paused, or running on from there", async () => {
    const { id, first, keeperOf, clock, tournament } = await cup();
    const keeper = await keeperOf(first);
    const setClock = (who: { call: Json }, leftMs: number, now = NOW) =>
      who.call("POST", `/api/tournaments/${id}/games/${first.id}/clock`, { action: "set", leftMs }, { now });
    const game = async (now: Date) => (await tournament(undefined, now)).games.find((x: Json) => x.id === first.id);
    // Not before kick-off: start the game first
    expect((await setClock(keeper, 300_000)).status).toBe(409);
    await clock(keeper, first.id, "start", at(0));
    await clock(keeper, first.id, "pause", at(1));
    expect((await setClock(keeper, 300_000, at(2))).status).toBe(200);
    expect(await game(at(2))).toMatchObject({ clockLeftMs: 300_000, clockStartedAt: null });
    // Running: it carries on from the time set
    await clock(keeper, first.id, "start", at(3));
    expect((await setClock(keeper, 120_000, at(4))).status).toBe(200);
    expect(await game(at(4))).toMatchObject({ clockLeftMs: 120_000, clockStartedAt: at(4).toISOString() });
    // Only the scorekeeper, and never more than an hour
    const mo = await w.signedIn("mo@example.com");
    expect((await setClock(mo, 60_000, at(5))).status).toBe(403);
    expect((await setClock(keeper, 61 * 60_000, at(5))).status).toBe(400);
  });

  it("a result typed in goes on the game up next or one that's played, not one further down the day", async () => {
    const { id, games, dana } = await cup();
    const result = (gameId: number) =>
      dana.call("PUT", `/api/tournaments/${id}/games/${gameId}`, { homeGoals: 2, awayGoals: 1 });
    expect((await result(games[1].id)).status).toBe(409);
    expect((await result(games[0].id)).status).toBe(200);
    // Game 1's done: game 2's next, and game 1 can still be corrected
    expect((await result(games[1].id)).status).toBe(200);
    expect((await result(games[0].id)).status).toBe(200);
  });

  it("only whoever holds the scoresheet, or an admin, lets it go; then someone else can take it on", async () => {
    const { first, clock, sheet, dana, tournament } = await cup();
    const mo = await w.signedIn("mo@example.com");
    const reg = await w.signedIn("reg@example.com");
    await sheet(mo, first.id, "claim");
    await clock(mo, first.id, "start", at(0));
    expect((await sheet(reg, first.id, "release")).status).toBe(403);
    expect((await clock(dana, first.id, "pause", at(1))).status).toBe(403);
    // Mo's had to leave: an admin lets it go, and Reg carries on where Mo left off
    expect((await sheet(dana, first.id, "release")).status).toBe(200);
    expect((await tournament()).games[0].keeperId).toBeNull();
    expect((await sheet(reg, first.id, "claim")).status).toBe(200);
    expect((await clock(reg, first.id, "pause", at(2))).status).toBe(200);
    expect((await sheet(reg, first.id, "release")).status).toBe(200);
  });

  it("a goal logged by mistake comes off: the last one", async () => {
    const { id, first, keeperOf, clock, goal, tournament } = await cup();
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    await goal(keeper, first.id, { teamId: first.homeTeamId }, at(1));
    await goal(keeper, first.id, { teamId: first.homeTeamId }, at(2));
    expect(
      (await keeper.call("DELETE", `/api/tournaments/${id}/games/${first.id}/goals/last`, undefined, { now: at(2) }))
        .status,
    ).toBe(200);
    const g = (await tournament(undefined, at(2))).games.find((x: Json) => x.id === first.id);
    expect(g.homeGoals).toBe(1);
    expect(g.goals).toHaveLength(1);
  });

  it("a goal is scored by someone on that team, and assisted by a teammate", async () => {
    const { first, keeperOf, clock, goal, captainOf } = await cup();
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    expect(
      (await goal(keeper, first.id, { teamId: first.homeTeamId, scorerId: captainOf(first.awayTeamId) }, at(1))).status,
    ).toBe(400);
    expect((await goal(keeper, first.id, { teamId: first.scoringTeamId }, at(1))).status).toBe(400);
  });

  it("one game at a time: the next doesn't start while one's on", async () => {
    const { games, clock, dana, sheet } = await cup();
    await sheet(dana, games[0].id, "claim");
    expect((await clock(dana, games[0].id, "start", at(0))).status).toBe(200);
    // The next one can't even be taken on while this one's on
    expect((await sheet(dana, games[1].id, "claim")).status).toBe(409);
    expect((await clock(dana, games[0].id, "end", at(12))).status).toBe(200);
    await sheet(dana, games[1].id, "claim");
    expect((await clock(dana, games[1].id, "start", at(17))).status).toBe(200);
  });
});

describe("an admin puts a game's result right, on the game's page", () => {
  it("adds a goal (who scored, who assisted, when) or takes any one off, and the score follows", async () => {
    const { id, first, keeperOf, clock, goal, captainOf, tournament, dana } = await cup();
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    await goal(keeper, first.id, { teamId: first.homeTeamId }, at(2));
    await goal(keeper, first.id, { teamId: first.homeTeamId }, at(4));
    await clock(keeper, first.id, "end", at(12));
    const game = async () => (await tournament()).games.find((x: Json) => x.id === first.id);
    // A goal missed on the day, five minutes in: it goes in its place in the game
    expect(
      (
        await goal(dana, first.id, {
          teamId: first.awayTeamId,
          scorerId: captainOf(first.awayTeamId),
          atMs: 5 * 60_000,
        })
      ).status,
    ).toBe(200);
    let g = await game();
    expect(g).toMatchObject({ status: "done", homeGoals: 2, awayGoals: 1 });
    expect(g.goals.map((x: Json) => x.atMs)).toEqual([2 * 60_000, 4 * 60_000, 5 * 60_000]);
    // One that wasn't a goal: any one comes off, not just the last
    const wrong = g.goals[0].id;
    expect((await dana.call("DELETE", `/api/tournaments/${id}/games/${first.id}/goals/${wrong}`)).status).toBe(200);
    g = await game();
    expect(g).toMatchObject({ homeGoals: 1, awayGoals: 1 });
    expect(g.goals.map((x: Json) => x.id)).not.toContain(wrong);
  });

  it("the game up next: the result goes in as played, 0–0, then the goals go on it", async () => {
    const { id, first, goal, tournament, dana } = await cup();
    expect(
      (await dana.call("PUT", `/api/tournaments/${id}/games/${first.id}`, { homeGoals: 0, awayGoals: 0 })).status,
    ).toBe(200);
    expect((await goal(dana, first.id, { teamId: first.homeTeamId })).status).toBe(200);
    const g = (await tournament()).games.find((x: Json) => x.id === first.id);
    expect(g).toMatchObject({ status: "done", homeGoals: 1, awayGoals: 0 });
    // Nobody said when: no time on it
    expect(g.goals[0].atMs).toBeNull();
  });

  it("a score typed in is that many goals, nobody said who, so the score and the goals always agree", async () => {
    const { id, first, tournament, dana } = await cup();
    await dana.call("PUT", `/api/tournaments/${id}/games/${first.id}`, { homeGoals: 3, awayGoals: 1 });
    let g = (await tournament()).games.find((x: Json) => x.id === first.id);
    expect(g.goals.filter((x: Json) => x.teamId === first.homeTeamId)).toHaveLength(3);
    expect(g.goals.filter((x: Json) => x.teamId === first.awayTeamId)).toHaveLength(1);
    // Typed in lower: goals come off to match
    await dana.call("PUT", `/api/tournaments/${id}/games/${first.id}`, { homeGoals: 1, awayGoals: 1 });
    g = (await tournament()).games.find((x: Json) => x.id === first.id);
    expect(g.goals).toHaveLength(2);
  });

  it("only an admin, and only once it's played: not the scorekeeper, not a game still on", async () => {
    const { id, first, keeperOf, clock, goal } = await cup();
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    await goal(keeper, first.id, { teamId: first.homeTeamId }, at(1));
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("DELETE", `/api/tournaments/${id}/games/${first.id}/goals/1`)).status).toBe(403);
    await clock(keeper, first.id, "end", at(12));
    // Full time: the scorekeeper's done with it
    expect((await goal(keeper, first.id, { teamId: first.homeTeamId }, at(13))).status).toBe(403);
  });
});

describe("a playoff needs a winner", () => {
  /** The group games played (typed in), so the final has its teams from the table. */
  async function final() {
    const c = await cup([{ name: "Final", home: 1, away: 2 }]);
    for (const g of c.games.filter((x: Json) => x.stage === "group"))
      await c.dana.call("PUT", `/api/tournaments/${c.id}/games/${g.id}`, { homeGoals: 1, awayGoals: 0 });
    const game = (await c.tournament()).games.find((x: Json) => x.stage === "playoff");
    expect(game.homeTeamId).not.toBeNull();
    return { ...c, game };
  }

  it("level at full time, it plays on: full time is refused until the next goal wins it", async () => {
    const { game, keeperOf, clock, goal, tournament } = await final();
    const keeper = await keeperOf(game);
    expect((await clock(keeper, game.id, "start")).status).toBe(200);
    const level = await clock(keeper, game.id, "end", at(20));
    expect(level.status).toBe(409);
    expect(level.body.error).toMatch(/next goal wins/);
    expect((await goal(keeper, game.id, { teamId: game.awayTeamId }, at(22))).status).toBe(200);
    expect((await clock(keeper, game.id, "end", at(22))).status).toBe(200);
    const t = await tournament();
    expect(t.games.find((x: Json) => x.id === game.id)).toMatchObject({ status: "done", homeGoals: 0, awayGoals: 1 });
  });

  it("an admin typing in a playoff's result can't make it a draw", async () => {
    const { game, id, dana } = await final();
    const res = await dana.call("PUT", `/api/tournaments/${id}/games/${game.id}`, { homeGoals: 2, awayGoals: 2 });
    expect(res.status).toBe(400);
    expect(
      (await dana.call("PUT", `/api/tournaments/${id}/games/${game.id}`, { homeGoals: 3, awayGoals: 2 })).status,
    ).toBe(200);
  });
});

describe("penalties, kept the way goals are", () => {
  it("the scorekeeper records a penalty (who, the minutes, what for), timed by the game clock, and everyone sees it", async () => {
    const { first, keeperOf, clock, penalty, captainOf, tournament } = await cup();
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    const dan = captainOf(first.homeTeamId);
    expect(
      (await penalty(keeper, first.id, { teamId: first.homeTeamId, memberId: dan, infraction: "tripping" }, at(4)))
        .status,
    ).toBe(200);
    // A bench penalty: nobody in particular, five minutes
    expect(
      (await penalty(keeper, first.id, { teamId: first.awayTeamId, minutes: 5, infraction: "delay-of-game" }, at(6)))
        .status,
    ).toBe(200);
    const mo = await w.signedIn("mo@example.com");
    const g = (await tournament(mo, at(6))).games.find((x: Json) => x.id === first.id);
    const keeperId = captainOf(first.scoringTeamId);
    expect(g.penalties).toEqual([
      expect.objectContaining({
        teamId: first.homeTeamId,
        memberId: dan,
        minutes: 2,
        infraction: "tripping",
        atMs: 240_000,
        recordedBy: keeperId,
      }),
      expect.objectContaining({
        teamId: first.awayTeamId,
        memberId: null,
        minutes: 5,
        infraction: "delay-of-game",
        atMs: 360_000,
      }),
    ]);
    // The score's untouched
    expect(g).toMatchObject({ homeGoals: 0, awayGoals: 0 });
  });

  it("a double minor is one penalty of four minutes", async () => {
    const { first, keeperOf, clock, penalty, captainOf, tournament } = await cup();
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    const dan = captainOf(first.awayTeamId);
    expect(
      (
        await penalty(
          keeper,
          first.id,
          { teamId: first.awayTeamId, memberId: dan, minutes: 4, infraction: "high-stick" },
          at(3),
        )
      ).status,
    ).toBe(200);
    const g = (await tournament(undefined, at(3))).games.find((x: Json) => x.id === first.id);
    expect(g.penalties).toEqual([expect.objectContaining({ memberId: dan, minutes: 4, atMs: 180_000 })]);
  });

  it("only the scorekeeper records one, for a player on that team, 2, 4 or 5 minutes; after full time only an admin", async () => {
    const { first, keeperOf, clock, penalty, captainOf, dana, tournament, as } = await cup();
    const keeper = await keeperOf(first);
    // Not before kick-off
    expect((await penalty(keeper, first.id, { teamId: first.homeTeamId })).status).toBe(409);
    await clock(keeper, first.id, "start", at(0));
    const mo = await w.signedIn("mo@example.com");
    // Not even a captain playing in it
    const playing = await as(first.homeTeamId);
    expect((await penalty(mo, first.id, { teamId: first.homeTeamId }, at(1))).status).toBe(403);
    expect((await penalty(playing, first.id, { teamId: first.homeTeamId }, at(1))).status).toBe(403);
    expect((await penalty(dana, first.id, { teamId: first.homeTeamId }, at(1))).status).toBe(403);
    expect(
      (
        await penalty(
          keeper,
          first.id,
          { teamId: first.homeTeamId, memberId: captainOf(first.awayTeamId), infraction: "tripping" },
          at(1),
        )
      ).status,
    ).toBe(400);
    expect(
      (await penalty(keeper, first.id, { teamId: first.homeTeamId, minutes: 3, infraction: "delay-of-game" }, at(1)))
        .status,
    ).toBe(400);
    expect((await penalty(keeper, first.id, { teamId: first.homeTeamId, infraction: "biting" }, at(1))).status).toBe(
      400,
    );
    expect((await penalty(keeper, first.id, { teamId: first.scoringTeamId }, at(1))).status).toBe(400);
    await clock(keeper, first.id, "end", at(12));
    expect((await penalty(keeper, first.id, { teamId: first.homeTeamId }, at(13))).status).toBe(403);
    // An admin puts one missed on the day in its place, or with no time
    expect(
      (
        await penalty(dana, first.id, {
          teamId: first.awayTeamId,
          memberId: captainOf(first.awayTeamId),
          infraction: "holding",
          atMs: 90_000,
        })
      ).status,
    ).toBe(200);
    const g = (await tournament()).games.find((x: Json) => x.id === first.id);
    expect(g.penalties).toEqual([expect.objectContaining({ atMs: 90_000, minutes: 2, infraction: "holding" })]);
  });

  it("it's always for something: one on a player needs who, a bench one can be on nobody", async () => {
    const { first, keeperOf, clock, penalty, captainOf, tournament } = await cup();
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    const home = first.homeTeamId;
    // Nothing said: refused
    let res = await penalty(keeper, first.id, { teamId: home, memberId: captainOf(home) }, at(1));
    expect(res.status).toBe(400);
    // A player's infraction (Other too) on nobody: refused
    for (const infraction of ["tripping", "other"]) {
      res = await penalty(keeper, first.id, { teamId: home, infraction }, at(1));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Who's it on?");
    }
    // A bench one on nobody: a bench penalty
    for (const infraction of ["too-many-players", "delay-of-game", "bench-minor"])
      expect((await penalty(keeper, first.id, { teamId: home, infraction }, at(2))).status).toBe(200);
    // Delay of game can still be on a player
    expect(
      (await penalty(keeper, first.id, { teamId: home, memberId: captainOf(home), infraction: "delay-of-game" }, at(3)))
        .status,
    ).toBe(200);
    const g = (await tournament(undefined, at(3))).games.find((x: Json) => x.id === first.id);
    expect(g.penalties.map((p: Json) => [p.infraction, p.memberId])).toEqual([
      ["too-many-players", null],
      ["delay-of-game", null],
      ["bench-minor", null],
      ["delay-of-game", captainOf(home)],
    ]);
  });

  it("too many players, and a bench minor, are always two minutes", async () => {
    const { first, keeperOf, clock, penalty } = await cup();
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    for (const infraction of ["too-many-players", "bench-minor"])
      for (const minutes of [4, 5])
        expect((await penalty(keeper, first.id, { teamId: first.homeTeamId, infraction, minutes }, at(1))).status).toBe(
          400,
        );
    expect(
      (await penalty(keeper, first.id, { teamId: first.homeTeamId, infraction: "too-many-players", minutes: 2 }, at(1)))
        .status,
    ).toBe(200);
  });

  it("a penalty logged by mistake comes off: the scorekeeper takes back the last; an admin any one, after", async () => {
    const { id, first, keeperOf, clock, penalty, tournament, dana } = await cup();
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    await penalty(keeper, first.id, { teamId: first.homeTeamId, infraction: "delay-of-game" }, at(1));
    await penalty(keeper, first.id, { teamId: first.awayTeamId, infraction: "delay-of-game" }, at(2));
    const path = `/api/tournaments/${id}/games/${first.id}/penalties`;
    expect((await dana.call("DELETE", `${path}/last`, undefined, { now: at(2) })).status).toBe(403);
    expect((await keeper.call("DELETE", `${path}/last`, undefined, { now: at(2) })).status).toBe(200);
    let g = (await tournament(undefined, at(2))).games.find((x: Json) => x.id === first.id);
    expect(g.penalties.map((p: Json) => p.teamId)).toEqual([first.homeTeamId]);
    // Not while it's on: an admin's for a finished game
    expect((await dana.call("DELETE", `${path}/${g.penalties[0].id}`)).status).toBe(409);
    await clock(keeper, first.id, "end", at(12));
    expect((await dana.call("DELETE", `${path}/${g.penalties[0].id}`)).status).toBe(200);
    g = (await tournament()).games.find((x: Json) => x.id === first.id);
    expect(g.penalties).toEqual([]);
  });

  it("they're on the record with the result, as goals are: at full time, and with each fix after", async () => {
    const { first, keeperOf, clock, penalty, dana } = await cup();
    const scored = () =>
      (w.db.raw.prepare("SELECT detail FROM audit_log WHERE action = 'game.scored' ORDER BY id").all() as Json[]).map(
        (r) => JSON.parse(r.detail),
      );
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    await penalty(keeper, first.id, { teamId: first.homeTeamId, minutes: 5, infraction: "delay-of-game" }, at(1));
    // Not tap by tap
    expect(scored()).toHaveLength(0);
    await clock(keeper, first.id, "end", at(12));
    expect(JSON.stringify(scored().at(-1))).toContain('"penaltyMinutes":5');
    await penalty(dana, first.id, { teamId: first.awayTeamId, infraction: "bench-minor" });
    expect(scored()).toHaveLength(2);
    expect(JSON.stringify(scored().at(-1))).toContain('"penaltyMinutes":7');
  });

  it("penalty minutes add up per player and per team, across the day's games", async () => {
    const { games, clock, penalty, sheet, captainOf, tournament, dana } = await cup();
    const pims = (await import("../../src/lib/penalties")).penaltyMinutes;
    // Game 1 then game 2, each with a penalty for whoever's in both
    const [g1, g2] = games;
    const both = [g1.homeTeamId, g1.awayTeamId].find((t: number) => [g2.homeTeamId, g2.awayTeamId].includes(t));
    const dan = captainOf(both);
    await sheet(dana, g1.id, "claim");
    await clock(dana, g1.id, "start", at(0));
    await penalty(dana, g1.id, { teamId: both, memberId: dan, infraction: "hooking" }, at(2));
    await penalty(dana, g1.id, { teamId: both, memberId: dan, minutes: 5, infraction: "roughing" }, at(5));
    await clock(dana, g1.id, "end", at(12));
    await sheet(dana, g2.id, "claim");
    await clock(dana, g2.id, "start", at(15));
    await penalty(dana, g2.id, { teamId: both, memberId: dan, infraction: "slashing" }, at(16));
    await penalty(dana, g2.id, { teamId: both, infraction: "too-many-players" }, at(17));
    const t = await tournament(undefined, at(17));
    const { byMember, byTeam } = pims(t.games);
    expect(byMember.get(dan)).toBe(9);
    expect(byTeam.get(both)).toBe(11);
  });
});

describe("how a penalty's served is the series' setting, copied onto each tournament", () => {
  const SERIES = {
    name: "Shootout Cup",
    shortName: "Shootout",
    icon: "trophy",
    tone: "green",
    kind: "teams",
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    gameMinutes: 12,
    active: true,
    defaultFeePence: 0,
    awards: [],
    location: "",
  };

  it("an admin sets Penalties on a series; a new series is Power play; its tournaments copy it and can differ", async () => {
    const dana = await w.signedIn("dana@example.com");
    const sees = async () => (await dana.call("GET", "/api/bootstrap")).body as Json;
    // Left out: the standard
    let res = await dana.call("POST", "/api/tournament-types", SERIES);
    expect(res.status).toBe(201);
    const plain = res.body.id;
    expect((await sees()).tournamentTypes.find((t: Json) => t.id === plain).penaltyRule).toBe("power_play");
    res = await dana.call("POST", "/api/tournament-types", { ...SERIES, name: "Sit-out Cup", penaltyRule: "sit_out" });
    const sitOut = res.body.id;
    expect((await sees()).tournamentTypes.find((t: Json) => t.id === sitOut).penaltyRule).toBe("sit_out");
    expect(
      (await dana.call("POST", "/api/tournament-types", { ...SERIES, name: "Odd", penaltyRule: "sin_bin" })).status,
    ).toBe(400);
    // Changed on the series
    expect(
      (await dana.call("PUT", `/api/tournament-types/${plain}`, { ...SERIES, penaltyRule: "sit_out" })).status,
    ).toBe(200);
    expect((await sees()).tournamentTypes.find((t: Json) => t.id === plain).penaltyRule).toBe("sit_out");
    // A tournament copies its series', and one can differ
    const day = { name: "Sit-out Cup 2026", location: "", heldOn: "2026-12-12", startTime: "10:00", endTime: "15:00" };
    res = await dana.call("POST", "/api/tournaments", { ...day, typeId: sitOut, status: "planned", feePence: 0 });
    const t = res.body.id;
    expect((await sees()).tournaments.find((x: Json) => x.id === t).penaltyRule).toBe("sit_out");
    const own = (await sees()).tournaments.find((x: Json) => x.id === t);
    expect(
      (await dana.call("PUT", `/api/tournaments/${t}`, { ...own, teams: [], penaltyRule: "power_play" })).status,
    ).toBe(200);
    expect((await sees()).tournaments.find((x: Json) => x.id === t).penaltyRule).toBe("power_play");
  });

  it("the Kumite's penalties are a penalty shot, the player sitting out", async () => {
    const dana = await w.signedIn("dana@example.com");
    const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
    expect(boot.tournamentTypes.find((t: Json) => t.slug === "kumite").penaltyRule).toBe("sit_out");
  });
});

describe("the usual penalty length is the series' setting, copied onto each tournament", () => {
  const SERIES = {
    name: "Rough Cup",
    shortName: "Rough",
    icon: "trophy",
    tone: "green",
    kind: "teams",
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    gameMinutes: 12,
    active: true,
    defaultFeePence: 0,
    awards: [],
    location: "",
  };

  it("an admin sets it on a series (Minor 2, Double minor 2+2, Major 5); a new series is a Minor; its tournaments copy it", async () => {
    const dana = await w.signedIn("dana@example.com");
    const sees = async () => (await dana.call("GET", "/api/bootstrap")).body as Json;
    let res = await dana.call("POST", "/api/tournament-types", SERIES);
    expect((await sees()).tournamentTypes.find((t: Json) => t.id === res.body.id).defaultPenaltyMinutes).toBe(2);
    res = await dana.call("POST", "/api/tournament-types", { ...SERIES, name: "Major Cup", defaultPenaltyMinutes: 5 });
    const major = res.body.id;
    expect((await sees()).tournamentTypes.find((t: Json) => t.id === major).defaultPenaltyMinutes).toBe(5);
    expect(
      (await dana.call("POST", "/api/tournament-types", { ...SERIES, name: "Odd", defaultPenaltyMinutes: 3 })).status,
    ).toBe(400);
    res = await dana.call("POST", "/api/tournaments", {
      typeId: major,
      name: "Major Cup 2026",
      location: "",
      heldOn: "2026-12-12",
      startTime: "10:00",
      endTime: "15:00",
      status: "planned",
      feePence: 0,
    });
    const t = res.body.id;
    expect((await sees()).tournaments.find((x: Json) => x.id === t).defaultPenaltyMinutes).toBe(5);
    const own = (await sees()).tournaments.find((x: Json) => x.id === t);
    expect(
      (await dana.call("PUT", `/api/tournaments/${t}`, { ...own, teams: [], defaultPenaltyMinutes: 4 })).status,
    ).toBe(200);
    expect((await sees()).tournaments.find((x: Json) => x.id === t).defaultPenaltyMinutes).toBe(4);
    expect((await sees()).tournamentTypes.find((x: Json) => x.slug === "kumite").defaultPenaltyMinutes).toBe(2);
  });

  it("a penalty called without its length is the tournament's usual one; too many players is still 2", async () => {
    const { first, keeperOf, clock, penalty, captainOf, tournament } = await cup([], { defaultPenaltyMinutes: 5 });
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    const dan = captainOf(first.homeTeamId);
    await penalty(keeper, first.id, { teamId: first.homeTeamId, memberId: dan, infraction: "roughing" }, at(1));
    await penalty(keeper, first.id, { teamId: first.awayTeamId, infraction: "too-many-players" }, at(2));
    const g = (await tournament(undefined, at(2))).games.find((x: Json) => x.id === first.id);
    expect(g.penalties.map((p: Json) => p.minutes)).toEqual([5, 2]);
  });
});

describe("periods: the clock runs per period, and goals and penalties say which", () => {
  it("a series sets its periods (1 to 3), and its tournaments copy them", async () => {
    const dana = await w.signedIn("dana@example.com");
    const sees = async () => (await dana.call("GET", "/api/bootstrap")).body as Json;
    const series = {
      name: "Three Cup",
      shortName: "Three",
      icon: "trophy",
      tone: "green",
      kind: "teams",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      gameMinutes: 12,
      active: true,
      defaultFeePence: 0,
      awards: [],
      location: "",
    };
    let res = await dana.call("POST", "/api/tournament-types", series);
    expect((await sees()).tournamentTypes.find((t: Json) => t.id === res.body.id).periods).toBe(1);
    res = await dana.call("POST", "/api/tournament-types", { ...series, name: "Three 2", periods: 3 });
    const three = res.body.id;
    expect((await sees()).tournamentTypes.find((t: Json) => t.id === three).periods).toBe(3);
    expect((await dana.call("POST", "/api/tournament-types", { ...series, name: "Four", periods: 4 })).status).toBe(
      400,
    );
    res = await dana.call("POST", "/api/tournaments", {
      typeId: three,
      name: "Three 2026",
      location: "",
      heldOn: "2026-12-12",
      startTime: "10:00",
      endTime: "15:00",
      status: "planned",
      feePence: 0,
    });
    expect((await sees()).tournaments.find((t: Json) => t.id === res.body.id).periods).toBe(3);
    // The Kumite's one period
    expect((await sees()).tournamentTypes.find((t: Json) => t.slug === "kumite").periods).toBe(1);
  });

  it("at the end of the 1st, the 2nd starts paused at full length; goals carry their period; full time after the 3rd", async () => {
    const { first, keeperOf, clock, goal, tournament, gameMinutes, id } = await cup([], { periods: 3 });
    const keeper = await keeperOf(first);
    const period = (who: { call: Json }, p: number, now: Date) =>
      who.call("POST", `/api/tournaments/${id}/games/${first.id}/clock`, { action: "period", period: p }, { now });
    const game = async (now: Date) => (await tournament(undefined, now)).games.find((x: Json) => x.id === first.id);
    await clock(keeper, first.id, "start", at(0));
    await goal(keeper, first.id, { teamId: first.homeTeamId }, at(3));
    expect((await game(at(3))).period).toBe(1);
    // Time's up in the 1st: on to the 2nd, paused, the full length again
    expect((await period(keeper, 1, at(gameMinutes))).status).toBe(200);
    let g = await game(at(gameMinutes + 1));
    expect(g).toMatchObject({ status: "live", period: 2, clockStartedAt: null, clockLeftMs: gameMinutes * 60_000 });
    // Sent twice (two phones, a retry): still the 2nd
    expect((await period(keeper, 1, at(gameMinutes + 1))).status).toBe(200);
    expect((await game(at(gameMinutes + 1))).period).toBe(2);
    await clock(keeper, first.id, "start", at(20));
    await goal(keeper, first.id, { teamId: first.awayTeamId }, at(22));
    g = await game(at(22));
    expect(g.goals.map((x: Json) => [x.period, x.atMs])).toEqual([
      [1, 3 * 60_000],
      [2, 2 * 60_000],
    ]);
    // Only the scorekeeper
    const mo = await w.signedIn("mo@example.com");
    expect((await period(mo, 2, at(23))).status).toBe(403);
    expect((await period(keeper, 2, at(23))).status).toBe(200);
    // The last: there's no 4th; full time ends it
    expect((await period(keeper, 3, at(40))).status).toBe(409);
    expect((await clock(keeper, first.id, "end", at(40))).status).toBe(200);
    expect(await game(at(40))).toMatchObject({ status: "done", period: 3, homeGoals: 1, awayGoals: 1 });
  });

  it("a penalty carries its period too", async () => {
    const { first, keeperOf, clock, penalty, tournament, id, gameMinutes } = await cup([], { periods: 2 });
    const keeper = await keeperOf(first);
    await clock(keeper, first.id, "start", at(0));
    await keeper.call(
      "POST",
      `/api/tournaments/${id}/games/${first.id}/clock`,
      { action: "period", period: 1 },
      { now: at(gameMinutes) },
    );
    await clock(keeper, first.id, "start", at(15));
    await penalty(keeper, first.id, { teamId: first.homeTeamId, infraction: "delay-of-game" }, at(16));
    const g = (await tournament(undefined, at(16))).games.find((x: Json) => x.id === first.id);
    expect(g.penalties).toEqual([expect.objectContaining({ period: 2, atMs: 60_000 })]);
  });
});
