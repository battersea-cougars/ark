// The draft's edges (ADR 0060, 0121): every step out of order, the first and last picks, a pick's turn, three captains'
// snake, who may run which step, people leaving mid-draft, and deleting what the draft made. Driven through the real
// Worker handlers in the fake world, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { nextSlots, onTheClock } from "../../src/lib/draft";
import { chargeDue } from "../dues/dues";
import { testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const PLAYERS = 7;
const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  // Given a role that runs the draft and nothing more (draftRunner)
  { name: "Rae Runner", position: "F", rating: 50, email: "rae@example.com" },
  { name: "Cara Captain", position: "F", rating: 70, email: "c1@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "c2@example.com" },
  { name: "Cass Captain", position: "F", rating: 66, email: "c3@example.com" },
  ...Array.from({ length: PLAYERS }, (_, i) => ({
    name: `Player ${i + 1}`,
    position: i === 0 ? "G" : i % 2 ? "F" : "D",
    rating: 50,
    email: `p${i + 1}@example.com`,
  })),
  // Never signs up
  { name: "Olly Outsider", position: "F", rating: 50, email: "olly@example.com" },
];
const DRAFT_DAY = new Date("2026-12-08T19:30:00Z");
const at = { now: DRAFT_DAY };

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Phone = Awaited<ReturnType<typeof w.signedIn>>;
/** What's in the database, read straight from it. */
const rows = (sql: string, ...params: unknown[]) => w.db.raw.prepare(sql).all(...params);

/**
 * A draft-kind tournament with `captains` captains (two or three) and `signed` players signed up, the order not yet
 * drawn. Seeded luck, so the draw comes out the same each run.
 */
async function draftNight({ captains = 2, signed = PLAYERS, kind = "draft" as "draft" | "teams", seed = 1 } = {}) {
  w.luck(seed);
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  const captainIds = ["Cara Captain", "Cole Captain", "Cass Captain"].slice(0, captains).map(idOf);
  const made = await dana.call("POST", "/api/tournaments", {
    name: "Winter Cup 2026",
    heldOn: "2026-12-12",
    startTime: "11:00",
    endTime: "16:00",
    status: "open",
    feePence: 0,
    kind,
    draftOn: "2026-12-08",
    teams: captainIds.map((captainMemberId, i) => ({ name: kind === "teams" ? `Team ${i + 1}` : "", captainMemberId })),
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  const players = Array.from({ length: PLAYERS }, (_, i) => idOf(`Player ${i + 1}`));
  const playerPhones: Phone[] = [];
  for (let i = 1; i <= PLAYERS; i++) {
    const p = await w.signedIn(`p${i}@example.com`);
    if (i <= signed) expect((await p.call("POST", `/api/tournaments/${id}/answer`, { answer: "in" })).status).toBe(200);
    playerPhones.push(p);
  }
  const captainPhones: Phone[] = [];
  for (let i = 1; i <= captains; i++) captainPhones.push(await w.signedIn(`c${i}@example.com`));
  const step = (as: Phone, what: "draw" | "open" | "close" | "reset", body: object = {}) =>
    as.call("POST", `/api/tournaments/${id}/draft/${what}`, body, at);
  const pick = (as: Phone, memberId: unknown, turn?: unknown) =>
    as.call("POST", `/api/tournaments/${id}/draft/picks`, turn === undefined ? { memberId } : { memberId, turn }, at);
  const undo = (as: Phone) => as.call("DELETE", `/api/tournaments/${id}/draft/picks/last`, undefined, at);
  const tournament = async () =>
    ((await dana.call("GET", "/api/bootstrap", undefined, at)).body as Json).tournaments.find((x: Json) => x.id === id);
  /** The teams in pick order: each its captain and its players' ids. */
  const teams = async () =>
    ((await tournament()).teams as Json[]).map((t) => ({
      id: t.id as number,
      captain: t.captainMemberId as number,
      players: (t.players as Json[]).map((p) => p.memberId as number),
    }));
  /** The phone of the captain on the clock now. */
  const onClock = async () => {
    const order = await teams();
    const made = order.reduce((n, t) => n + t.players.length, 0);
    // The first pick number nobody has (#125): the turn follows the numbers, not the count
    const taken = (
      rows(
        `SELECT p.pick_number n FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
         WHERE t.tournament_id = ? AND p.pick_number IS NOT NULL`,
        id,
      ) as { n: number }[]
    ).map((r) => r.n);
    const team = order[onTheClock(order.length, nextSlots(taken, 1)[0])];
    return { phone: captainPhones[captainIds.indexOf(team.captain)], team, made };
  };
  return {
    id,
    dana,
    idOf,
    captainIds,
    players,
    playerPhones,
    captainPhones,
    step,
    pick,
    undo,
    tournament,
    teams,
    onClock,
  };
}

async function opened(o: Parameters<typeof draftNight>[0] = {}) {
  const d = await draftNight(o);
  expect((await d.step(d.dana, "draw")).status).toBe(200);
  expect((await d.step(d.dana, "open")).status).toBe(200);
  return d;
}

/** Rae, given a role that can run the draft and nothing more (ADR 0024: roles are data). */
async function draftRunner(dana: Phone) {
  const role = await dana.call("POST", "/api/roles", { name: "Draft runner", description: "", actions: ["run:Draft"] });
  expect(role.status).toBe(201);
  const rae = ((await dana.call("GET", "/api/bootstrap")).body as Json).members.find(
    (m: Json) => m.name === "Rae Runner",
  );
  expect((await dana.call("PUT", `/api/members/${rae.id}`, { ...rae, roles: ["Draft runner", "Member"] })).status).toBe(
    200,
  );
  return w.signedIn("rae@example.com");
}

describe("the draft's steps, in order: a step out of order is refused and changes nothing", () => {
  it("before it opens, a pick, an Undo and a Close are all refused, and nobody's on a team", async () => {
    const d = await draftNight();
    expect((await d.step(d.dana, "draw")).status).toBe(200);
    const [cara] = d.captainPhones;
    const pick = await d.pick(d.dana, d.players[1]);
    expect(pick.status).toBe(409);
    expect(pick.body.error).toBe("The draft isn't open yet.");
    expect((await d.pick(cara, d.players[1])).status).toBe(409);
    expect((await d.undo(d.dana)).status).toBe(409);
    expect((await d.step(d.dana, "close", { leaveOut: true })).status).toBe(409);
    expect((await d.teams()).every((t) => t.players.length === 0)).toBe(true);
    expect((await d.tournament()).draftState).toBe("scheduled");
  });

  it("opening an open draft again keeps it open with its picks, and the captain on the clock stays on it", async () => {
    const d = await opened();
    const first = await d.onClock();
    expect((await d.pick(first.phone, d.players[1])).status).toBe(200);
    const next = await d.onClock();
    expect((await d.step(d.dana, "open")).status).toBe(200);
    expect((await d.step(d.dana, "draw")).status).toBe(200);
    expect((await d.onClock()).team.id).toBe(next.team.id);
    expect((await d.teams()).flatMap((t) => t.players)).toEqual([d.players[1]]);
  });

  it("once it's closed, a pick and an Undo are refused, a second Close too; reopened, the next captain carries on", async () => {
    const d = await opened();
    const first = await d.onClock();
    expect((await d.pick(first.phone, d.players[1])).status).toBe(200);
    expect((await d.step(d.dana, "close", { leaveOut: true })).status).toBe(200);
    const next = await d.onClock();
    const closed = await d.pick(next.phone, d.players[2]);
    expect(closed.status).toBe(409);
    expect(closed.body.error).toBe("The draft is closed.");
    expect((await d.pick(d.dana, d.players[2])).status).toBe(409);
    expect((await d.undo(d.dana)).status).toBe(409);
    expect((await d.step(d.dana, "close", { leaveOut: true })).status).toBe(409);
    // Reopened: the same captain's on the clock, with the pick kept
    expect((await d.step(d.dana, "open")).status).toBe(200);
    expect((await d.pick(next.phone, d.players[2])).status).toBe(200);
    expect((await d.teams()).flatMap((t) => t.players).sort()).toEqual([d.players[1], d.players[2]].sort());
  });

  it("closed with nobody picked, leaving everyone out, it reopens only with enough signed up, as the first time", async () => {
    const d = await opened();
    expect((await d.step(d.dana, "close", { leaveOut: true })).status).toBe(200);
    // Two say they're out while it's closed (they're on no team): 5 left, the two captains need 4
    for (const p of d.playerPhones.slice(0, 3))
      expect((await p.call("POST", `/api/tournaments/${d.id}/answer`, { answer: "out" }, at)).status).toBe(200);
    expect((await d.step(d.dana, "open")).status).toBe(200);
    for (const p of d.playerPhones.slice(3, 4))
      expect((await p.call("POST", `/api/tournaments/${d.id}/answer`, { answer: "out" }, at)).status).toBe(200);
    expect((await d.step(d.dana, "close", { leaveOut: true })).status).toBe(200);
    // 3 left: not enough for two teams of three
    const reopen = await d.step(d.dana, "open");
    expect(reopen.status).toBe(409);
    expect(reopen.body.error).toMatch(/Not enough players yet/);
  });

  it("closing with players still to pick says how many, and closes only when told to leave them out", async () => {
    const d = await opened({ signed: 5 });
    const first = await d.onClock();
    expect((await d.pick(first.phone, d.players[1])).status).toBe(200);
    const refused = await d.step(d.dana, "close");
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("4 still to pick. Pick them, or close it leaving them out.");
    expect((await d.step(d.dana, "close", { leaveOut: "yes" })).status).toBe(409);
    expect((await d.step(d.dana, "close", { leaveOut: true })).status).toBe(200);
    expect((await d.tournament()).draftState).toBe("closed");
  });

  it("a tournament teams enter has no draft: drawing, opening, closing, picking and Undo are refused", async () => {
    const d = await draftNight({ kind: "teams" });
    for (const what of ["draw", "open", "close", "reset"] as const) {
      const res = await d.step(d.dana, what);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Teams enter this tournament; there's no draft.");
    }
    expect((await d.pick(d.dana, d.players[1])).status).toBe(409);
    expect((await d.undo(d.dana)).status).toBe(409);
  });

  it("a draft that isn't there is a 404 for every step", async () => {
    const d = await draftNight();
    for (const what of ["draw", "open", "close", "reset"] as const)
      expect((await d.dana.call("POST", `/api/tournaments/9999/draft/${what}`, {}, at)).status).toBe(404);
    expect(
      (await d.dana.call("POST", "/api/tournaments/9999/draft/picks", { memberId: d.players[0] }, at)).status,
    ).toBe(404);
    expect((await d.dana.call("DELETE", "/api/tournaments/9999/draft/picks/last", undefined, at)).status).toBe(404);
  });

  it("with only one captain there's no draft to draw or open", async () => {
    const d = await draftNight({ captains: 2 });
    const t = await d.tournament();
    expect((await d.dana.call("PUT", `/api/tournaments/${d.id}`, { ...t, teams: [t.teams[0]] }, at)).status).toBe(200);
    for (const what of ["draw", "open"] as const) {
      const res = await d.step(d.dana, what);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("A draft needs at least two captains.");
    }
  });
});

describe("turns: first pick, last pick, and three captains' snake", () => {
  it("three captains pick 1 2 3, 3 2 1, 1: at every turn only the captain on the clock can pick", async () => {
    const d = await opened({ captains: 3 });
    const order = (await d.teams()).map((t) => d.captainIds.indexOf(t.captain));
    const expected = [0, 1, 2, 2, 1, 0, 0].map((slot) => order[slot]);
    for (const [turn, who] of expected.entries()) {
      for (const [i, other] of d.captainPhones.entries())
        if (i !== who) expect((await d.pick(other, d.players[turn])).status).toBe(409);
      expect((await d.pick(d.captainPhones[who], d.players[turn], turn)).status).toBe(200);
    }
    // Seven players for three teams: the first in the order got three, the others two
    expect((await d.teams()).map((t) => t.players.length)).toEqual([3, 2, 2]);
  });

  it("Undo of the very first pick: the first captain's on the clock again, and the player can be picked again", async () => {
    const d = await opened();
    const first = await d.onClock();
    expect((await d.pick(first.phone, d.players[3])).status).toBe(200);
    expect((await d.undo(d.dana)).status).toBe(200);
    expect((await d.teams()).every((t) => t.players.length === 0)).toBe(true);
    // Nothing left to undo
    const nothing = await d.undo(d.dana);
    expect(nothing.status).toBe(409);
    expect(nothing.body.error).toBe("Nobody's been picked yet.");
    expect((await d.onClock()).team.id).toBe(first.team.id);
    expect((await d.pick(first.phone, d.players[3], 0)).status).toBe(200);
  });

  it("the last player picked: the pool's empty, another pick is refused, and it closes without leaving anyone out", async () => {
    const d = await opened({ signed: 4 });
    for (const p of d.players.slice(0, 4)) {
      const { phone } = await d.onClock();
      expect((await d.pick(phone, p)).status).toBe(200);
    }
    const { phone } = await d.onClock();
    // Olly never signed up; everyone else is picked
    expect((await d.pick(phone, d.idOf("Olly Outsider"))).status).toBe(409);
    expect((await d.step(d.dana, "close")).status).toBe(200);
    expect((await d.teams()).map((t) => t.players.length)).toEqual([2, 2]);
  });

  it("a pick says its turn: the turn as it is goes in; one behind or ahead is refused; one that isn't a count is a 400", async () => {
    const d = await opened();
    const first = await d.onClock();
    expect((await d.pick(first.phone, d.players[1], 1)).status).toBe(409);
    expect((await d.pick(first.phone, d.players[1], 0)).status).toBe(200);
    const next = await d.onClock();
    const stale = await d.pick(next.phone, d.players[2], 0);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("Someone just picked: have another look.");
    for (const bad of [-1, 1.5, "1", null, true])
      expect((await d.pick(next.phone, d.players[2], bad)).status, String(bad)).toBe(400);
    expect((await d.pick(next.phone, d.players[2], 1)).status).toBe(200);
  });

  it("a pick names a member: none, not a number, or nobody at all is refused, and the turn doesn't move", async () => {
    const d = await opened();
    const first = await d.onClock();
    for (const bad of [undefined, "", "abc", 0, -3, 2.5]) expect((await d.pick(first.phone, bad)).status).toBe(400);
    expect((await d.pick(first.phone, 99_999)).status).toBe(409);
    expect((await d.onClock()).team.id).toBe(first.team.id);
  });

  it("nobody who said they're out, or never signed up, can be picked, by a captain or whoever runs it", async () => {
    const d = await draftNight();
    expect(
      (await d.playerPhones[6].call("POST", `/api/tournaments/${d.id}/answer`, { answer: "out" }, at)).status,
    ).toBe(200);
    expect((await d.step(d.dana, "draw")).status).toBe(200);
    expect((await d.step(d.dana, "open")).status).toBe(200);
    const { phone } = await d.onClock();
    for (const who of [phone, d.dana]) {
      expect((await d.pick(who, d.players[6])).status).toBe(409);
      expect((await d.pick(who, d.idOf("Olly Outsider"))).status).toBe(409);
    }
  });
});

describe("who runs which step (ADR 0024: run:Draft runs it, pick:Draft is the captain on the clock)", () => {
  it("not signed in: every step of the draft is refused", async () => {
    const d = await opened();
    const stranger = w.browser();
    for (const what of ["draw", "open", "close", "reset"])
      expect((await stranger.call("POST", `/api/tournaments/${d.id}/draft/${what}`, {}, at)).status).toBe(401);
    expect(
      (await stranger.call("POST", `/api/tournaments/${d.id}/draft/picks`, { memberId: d.players[0] }, at)).status,
    ).toBe(401);
    expect((await stranger.call("DELETE", `/api/tournaments/${d.id}/draft/picks/last`, undefined, at)).status).toBe(
      401,
    );
  });

  it("a member who isn't a captain can't draw, open, close, reset, undo or pick", async () => {
    const d = await draftNight();
    const reg = d.playerPhones[0];
    for (const what of ["draw", "open", "close", "reset"] as const) expect((await d.step(reg, what)).status).toBe(403);
    expect((await d.step(d.dana, "draw")).status).toBe(200);
    expect((await d.step(d.dana, "open")).status).toBe(200);
    expect((await d.pick(reg, d.players[1])).status).toBe(403);
    expect((await d.undo(reg)).status).toBe(403);
    expect((await d.tournament()).draftState).toBe("open");
  });

  it("a captain picks only on their own turn and runs nothing: no draw, open, close, reset or Undo", async () => {
    const d = await draftNight();
    for (const c of d.captainPhones)
      for (const what of ["draw", "open", "close", "reset"] as const) expect((await d.step(c, what)).status).toBe(403);
    expect((await d.step(d.dana, "draw")).status).toBe(200);
    expect((await d.step(d.dana, "open")).status).toBe(200);
    const { phone } = await d.onClock();
    expect((await d.pick(phone, d.players[1])).status).toBe(200);
    for (const c of d.captainPhones) expect((await d.undo(c)).status).toBe(403);
  });

  it("someone given only run:Draft runs the night, picking for the captain, but can't edit the teams or delete it", async () => {
    const d = await draftNight();
    const rae = await draftRunner(d.dana);
    expect((await d.step(rae, "draw")).status).toBe(200);
    expect((await d.step(rae, "open")).status).toBe(200);
    expect((await d.pick(rae, d.players[1], 0)).status).toBe(200);
    expect((await d.undo(rae)).status).toBe(200);
    expect((await d.pick(rae, d.players[2], 0)).status).toBe(200);
    expect((await d.step(rae, "close", { leaveOut: true })).status).toBe(200);
    // Teams and the tournament are manage:Tournament's
    const [team] = await d.teams();
    expect(
      (await rae.call("POST", `/api/tournaments/${d.id}/teams/${team.id}/players`, { memberId: d.players[3] }, at))
        .status,
    ).toBe(403);
    expect((await rae.call("DELETE", `/api/tournaments/${d.id}`, undefined, at)).status).toBe(403);
    expect((await d.step(rae, "reset")).status).toBe(200);
    expect((await d.tournament()).draftState).toBe("scheduled");
  });
});

describe("someone leaves mid-draft", () => {
  /** Two captains, three picks made (the first captain, then the second's two): the first captain's on the clock. */
  async function threePicks() {
    const d = await opened();
    const picked: number[] = [];
    for (const p of d.players.slice(1, 4)) {
      const { phone } = await d.onClock();
      expect((await d.pick(phone, p)).status).toBe(200);
      picked.push(p);
    }
    const [first, second] = await d.teams();
    expect(first.players).toEqual([picked[0]]);
    expect(second.players).toEqual([picked[1], picked[2]]);
    expect((await d.onClock()).team.id).toBe(first.id);
    return { ...d, first, second, picked };
  }

  // The turn follows the pick numbers, not how many picks there are (#125): the first pick saying they're out leaves
  // pick 1 empty, and its captain fills it before the draft goes on.
  it("the first captain's only pick says they're out: the first captain, now with nobody, is on the clock to fill it (#125)", async () => {
    const d = await threePicks();
    const leaver = d.playerPhones[d.players.indexOf(d.picked[0])];
    expect((await leaver.call("POST", `/api/tournaments/${d.id}/answer`, { answer: "out" }, at)).status).toBe(200);
    expect((await d.teams())[0].players).toEqual([]);
    // The second captain, with two already, can't take a third before the first has one; the first picks
    const secondPhone = d.captainPhones[d.captainIds.indexOf(d.second.captain)];
    const firstPhone = d.captainPhones[d.captainIds.indexOf(d.first.captain)];
    expect((await d.pick(secondPhone, d.players[4])).status).toBe(409);
    // The pick says its turn as the page sees it: pick 1's, the empty one
    expect((await d.pick(firstPhone, d.players[4], 0)).status).toBe(200);
    const numbers = rows(
      `SELECT p.member_id m, p.pick_number n FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
         WHERE t.tournament_id = ? ORDER BY p.pick_number`,
      d.id,
    );
    expect(numbers).toEqual([
      { m: d.players[4], n: 1 },
      { m: d.picked[1], n: 2 },
      { m: d.picked[2], n: 3 },
    ]);
    // Then on in snake order from pick 4: the first captain's again
    expect((await d.pick(secondPhone, d.players[5])).status).toBe(409);
    expect((await d.pick(firstPhone, d.players[5], 3)).status).toBe(200);
    expect((await d.teams()).map((t) => t.players.length)).toEqual([2, 2]);
  });

  it("the last pick says they're out: it's as if Undo, and the captain who lost them picks again", async () => {
    const d = await threePicks();
    // Undo then pick again, so the second captain's two are the latest: the last of them says out
    const leaver = d.playerPhones[d.players.indexOf(d.picked[2])];
    expect((await leaver.call("POST", `/api/tournaments/${d.id}/answer`, { answer: "out" }, at)).status).toBe(200);
    expect((await d.onClock()).team.id).toBe(d.second.id);
    const secondPhone = d.captainPhones[d.captainIds.indexOf(d.second.captain)];
    expect((await d.pick(secondPhone, d.players[4])).status).toBe(200);
    expect((await d.teams()).map((t) => t.players.length)).toEqual([1, 2]);
  });

  it("after someone's left, Undo takes the latest pick back, not the one before it", async () => {
    const d = await threePicks();
    const leaver = d.playerPhones[d.players.indexOf(d.picked[1])];
    expect((await leaver.call("POST", `/api/tournaments/${d.id}/answer`, { answer: "out" }, at)).status).toBe(200);
    expect((await d.undo(d.dana)).status).toBe(200);
    expect((await d.teams()).map((t) => t.players)).toEqual([[d.picked[0]], []]);
  });

  it("a player who said out and comes back in is back in the pool, and can be picked again", async () => {
    const d = await threePicks();
    const leaver = d.playerPhones[d.players.indexOf(d.picked[2])];
    expect((await leaver.call("POST", `/api/tournaments/${d.id}/answer`, { answer: "out" }, at)).status).toBe(200);
    expect((await leaver.call("POST", `/api/tournaments/${d.id}/answer`, { answer: "in" }, at)).status).toBe(200);
    const { phone } = await d.onClock();
    expect((await d.pick(phone, d.picked[2])).status).toBe(200);
  });
});

describe("deleting what the draft made", () => {
  it("an admin deletes a tournament mid-draft: its teams, picks and sign-ups go, and a pick for it after is a 404", async () => {
    const d = await opened();
    const { phone } = await d.onClock();
    expect((await d.pick(phone, d.players[1])).status).toBe(200);
    expect((await d.dana.call("DELETE", `/api/tournaments/${d.id}`, undefined, at)).status).toBe(200);
    expect(await d.tournament()).toBeUndefined();
    for (const table of ["tournament_teams", "tournament_entries"])
      expect(rows(`SELECT 1 FROM ${table} WHERE tournament_id = ?`, d.id)).toEqual([]);
    expect(rows("SELECT 1 FROM tournament_team_players")).toEqual([]);
    expect((await d.pick(phone, d.players[2])).status).toBe(404);
    // Deleting it again: nothing there
    expect((await d.dana.call("DELETE", `/api/tournaments/${d.id}`, undefined, at)).status).toBe(404);
  });

  it("once the draft has started, a save that drops a team with picks on it is refused, and the picks stay", async () => {
    const d = await opened();
    const { phone } = await d.onClock();
    expect((await d.pick(phone, d.players[1])).status).toBe(200);
    expect((await d.step(d.dana, "close", { leaveOut: true })).status).toBe(200);
    const t = await d.tournament();
    const res = await d.dana.call("PUT", `/api/tournaments/${d.id}`, { ...t, teams: [t.teams[1]] }, at);
    expect(res.status).toBe(409);
    expect((await d.teams()).flatMap((x) => x.players)).toEqual([d.players[1]]);
  });

  it("an admin deletes a tournament someone has paid for: what they paid comes back as their credit", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await w.signedIn("p2@example.com");
    const day = new Date("2026-10-10T11:00:00Z");
    const t = await dana.call("POST", "/api/tournaments", {
      name: "Autumn Cup",
      heldOn: "2026-10-10",
      startTime: "11:00",
      endTime: "17:00",
      status: "open",
      feePence: 1500,
    });
    expect(t.status).toBe(201);
    expect((await reg.call("POST", `/api/tournaments/${t.body.id}/answer`, { answer: "in" })).status).toBe(200);
    await chargeDue(w.env, day);
    const boot = async () => (await dana.call("GET", "/api/bootstrap", undefined, { now: day })).body as Json;
    const regId = (await boot()).members.find((m: Json) => m.name === "Player 2").id;
    const charge = (await boot()).charges.find((c: Json) => c.memberId === regId && c.kind === "tournament");
    expect(charge).toMatchObject({ pence: 1500 });
    expect(
      (await dana.call("POST", `/api/members/${regId}/payments`, { via: "cash", pence: 1500 }, { now: day })).status,
    ).toBe(200);
    expect((await boot()).credits).toEqual([]);

    expect((await dana.call("DELETE", `/api/tournaments/${t.body.id}`, undefined, { now: day })).status).toBe(200);
    const after = await boot();
    expect(after.charges.filter((c: Json) => c.memberId === regId)).toEqual([]);
    expect(after.credits).toEqual([{ memberId: regId, pence: 1500 }]);
  });
});

describe("taps at once on a reset (ADR 0121)", () => {
  // A reset takes the picks off, then sets the draft back to not open, then takes the order away: three statements.
  // A pick that read the draft open before the reset and lands between them would outlive the reset
  const leftOnTeams = (id: number) =>
    rows(
      `SELECT p.member_id FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
       WHERE t.tournament_id = ?`,
      id,
    );

  it.each(seeds(5))("a reset racing a later pick: once reset, no pick is left on a team (seed %i)", async (seed) => {
    const d = await opened({ seed });
    const first = await d.onClock();
    expect((await d.pick(first.phone, d.players[1])).status).toBe(200);
    const next = await d.onClock();
    w.db.interleave(seed);
    const [reset] = await Promise.all([d.step(d.dana, "reset"), d.pick(next.phone, d.players[2], 1)]);
    expect(reset.status).toBe(200);
    expect((await d.tournament()).draftState).toBe("scheduled");
    expect(leftOnTeams(d.id)).toEqual([]);
  });

  // Seeds 2, 3 and 4 found it (#126): the pick landed between the reset's statements, which are one batch now, the
  // draft closed to picks first
  it.each([2, 3, 4])("a reset racing the first pick: once reset, no pick is left on a team (seed %i)", async (seed) => {
    const d = await opened({ seed });
    const first = await d.onClock();
    w.db.interleave(seed);
    const [reset] = await Promise.all([d.step(d.dana, "reset"), d.pick(first.phone, d.players[1], 0)]);
    expect(reset.status).toBe(200);
    expect((await d.tournament()).draftState).toBe("scheduled");
    expect(leftOnTeams(d.id)).toEqual([]);
  });
});
