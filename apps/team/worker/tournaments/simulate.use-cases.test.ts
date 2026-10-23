// The Kumite simulator (ADR 0123): on dev, an admin plays a Kumite on from wherever it is to its after-party with
// one tap, so the after-party can be tried without scoring every match by hand. A request makes one move you'd see
// (a pick, a goal, a period's end), says which, and whether that's all, so the app can pace it to watch. It goes
// through the app's own use cases (the draft, the scoresheet, the clock, goals and penalties), stops with the awards provisional, carries on
// where it stopped when asked again, and isn't there at all in production or wherever the environment doesn't say
// it's dev or your own machine. Driven through the real Worker handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { awardFromData } from "../../src/lib/awards";
import { atAfters } from "../../src/lib/edition";
import { londonEvening } from "../../src/lib/dates";
import { table } from "../../src/lib/fixtures";
import { testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const PLAYERS = 10;
const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "c1@example.com" },
  { name: "Cole Captain", position: "G", rating: 68, email: "c2@example.com" },
  { name: "Cass Captain", position: "F", rating: 66, email: "c3@example.com" },
  { name: "Cy Captain", position: "D", rating: 64, email: "c4@example.com" },
  // Three goalies among the players: a team that has one (Cole's) can't take another
  ...Array.from({ length: PLAYERS }, (_, i) => ({
    name: `Player ${i + 1}`,
    position: i < 3 ? "G" : i % 2 ? "F" : "D",
    rating: 50,
    email: `p${i + 1}@example.com`,
  })),
];
/** The Kumite series, as the club's seed has it. */
const KUMITE = 1;
/** Friday 13 November 2026, 19:30 GMT: the Kumite's evening. */
const EVENING = { now: new Date("2026-11-13T19:30:00Z") };

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Phone = Awaited<ReturnType<typeof w.signedIn>>;
const rows = (sql: string, ...params: unknown[]) => w.db.raw.prepare(sql).all(...params) as Json[];

/**
 * A Kumite on Friday 13 November: four captains, `signed` players in, two periods a match, a final; nothing drawn.
 * Seeded luck, so the draw, the picks and every goal come out the same each run.
 */
async function kumite({ signed = PLAYERS, seed = 7 } = {}) {
  w.luck(seed);
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap", undefined, EVENING)).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  const made = await dana.call("POST", "/api/tournaments", {
    typeId: KUMITE,
    name: "Kumite Autumn 2026",
    heldOn: "2026-11-13",
    startTime: "19:00",
    endTime: "21:30",
    status: "open",
    feePence: 0,
    kind: "draft",
    periods: 2,
    playoffs: [{ name: "Final", home: 1, away: 2 }],
    teams: ["Cara Captain", "Cole Captain", "Cass Captain", "Cy Captain"].map((n) => ({
      name: "",
      captainMemberId: idOf(n),
    })),
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  for (let i = 1; i <= signed; i++) {
    const p = await w.signedIn(`p${i}@example.com`);
    expect((await p.call("POST", `/api/tournaments/${id}/answer`, { answer: "in" }, EVENING)).status).toBe(200);
  }
  const tournament = async (as: Phone = dana) =>
    ((await as.call("GET", "/api/bootstrap", undefined, EVENING)).body as Json).tournaments.find(
      (t: Json) => t.id === id,
    );
  /** One request: one move on. */
  const simulate = (as: Phone = dana) => as.call("POST", `/api/tournaments/${id}/simulate`, {}, EVENING);
  /** As the app does it: ask again till it says it's done. */
  const playOn = async () => {
    /** The most D1 round trips a request made: the free plan stops an invocation at 50 queries. */
    let most = 0;
    for (let i = 0; i < 1000; i++) {
      const before = w.db.roundTrips;
      const res = await simulate();
      most = Math.max(most, w.db.roundTrips - before);
      expect(res.status).toBe(200);
      if (res.body.done) return { res, requests: i + 1, most };
    }
    throw new Error("It never finished.");
  };
  return { dana, id, idOf, tournament, simulate, playOn };
}

describe("simulating the rest of a Kumite, on dev", () => {
  it("from the teams set to the after-party: drafted, every match played, standings and provisional awards", async () => {
    const k = await kumite();
    const { res, requests, most } = await k.playOn();
    expect(res.body.said).toMatch(/after-party/);
    // Each request well inside an invocation's 50 D1 queries (Workers Free), the wrapper's own reads included
    expect(most).toBeLessThan(50);
    // A move a request: every pick and every goal its own, so the page moves as it plays
    expect(requests).toBeGreaterThan(60);

    const t = await k.tournament();
    // The draft drawn, every one of them picked (a goalie a team: four goalies, four teams), closed
    expect(t.draftState).toBe("closed");
    const drafted = t.teams.flatMap((x: Json) => x.players.map((p: Json) => p.memberId));
    expect(drafted).toHaveLength(PLAYERS);
    for (const team of t.teams) {
      const goalies = [team.captainMemberId, ...team.players.map((p: Json) => p.memberId)].filter(
        (m) => ROSTER.find((r) => k.idOf(r.name) === m)!.position === "G",
      );
      expect(goalies.length).toBeLessThanOrEqual(1);
    }
    // Every match, the final too, has a result and its goals, scored on the clock in its periods
    expect(t.games).toHaveLength(7);
    for (const g of t.games) {
      expect(g.status).toBe("done");
      expect(g.homeTeamId && g.awayTeamId).toBeTruthy();
      expect(g.goals).toHaveLength(g.homeGoals + g.awayGoals);
      for (const goal of g.goals) {
        expect(goal.atMs).toBeGreaterThanOrEqual(0);
        expect(goal.atMs).toBeLessThanOrEqual(12 * 60_000);
        expect([1, 2]).toContain(goal.period);
      }
    }
    const final = t.games.find((g: Json) => g.stage === "playoff");
    expect(final.homeGoals).not.toBe(final.awayGoals);
    const goals = t.games.reduce((n: number, g: Json) => n + g.goals.length, 0);
    expect(goals).toBeGreaterThan(0);
    // On the record as it went: the draft closed, the fixtures made, each match finished (not every goal)
    const record = rows("SELECT detail FROM audit_log WHERE action = 'tournament.simulated' ORDER BY id");
    expect(record.length).toBeGreaterThanOrEqual(8);
    expect(record.length).toBeLessThan(requests);
    expect(JSON.parse(record.at(-1).detail).to).toMatchObject({ games: 7, played: 7, draftState: "closed" });
    // ...and a penalty or two along the way
    expect(rows("SELECT COUNT(*) n FROM tournament_penalties")[0].n).toBeGreaterThan(0);

    // The standings: every team in the table, the group's matches all counted
    const ids = t.teams.map((x: Json) => x.id);
    const standings = table(
      ids,
      t.games.filter((g: Json) => g.stage === "group"),
      { win: 3, draw: 1, loss: 0 },
    );
    expect(standings).toHaveLength(4);
    expect(standings.reduce((n, r) => n + r.p, 0)).toBe(12);

    // At its after-party that evening, the awards provisional: from the data, nothing confirmed or revealed
    expect(atAfters(t, londonEvening(EVENING.now))).toBe(true);
    const positionOf = (m: number) => ROSTER.find((r) => k.idOf(r.name) === m)?.position;
    expect(awardFromData("Champions", t, { positionOf })?.winners).toHaveLength(1);
    expect(awardFromData("Top scorer", t, { positionOf })?.winners.length).toBeGreaterThan(0);
    expect(t.winners).toEqual([]);
    expect(t.awardsRevealed).toBe(0);
    // ...so the admin confirms them and reveals them by hand, as on the night
    const confirmed = await k.dana.call(
      "PUT",
      `/api/tournaments/${k.id}/winners`,
      { winners: [{ award: "Champions", teamId: awardFromData("Champions", t, { positionOf })!.winners[0].teamId }] },
      EVENING,
    );
    expect(confirmed.status).toBe(200);
    expect((await k.dana.call("POST", `/api/tournaments/${k.id}/awards/reveal`, { next: 0 }, EVENING)).status).toBe(
      200,
    );
  });

  it("run again, it says there's nothing left; stopped part way, it carries on from there", async () => {
    const k = await kumite();
    // Stopped once the draft's closed: run again, it carries on with the matches
    while ((await k.tournament()).draftState !== "closed") expect((await k.simulate()).status).toBe(200);
    expect((await k.tournament()).games.every((g: Json) => g.status === "next")).toBe(true);
    const { res } = await k.playOn();
    expect(res.body.done).toBe(true);
    const again = await k.simulate();
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ done: true, said: expect.stringMatching(/after-party/) });
    expect((await k.tournament()).games.every((g: Json) => g.status === "done")).toBe(true);
  });

  it("takes over a match someone else is scoring, and plays it on from where they left it", async () => {
    const k = await kumite();
    // Played up to the fixtures (and perhaps into the first match: back to the fight card, unplayed)
    while (!(await k.tournament()).games?.length) expect((await k.simulate()).status).toBe(200);
    const g0 = (await k.tournament()).games[0];
    if (g0.status !== "next")
      expect(
        (await k.dana.call("POST", `/api/tournaments/${k.id}/step-back`, { from: "results" }, EVENING)).status,
      ).toBe(200);
    else if (g0.keeperId)
      expect(
        (await k.dana.call("POST", `/api/tournaments/${k.id}/games/${g0.id}/scorer`, { action: "release" }, EVENING))
          .status,
      ).toBe(200);
    const t = await k.tournament();
    const first = t.games[0];
    const captain = t.teams.find((x: Json) => x.id === first.homeTeamId).captainMemberId;
    const email = ROSTER.find((r) => k.idOf(r.name) === captain)!.email;
    const keeper = await w.signedIn(email);
    const path = `/api/tournaments/${k.id}/games/${first.id}`;
    expect((await keeper.call("POST", `${path}/scorer`, { action: "claim" }, EVENING)).status).toBe(200);
    expect((await keeper.call("POST", `${path}/clock`, { action: "start" }, EVENING)).status).toBe(200);
    const later = { now: new Date(EVENING.now.getTime() + 3 * 60_000) };
    expect((await keeper.call("POST", `${path}/goals`, { teamId: first.homeTeamId }, later)).status).toBe(200);

    await k.playOn();
    const played = (await k.tournament()).games.find((g: Json) => g.id === first.id);
    expect(played.status).toBe("done");
    // Their goal's still there, at the time they logged it
    expect(played.goals[0]).toMatchObject({ teamId: first.homeTeamId, atMs: 3 * 60_000, period: 1 });
  });

  it("too few signed up: it says so, and signs nobody up", async () => {
    const k = await kumite({ signed: 5 });
    // The order's drawn (that's one move, whoever's signed up), then opening it is refused
    expect((await k.simulate()).body).toMatchObject({ done: false, move: "order" });
    const res = await k.simulate();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Not enough players/);
    // The five, and the four captains (in by being captains)
    expect(rows("SELECT COUNT(*) n FROM tournament_entries WHERE tournament_id = ?", k.id)[0].n).toBe(9);
    // Nothing moved on but the order, which is drawn either way
    expect((await k.tournament()).draftState).toBe("none");
  });
});

/** What's been done so far, counted: a move changes one of these (and what that one change carries with it). */
function progress(id: number) {
  const [t] = rows(
    `SELECT draft_state draft,
            (SELECT COUNT(pick) FROM tournament_teams WHERE tournament_id = t.id) "order",
            (SELECT COUNT(*) FROM tournament_team_players p JOIN tournament_teams x ON x.id = p.team_id
             WHERE x.tournament_id = t.id AND p.pick_number IS NOT NULL) picks
     FROM tournaments t WHERE t.id = ?`,
    id,
  );
  const [g] = rows(
    `SELECT COUNT(*) fixtures, COUNT(keeper_member_id) keepers, COUNT(clock_started_at) running,
            COALESCE(SUM(period), 0) periods, COUNT(home_team_id) + COUNT(away_team_id) filled,
            SUM(status = 'done') played,
            (SELECT COUNT(*) FROM tournament_goals WHERE game_id IN
              (SELECT id FROM tournament_games WHERE tournament_id = ?)) goals,
            (SELECT COUNT(*) FROM tournament_penalties WHERE game_id IN
              (SELECT id FROM tournament_games WHERE tournament_id = ?)) penalties
     FROM tournament_games WHERE tournament_id = ?`,
    id,
    id,
    id,
  );
  return { ...t, ...g, played: g.played ?? 0 } as Record<string, string | number>;
}

/** Each move: what it must change, and what else may change with it (full time frees the clock, fills the playoffs). */
const MOVES: Record<string, { changes: string; with?: string[] }> = {
  order: { changes: "order" },
  open: { changes: "draft" },
  pick: { changes: "picks" },
  close: { changes: "draft", with: ["fixtures", "filled", "periods"] },
  fixtures: { changes: "fixtures", with: ["filled", "periods"] },
  scoresheet: { changes: "keepers" },
  clock: { changes: "running" },
  goal: { changes: "goals" },
  penalty: { changes: "penalties" },
  period: { changes: "periods", with: ["running"] },
  fulltime: { changes: "played", with: ["running", "keepers", "filled"] },
};

describe("one move a request, to watch", () => {
  it("each request makes exactly one move you'd see, says which, and says when that's all", async () => {
    const k = await kumite();
    const seen = new Set<string>();
    for (let i = 0; ; i++) {
      expect(i).toBeLessThan(1000);
      const before = progress(k.id);
      const res = await k.simulate();
      expect(res.status).toBe(200);
      const after = progress(k.id);
      const changed = Object.keys(after).filter((key) => after[key] !== before[key]);
      if (res.body.done) {
        expect(res.body).toMatchObject({ move: "done", said: expect.stringMatching(/after-party/) });
        expect(changed).toEqual([]);
        break;
      }
      const rule = MOVES[res.body.move];
      expect(rule, `a move it knows: ${res.body.move}`).toBeDefined();
      expect(res.body.said).toBeTruthy();
      // The one thing it said it did, and nothing more than goes with it
      expect(changed, `${res.body.move}: ${res.body.said}`).toContain(rule.changes);
      for (const key of changed) expect([rule.changes, ...(rule.with ?? [])]).toContain(key);
      // A goal or a pick is one, not two
      if (rule.changes === "goals" || rule.changes === "picks" || rule.changes === "penalties")
        expect(Number(after[rule.changes]) - Number(before[rule.changes])).toBe(1);
      seen.add(res.body.move);
    }
    // The whole evening, a move at a time
    expect([...seen].sort()).toEqual(
      ["clock", "close", "fulltime", "goal", "open", "order", "penalty", "period", "pick", "scoresheet"].sort(),
    );
  });
});

describe("who and where", () => {
  it("in production it isn't there at all, even for an admin: a 404, nothing played, and the app's not told it's there", async () => {
    const k = await kumite();
    w.env.SITE_ENV = "production";
    const res = await k.simulate();
    expect(res.status).toBe(404);
    expect((await k.tournament()).draftState).toBe("none");
    expect(((await k.dana.call("GET", "/api/bootstrap")).body as Json).simulator).toBe(false);
  });

  it("with no environment said (nor TEAM_ENV local), it's production: a 404 for an admin", async () => {
    const k = await kumite();
    w.env.TEAM_ENV = undefined;
    expect((await k.simulate()).status).toBe(404);
    // ...and an environment it doesn't know is production too
    w.env.SITE_ENV = "staging";
    expect((await k.simulate()).status).toBe(404);
    expect((await k.tournament()).draftState).toBe("none");
  });

  it("on dev, a member who doesn't run tournaments is refused; an admin is told it's there", async () => {
    const k = await kumite();
    // Signed in on this machine first (dev would email the code), then the Worker is dev's
    const member = await w.signedIn("p4@example.com");
    Object.assign(w.env, { TEAM_ENV: undefined, SITE_ENV: "dev" });
    const refused = await k.simulate(member);
    expect(refused.status).toBe(403);
    expect((await k.tournament()).draftState).toBe("none");
    expect(((await member.call("GET", "/api/bootstrap")).body as Json).simulator).toBe(false);
    expect(((await k.dana.call("GET", "/api/bootstrap")).body as Json).simulator).toBe(true);
    expect((await k.simulate()).status).toBe(200);
  });
});
