// A Kumite on a past day (ADR 0123), dev only: to try what a past Kumite shows, an admin has one played on a day gone
// by in a few taps. It's made on that day and signed up for, then the simulator plays it out on that evening (its
// clocks the evening's, not now): the draft drawn and picked, every match on the clock, the awards confirmed and
// every one revealed. So it's history at once (Past Kumites), with a whole evening behind it. Not there in production.
// Driven through the real Worker handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { awardsToReveal } from "../../src/lib/awards";
import { atAfters, editionState, playedOn } from "../../src/lib/edition";
import { londonEvening, londonISO } from "../../src/lib/dates";
import { MOST_MOVES } from "../../src/lib/simulation";
import { NOW, testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...Array.from({ length: 14 }, (_, i) => ({
    name: `Player ${i + 1}`,
    position: i < 3 ? "G" : i % 2 ? "F" : "D",
    rating: 50,
    email: `p${i + 1}@example.com`,
  })),
];
const KUMITE = 1;
/** A Friday gone by: NOW is Tuesday 6 October 2026. */
const DAY = "2026-09-25";

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  w.luck(3);
});
const rows = (sql: string, ...params: unknown[]) => w.db.raw.prepare(sql).all(...params) as Json[];

async function admin() {
  const dana = await w.signedIn("dana@example.com");
  const tournament = async (id: number) =>
    ((await dana.call("GET", "/api/bootstrap")).body as Json).tournaments.find((t: Json) => t.id === id);
  /** As the app does it at Spin kick: ask again till it says it's done. */
  const playOn = async (id: number) => {
    let most = 0;
    for (let i = 0; i < 500; i++) {
      const before = w.db.roundTrips;
      const res = await dana.call("POST", `/api/tournaments/${id}/simulate`, { moves: MOST_MOVES, onItsDay: true });
      most = Math.max(most, w.db.roundTrips - before);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      if (res.body.done) return { res, requests: i + 1, most };
    }
    throw new Error("It never finished.");
  };
  return { dana, tournament, playOn };
}

describe("a Kumite on a past day, on dev", () => {
  it("made, signed up for, and played out on that evening to its last award: history, with a whole evening behind it", async () => {
    const a = await admin();
    const made = await a.dana.call("POST", "/api/tournaments/past-day", { typeId: KUMITE, heldOn: DAY });
    expect(made.status).toBe(201);
    const id = made.body.id as number;
    // Signed up for in the fortnight before: four captains and enough for their teams
    const fresh = await a.tournament(id);
    expect(fresh.teams).toHaveLength(4);
    expect(fresh.going.length).toBeGreaterThanOrEqual(12);
    const signups = rows("SELECT signed_up_at at FROM tournament_entries WHERE tournament_id = ?", id);
    for (const s of signups) expect(s.at < `${DAY}T12:00:00.000Z`).toBe(true);

    const { res, most } = await a.playOn(id);
    expect(res.body.said).toMatch(/Past Kumites/);
    // Each request well inside an invocation's 50 D1 queries
    expect(most).toBeLessThan(45);

    const t = await a.tournament(id);
    // The draft drawn, picked and closed; every match played
    expect(t.draftState).toBe("closed");
    expect(t.teams.flatMap((x: Json) => x.players)).not.toHaveLength(0);
    expect(t.games.length).toBeGreaterThan(0);
    expect(t.games.every((g: Json) => g.status === "done")).toBe(true);
    // Each on that evening's clock, one after another, from its start time
    const kickOffs = t.games.map((g: Json) => Date.parse(g.startedAt));
    expect([...kickOffs].sort((x, y) => x - y)).toEqual(kickOffs);
    expect(kickOffs[0]).toBeGreaterThanOrEqual(Date.parse(londonISO(DAY, t.startTime)));
    for (const k of kickOffs) expect(londonEvening(new Date(k))).toBe(DAY);
    for (const g of t.games) expect(g.goals).toHaveLength(g.homeGoals + g.awayGoals);
    // So it was played that evening, and it's history now, not at an after-party tonight
    expect(playedOn(t)).toBe(DAY);
    expect(editionState(t)).toBe("done");
    expect(atAfters(t, londonEvening(NOW))).toBe(false);
    // The awards confirmed that evening, every one with a winner and every one out
    expect(londonEvening(new Date(t.awardsConfirmedAt))).toBe(DAY);
    const given = [...new Set(t.winners.map((x: Json) => x.award))] as string[];
    expect(given.sort()).toEqual(t.awards.map((x: Json) => x.name).sort());
    expect(t.awardsRevealed).toBe(awardsToReveal(t.awards, given).length);
    // Asked again, there's nothing left
    const again = await a.dana.call("POST", `/api/tournaments/${id}/simulate`, { onItsDay: true });
    expect(again.body).toMatchObject({ done: true });
  });

  it("refuses a day that hasn't gone by, and won't play a Kumite on its day while that's to come", async () => {
    const a = await admin();
    for (const heldOn of ["2026-10-06", "2026-11-13"])
      expect((await a.dana.call("POST", "/api/tournaments/past-day", { typeId: KUMITE, heldOn })).status).toBe(400);
    const coming = rows("SELECT id FROM tournaments WHERE held_on >= '2026-10-06' LIMIT 1")[0];
    if (coming) {
      const res = await a.dana.call("POST", `/api/tournaments/${coming.id}/simulate`, { onItsDay: true });
      expect(res.status).toBe(409);
    }
  });

  it("in production it isn't there at all; a member who doesn't run tournaments is refused", async () => {
    const a = await admin();
    const member = await w.signedIn("p4@example.com");
    expect((await member.call("POST", "/api/tournaments/past-day", { typeId: KUMITE, heldOn: DAY })).status).toBe(403);
    w.env.SITE_ENV = "production";
    expect((await a.dana.call("POST", "/api/tournaments/past-day", { typeId: KUMITE, heldOn: DAY })).status).toBe(404);
    expect(rows("SELECT COUNT(*) n FROM tournaments WHERE held_on = ?", DAY)[0].n).toBe(0);
  });
});
