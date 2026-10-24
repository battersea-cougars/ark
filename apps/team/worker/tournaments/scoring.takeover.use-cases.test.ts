// An admin takes over a game's scoresheet (ADR 0130, #116): the scorekeeper's phone has died, or they've had to go,
// and the game's on. One tap frees the sheet and makes the admin the scorekeeper, from where the game is; or, for an
// admin who isn't at the rink, Free it, and anyone can take it on. The old scorekeeper's live page hears at once and
// its taps are refused from then on; two admins taking over at once leave one scorekeeper (ADR 0121). On the record.
// Driven through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Ash Admin", position: "F", rating: 65, email: "ash@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Captain", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Member", position: "G", rating: 55, email: "mo@example.com" },
];
const at = (minutes: number) => ({ now: new Date(NOW.getTime() + minutes * 60_000) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Phone = { call: Json };
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A three-team cup, its fixtures made, and Mo keeping score of the first game, on, with a goal in. */
async function moScoring() {
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
  const tournament = async (as: Phone = dana) =>
    ((await as.call("GET", "/api/bootstrap")).body as Json).tournaments.find((t: Json) => t.id === id);
  const t = await tournament();
  const [first, second] = t.games as Json[];
  const path = (gameId = first.id) => `/api/tournaments/${id}/games/${gameId}`;
  const mo = await w.signedIn("mo@example.com");
  expect((await mo.call("POST", `${path()}/scorer`, { action: "claim" }, at(0))).status).toBe(200);
  expect((await mo.call("POST", `${path()}/clock`, { action: "start" }, at(0))).status).toBe(200);
  const home = first.homeTeamId as number;
  expect((await mo.call("POST", `${path()}/goals`, { teamId: home }, at(2))).status).toBe(200);
  /** An admin's say over the scoresheet: take it over, or free it, from whoever their page saw holding it. */
  const admin = (who: Phone, action: "takeover" | "free", from: number | null, gameId = first.id, when = 3) =>
    who.call("POST", `${path(gameId)}/scorer/admin`, { action, from }, at(when));
  const keeper = () =>
    (w.db.raw.prepare("SELECT keeper_member_id k FROM tournament_games WHERE id = ?").get(first.id) as { k: number }).k;
  const row = () =>
    w.db.raw
      .prepare("SELECT status, home_goals home, clock_started_at started FROM tournament_games WHERE id = ?")
      .get(first.id) as { status: string; home: number; started: string | null };
  return { id, dana, mo, first, second, home, path, admin, keeper, row, idOf, tournament };
}

describe("an admin takes over a game's scoresheet", () => {
  it("Mo's phone has died: an admin takes over in one tap and carries on from where the game is", async () => {
    const g = await moScoring();
    expect((await g.admin(g.dana, "takeover", g.idOf("Mo Member"))).status).toBe(200);
    expect(g.keeper()).toBe(g.idOf("Dana Admin"));
    // The clock still running, the goal still in: Dana pauses it and logs the next
    expect(g.row()).toMatchObject({ status: "live", home: 1 });
    expect(g.row().started).not.toBeNull();
    expect((await g.dana.call("POST", `${g.path()}/clock`, { action: "pause" }, at(4))).status).toBe(200);
    expect((await g.dana.call("POST", `${g.path()}/goals`, { teamId: g.home }, at(5))).status).toBe(200);
    expect(g.row()).toMatchObject({ home: 2, started: null });
  });

  it("from then on, every tap from Mo's phone is refused: the clock, goals, penalties, Undo", async () => {
    const g = await moScoring();
    await g.admin(g.dana, "takeover", g.idOf("Mo Member"));
    for (const res of [
      await g.mo.call("POST", `${g.path()}/clock`, { action: "pause" }, at(4)),
      await g.mo.call("POST", `${g.path()}/clock`, { action: "set", leftMs: 60_000 }, at(4)),
      await g.mo.call("POST", `${g.path()}/clock`, { action: "end" }, at(4)),
      await g.mo.call("POST", `${g.path()}/goals`, { teamId: g.home }, at(4)),
      await g.mo.call("POST", `${g.path()}/penalties`, { teamId: g.home, infraction: "delay-of-game" }, at(4)),
      await g.mo.call("DELETE", `${g.path()}/goals/last`, undefined, at(4)),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Someone else/);
    }
    expect(g.row()).toMatchObject({ status: "live", home: 1 });
    // Nor can Mo take it back while Dana has it
    expect((await g.mo.call("POST", `${g.path()}/scorer`, { action: "claim" }, at(4))).status).toBe(409);
  });

  it("Mo's live page hears straight away, and says Dana has it", async () => {
    const g = await moScoring();
    const phone = await w.listening("mo@example.com");
    await g.admin(g.dana, "takeover", g.idOf("Mo Member"));
    expect((await phone.next()).data.changed).toContain("tournaments");
    const game = (await g.tournament(g.mo)).games.find((x: Json) => x.id === g.first.id);
    expect(game.keeperId).toBe(g.idOf("Dana Admin"));
    phone.close();
  });

  it("an admin who isn't at the rink frees it instead: nobody holds it, and anyone can take it on", async () => {
    const g = await moScoring();
    expect((await g.admin(g.dana, "free", g.idOf("Mo Member"))).status).toBe(200);
    expect(g.keeper()).toBeNull();
    expect((await g.mo.call("POST", `${g.path()}/goals`, { teamId: g.home }, at(4))).status).toBe(403);
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `${g.path()}/scorer`, { action: "claim" }, at(4))).status).toBe(200);
    expect((await reg.call("POST", `${g.path()}/goals`, { teamId: g.home }, at(5))).status).toBe(200);
    expect(g.row().home).toBe(2);
  });

  it("only an admin: a member can neither take over nor free someone else's sheet", async () => {
    const g = await moScoring();
    const reg = await w.signedIn("reg@example.com");
    expect((await g.admin(reg, "takeover", g.idOf("Mo Member"))).status).toBe(403);
    expect((await g.admin(reg, "free", g.idOf("Mo Member"))).status).toBe(403);
    expect(g.keeper()).toBe(g.idOf("Mo Member"));
  });

  it("the sheet changed hands since the admin's page saw it: they're told, and it stays with whoever has it now", async () => {
    const g = await moScoring();
    // Mo handed over and Reg took it on, but Dana's page still says Mo
    await g.mo.call("POST", `${g.path()}/scorer`, { action: "release" }, at(3));
    const reg = await w.signedIn("reg@example.com");
    await reg.call("POST", `${g.path()}/scorer`, { action: "claim" }, at(3));
    for (const action of ["takeover", "free"] as const) {
      const res = await g.admin(g.dana, action, g.idOf("Mo Member"));
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Reg/);
    }
    expect(g.keeper()).toBe(g.idOf("Reg Captain"));
  });

  it("nobody holding it, taking over is taking it on: for the game up next only", async () => {
    const g = await moScoring();
    await g.mo.call("POST", `${g.path()}/scorer`, { action: "release" }, at(3));
    expect((await g.admin(g.dana, "takeover", null, g.second.id)).status).toBe(409);
    expect((await g.admin(g.dana, "takeover", null)).status).toBe(200);
    expect(g.keeper()).toBe(g.idOf("Dana Admin"));
  });

  it("a game that's over has no scoresheet to take", async () => {
    const g = await moScoring();
    expect((await g.mo.call("POST", `${g.path()}/clock`, { action: "end" }, at(12))).status).toBe(200);
    const res = await g.admin(g.dana, "takeover", g.idOf("Mo Member"), g.first.id, 13);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/over/);
  });

  it("on the record: who took the sheet, or freed it, and from whom", async () => {
    const g = await moScoring();
    await g.admin(g.dana, "free", g.idOf("Mo Member"));
    await g.admin(g.dana, "takeover", null);
    const rows = w.db.raw
      .prepare("SELECT member_id who, detail FROM audit_log WHERE action = 'game.keeper_changed' ORDER BY id")
      .all() as { who: number; detail: string }[];
    expect(rows.map((r) => r.who)).toEqual([g.idOf("Dana Admin"), g.idOf("Dana Admin")]);
    expect(rows.map((r) => JSON.parse(r.detail))).toMatchObject([
      { from: { game: 1, keeper: "Mo Member" }, to: { game: 1, keeper: null } },
      { from: { game: 1, keeper: null }, to: { game: 1, keeper: "Dana Admin" } },
    ]);
  });
});

describe("taking over, taps at once (ADR 0121)", () => {
  it.each(seeds(5))("two admins taking over at once: one scorekeeper, the other told (seed %i)", async (seed) => {
    const g = await moScoring();
    const ash = await w.signedIn("ash@example.com");
    const mo = g.idOf("Mo Member");
    w.db.interleave(seed);
    const replies = await Promise.all([g.admin(g.dana, "takeover", mo), g.admin(ash, "takeover", mo)]);
    w.db.interleave(null);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    const won = replies[0].status === 200 ? g.idOf("Dana Admin") : g.idOf("Ash Admin");
    expect(g.keeper()).toBe(won);
  });

  it.each(seeds(5))(
    "Mo's last goal landing as an admin takes over: in before it, or refused (seed %i)",
    async (seed) => {
      const g = await moScoring();
      w.db.interleave(seed);
      const [scored, took] = await Promise.all([
        g.mo.call("POST", `${g.path()}/goals`, { teamId: g.home }, at(3)),
        g.admin(g.dana, "takeover", g.idOf("Mo Member")),
      ]);
      w.db.interleave(null);
      expect(took.status).toBe(200);
      expect([200, 403, 409]).toContain(scored.status);
      expect(g.row().home).toBe(scored.status === 200 ? 2 : 1);
    },
  );

  it.each(seeds(5))(
    "full time from Mo's phone as an admin takes over: one or the other first, never both (seed %i)",
    async (seed) => {
      const g = await moScoring();
      w.db.interleave(seed);
      const [ended, took] = await Promise.all([
        g.mo.call("POST", `${g.path()}/clock`, { action: "end" }, at(3)),
        g.admin(g.dana, "takeover", g.idOf("Mo Member")),
      ]);
      w.db.interleave(null);
      // Full time first: the game's over and there's nothing to take. The take-over first: Mo's whistle is refused
      expect([ended.status, took.status].sort()).toEqual([200, ended.status === 200 ? 409 : 403].sort());
      expect(g.row().status).toBe(ended.status === 200 ? "done" : "live");
    },
  );
});
