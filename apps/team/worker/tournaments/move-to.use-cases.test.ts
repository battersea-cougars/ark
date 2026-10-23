// An admin moves the Kumite to any of its statuses at once (Move to…, ADR 0074): Sign-up open, Draft open, Teams set,
// Fixtures set, KUMITE!, The Anchor. Back undoes every step in between, in one go; forward does the jobs in between, the
// draft's rest chosen at random (one keeper a team, the captains on their own), its captains told. The page says the
// status it saw, so a second admin's move from a page that's out of date is refused; every move is one entry on the
// record. Driven through the real Worker handlers in the fake world, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { testWorld } from "../testing";
import { statusOf } from "../../src/lib/tournament-front";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Ann Admin", position: "F", rating: 60, email: "ann@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Cy Captain", position: "F", rating: 66, email: "cy@example.com" },
  // Four goalies for three teams: one a team, so one's left out
  ...["Gus", "Gil", "Gav", "Gwen"].map((n) => ({
    name: `${n} Goalie`,
    position: "G",
    rating: 60,
    email: `${n.toLowerCase()}@example.com`,
  })),
  ...["Reg", "Mo", "Ash", "Bo"].map((n, i) => ({
    name: `${n} Player`,
    position: i % 2 ? "D" : "F",
    rating: 55,
    email: `${n.toLowerCase()}@example.com`,
  })),
];
const SIGNED_UP = ["gus", "gil", "gav", "gwen", "reg", "mo", "ash", "bo"];
/** The Tuesday before the day: sign-up open till Thursday. */
const NOW = new Date("2026-12-08T19:30:00Z");
const at = { now: NOW };

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A captains' draft, Cara, Cole and Cy captains, sign-up open with `signedUp` in. */
async function kumite(signedUp = SIGNED_UP) {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  const made = await dana.call("POST", "/api/tournaments", {
    name: "Kumite Winter 2026",
    heldOn: "2026-12-12",
    startTime: "11:00",
    endTime: "16:00",
    status: "open",
    feePence: 0,
    kind: "draft",
    signupClosesOn: "2026-12-10",
    draftOn: "2026-12-10",
    teams: ["Cara Captain", "Cole Captain", "Cy Captain"].map((n) => ({ name: "", captainMemberId: idOf(n) })),
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  for (const n of signedUp)
    expect(
      (await (await w.signedIn(`${n}@example.com`)).call("POST", `/api/tournaments/${id}/answer`, { answer: "in" }, at))
        .status,
    ).toBe(200);
  const move = (from: string, to: string, as = dana) =>
    as.call("POST", `/api/tournaments/${id}/move`, { from, to }, at);
  const tournament = async () =>
    ((await dana.call("GET", "/api/bootstrap", undefined, at)).body as Json).tournaments.find((x: Json) => x.id === id);
  const status = async () => statusOf(await tournament(), "2026-12-08");
  /** What's in the database. */
  const left = () =>
    w.db.raw
      .prepare(
        `SELECT (SELECT COUNT(*) FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
                 WHERE t.tournament_id = @id) picks,
                (SELECT COUNT(pick) FROM tournament_teams WHERE tournament_id = @id) drawn,
                (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = @id) games,
                (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = @id AND status <> 'next') played,
                (SELECT COUNT(*) FROM tournament_goals WHERE game_id IN
                   (SELECT id FROM tournament_games WHERE tournament_id = @id)) goals,
                draft_state draft, status, signup_closed_at closedAt
         FROM tournaments WHERE id = @id`,
      )
      .get({ id }) as Json;
  /** Each team: its captain and its players, with their positions. */
  const teams = () =>
    w.db.raw
      .prepare(
        `SELECT t.id, t.captain_member_id captain, p.member_id member, m.position, p.picked_by pickedBy
         FROM tournament_teams t LEFT JOIN tournament_team_players p ON p.team_id = t.id
         LEFT JOIN members m ON m.id = p.member_id WHERE t.tournament_id = ? ORDER BY t.id, p.pick_number`,
      )
      .all(id) as { id: number; captain: number; member: number | null; position: string; pickedBy: number }[];
  return { dana, id, idOf, move, tournament, status, left, teams };
}

type Kumite = Awaited<ReturnType<typeof kumite>>;

/** A match played, 2–1, on the fight card. */
async function playOne(k: Kumite) {
  const game = (await k.tournament()).games[0];
  expect(
    (await k.dana.call("PUT", `/api/tournaments/${k.id}/games/${game.id}`, { homeGoals: 2, awayGoals: 1 }, at)).status,
  ).toBe(200);
}

describe("forward: the jobs in between, done in one go", () => {
  it("Sign-up open to Fixtures set: sign-up closed, the order drawn, the rest chosen at random, the fixtures made", async () => {
    const k = await kumite();
    expect(await k.status()).toBe("signup");
    const res = await k.move("signup", "fixtures");
    expect(res.status).toBe(200);
    expect(res.body.done).toEqual([
      "sign-up closed",
      "the order of choosing drawn",
      "8 players still unchosen put on teams at random (one keeper a team), the draft closed",
      "the fixtures made, in a fair order",
    ]);
    // Three goalies picked, one a team; the fourth left out
    expect([res.body.chosen, res.body.leftOut]).toEqual([7, 1]);
    expect(k.left()).toMatchObject({ picks: 7, drawn: 3, draft: "closed", played: 0 });
    expect(k.left().games).toBeGreaterThan(0);
    expect(k.left().closedAt).not.toBeNull();
    expect(await k.status()).toBe("fixtures");
    // Each pick names the admin who made the move
    expect(new Set(k.teams().map((r) => r.pickedBy))).toEqual(new Set([k.idOf("Dana Admin")]));
  });

  it.each(seeds(6))(
    "the random choosing keeps one keeper a team, the captains on their own (seed %i)",
    async (seed) => {
      w.luck(seed);
      const k = await kumite();
      expect((await k.move("signup", "teams")).status).toBe(200);
      const rows = k.teams();
      const captains = new Set(rows.map((r) => r.captain));
      for (const team of new Set(rows.map((r) => r.id))) {
        const on = rows.filter((r) => r.id === team && r.member !== null);
        expect(on.filter((r) => r.position === "G")).toHaveLength(1);
        expect(on.some((r) => captains.has(r.member!))).toBe(false);
      }
      // Every outfield player is on a team: only a goalie too many is left out
      expect(rows.filter((r) => r.member !== null && r.position !== "G")).toHaveLength(4);
      expect(await k.status()).toBe("teams");
    },
  );

  it("Sign-up open to Draft open: sign-up closed, the order drawn, the draft opened, and the captains hear it", async () => {
    const k = await kumite();
    for (const n of ["cara", "cole", "cy"])
      await (
        await w.signedIn(`${n}@example.com`)
      ).call("PUT", "/api/auth/device", { token: `${n}-phone`, platform: "ios" });
    const res = await k.move("signup", "draft");
    expect(res.status).toBe(200);
    expect(k.left()).toMatchObject({ picks: 0, drawn: 3, draft: "open" });
    expect(w.pushes.map((p) => p.title)).toEqual(Array(3).fill("Kumite Winter 2026 Draft Open"));
  });

  it("the draft open with picks made: on to Teams set, the rest at random, each captain told so", async () => {
    const k = await kumite();
    expect((await k.move("signup", "draft")).status).toBe(200);
    for (const n of ["cara", "cole", "cy"])
      await (
        await w.signedIn(`${n}@example.com`)
      ).call("PUT", "/api/auth/device", { token: `${n}-phone`, platform: "ios" });
    w.pushes.length = 0;
    const res = await k.move("draft", "teams");
    expect(res.status).toBe(200);
    expect(k.left()).toMatchObject({ picks: 7, draft: "closed", games: 0 });
    expect(w.pushes.map(({ title, body }) => ({ title, body }))).toEqual(
      Array(3).fill({
        title: "Kumite Winter 2026 Teams Set",
        body: "The draft's closed: the rest were chosen at random.",
      }),
    );
  });

  it("Fixtures set to KUMITE!: marked under way, nothing played; then to The Anchor: finished, the matches unplayed", async () => {
    const k = await kumite();
    expect((await k.move("signup", "fixtures")).status).toBe(200);
    const day = await k.move("fixtures", "day");
    expect([day.status, day.body.done]).toEqual([200, ["marked under way: the first match can start"]]);
    expect(k.left()).toMatchObject({ status: "live", played: 0 });
    expect(await k.status()).toBe("day");
    const anchor = await k.move("day", "afters");
    expect([anchor.status, anchor.body.done]).toEqual([200, ["marked finished: matches not played stay unplayed"]]);
    expect(k.left()).toMatchObject({ status: "finished", played: 0 });
    expect(await k.status()).toBe("afters");
  });

  it("Sign-up open straight to The Anchor", async () => {
    const k = await kumite();
    expect((await k.move("signup", "afters")).status).toBe(200);
    expect(k.left()).toMatchObject({ status: "finished", draft: "closed", picks: 7 });
    expect(await k.status()).toBe("afters");
  });

  it("too few signed up for the draft: refused, and nothing changes (sign-up still open)", async () => {
    const k = await kumite(["reg", "mo"]);
    const res = await k.move("signup", "fixtures");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/^Not enough players yet/);
    expect(k.left()).toMatchObject({ drawn: 0, draft: "none", closedAt: null, games: 0 });
  });
});

describe("back: every step in between undone, in one go", () => {
  it("Fixtures set back to Sign-up open: the fixtures, the picks and the order off, sign-up open again", async () => {
    const k = await kumite();
    expect((await k.move("signup", "fixtures")).status).toBe(200);
    const res = await k.move("fixtures", "signup");
    expect(res.status).toBe(200);
    expect(res.body.done).toEqual([
      "the fixtures cleared",
      "the draft reopened",
      "7 choices off the teams",
      "the order of choosing undrawn",
      "sign-up open again",
    ]);
    expect(k.left()).toMatchObject({ picks: 0, drawn: 0, games: 0, draft: "none", status: "open", closedAt: null });
    expect(await k.status()).toBe("signup");
    // Members can say they're in again
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `/api/tournaments/${k.id}/answer`, { answer: "out" }, at)).status).toBe(200);
  });

  it("a match played, KUMITE!, back to Teams set: its result and goals deleted, the fixtures cleared", async () => {
    const k = await kumite();
    expect((await k.move("signup", "fixtures")).status).toBe(200);
    await playOne(k);
    expect(await k.status()).toBe("day");
    const res = await k.move("day", "teams");
    expect(res.status).toBe(200);
    expect(res.body.done[0]).toMatch(/^1 result and \d+ goals? deleted$/);
    expect(res.body.done.slice(1)).toEqual(["the fixtures cleared"]);
    expect(k.left()).toMatchObject({ games: 0, goals: 0, draft: "closed", picks: 7 });
    expect(await k.status()).toBe("teams");
  });

  it("The Anchor, marked finished, back to KUMITE!: under way again, nothing deleted", async () => {
    const k = await kumite();
    expect((await k.move("signup", "fixtures")).status).toBe(200);
    await playOne(k);
    expect((await k.move("day", "afters")).status).toBe(200);
    const res = await k.move("afters", "day");
    expect([res.status, res.body.done]).toEqual([200, ["the day under way again"]]);
    expect(k.left()).toMatchObject({ status: "live", played: 1 });
    expect(await k.status()).toBe("day");
  });

  it("The Anchor back to Fixtures set: the day no longer under way, the results gone", async () => {
    const k = await kumite();
    expect((await k.move("signup", "fixtures")).status).toBe(200);
    await playOne(k);
    expect((await k.move("day", "afters")).status).toBe(200);
    expect((await k.move("afters", "fixtures")).status).toBe(200);
    expect(k.left()).toMatchObject({ status: "open", played: 0, goals: 0 });
    expect(await k.status()).toBe("fixtures");
  });

  it("Teams set back to Draft open: the draft reopened, every pick kept", async () => {
    const k = await kumite();
    expect((await k.move("signup", "teams")).status).toBe(200);
    expect((await k.move("teams", "draft")).status).toBe(200);
    expect(k.left()).toMatchObject({ draft: "open", picks: 7 });
  });
});

describe("who moves it, and when it's moved on", () => {
  it("a member gets 403; a captain too", async () => {
    const k = await kumite();
    const reg = await w.signedIn("reg@example.com");
    expect((await k.move("signup", "fixtures", reg)).status).toBe(403);
    expect((await k.move("signup", "fixtures", await w.signedIn("cara@example.com"))).status).toBe(403);
    expect(k.left()).toMatchObject({ drawn: 0, closedAt: null });
  });

  it("two admins at once: one moves, the other's page is out of date and is refused", async () => {
    const k = await kumite();
    expect((await k.move("signup", "fixtures")).status).toBe(200);
    const ann = await w.signedIn("ann@example.com");
    expect((await k.move("fixtures", "signup")).status).toBe(200);
    const late = await k.move("fixtures", "teams", ann);
    expect([late.status, late.body.error]).toEqual([409, "It's moved on since: have another look."]);
    expect(k.left()).toMatchObject({ draft: "none", picks: 0 });
  });

  it.each(seeds(5))("two moves back at the same moment: one lands, the other is refused (seed %i)", async (seed) => {
    const k = await kumite();
    expect((await k.move("signup", "fixtures")).status).toBe(200);
    const ann = await w.signedIn("ann@example.com");
    w.db.interleave(seed);
    const replies = await Promise.all([k.move("fixtures", "teams"), k.move("fixtures", "teams", ann)]);
    w.db.interleave(null);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(k.left()).toMatchObject({ games: 0, draft: "closed", picks: 7 });
  });

  it("a status that isn't one, or the one it's at: refused", async () => {
    const k = await kumite();
    expect((await k.move("signup", "sideways")).status).toBe(400);
    const here = await k.move("signup", "signup");
    expect([here.status, here.body.error]).toEqual([409, "It's here now."]);
  });

  it("every move is one entry on the record: from, to, and what it did", async () => {
    const k = await kumite();
    expect((await k.move("signup", "fixtures")).status).toBe(200);
    const entries = w.db.raw
      .prepare("SELECT detail FROM audit_log WHERE action = 'tournament.moved' ORDER BY id")
      .all() as { detail: string }[];
    expect(entries).toHaveLength(1);
    const { from, to, done } = JSON.parse(entries[0].detail);
    expect(from).toMatchObject({ stage: "signup", picks: 0, games: 0 });
    expect(to).toMatchObject({ stage: "fixtures", picks: 7, draftState: "closed" });
    expect(done).toContain("the fixtures made, in a fair order");
  });
});
