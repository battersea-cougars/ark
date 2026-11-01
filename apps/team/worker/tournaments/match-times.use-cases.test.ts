// When things happen on the day (ADR 0130, ADR 0074): the tournament keeps the hours an admin set, however early or
// late its matches really start, and each match keeps when it actually kicked off (`startedAt`), set by the first
// Start of its clock and never moved by a later one, cleared when the match is put back to not played. Driven through
// the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
];
// NOW is 2026-10-06 11:00Z, 12:00 in London
const at = (minutes: number) => ({ now: new Date(NOW.getTime() + minutes * 60_000) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A two-team tournament set for 19:00 to 21:30 on a day, its fixtures made, Dana keeping score of the first match. */
async function evening(heldOn: string) {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.club()).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  const res = await dana.call("POST", "/api/tournaments", {
    name: "Evening Cup",
    location: "Battersea Park",
    heldOn,
    startTime: "19:00",
    endTime: "21:30",
    status: "planned",
    feePence: 0,
    kind: "teams",
    teams: [
      { name: "Ants", logo: null, captainMemberId: idOf("Cara Captain"), players: [] },
      { name: "Bees", logo: null, captainMemberId: idOf("Cole Captain"), players: [] },
    ],
  });
  expect(res.status).toBe(201);
  const id = res.body.id as number;
  expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
  const tournament = async () => ((await dana.club()).body as Json).tournaments.find((t: Json) => t.id === id);
  const first = (await tournament()).games[0];
  expect((await dana.call("POST", `/api/tournaments/${id}/games/${first.id}/scorer`, { action: "claim" })).status).toBe(
    200,
  );
  const clock = (action: string, when = at(0)) =>
    dana.call("POST", `/api/tournaments/${id}/games/${first.id}/clock`, { action }, when);
  const game = async () => (await tournament()).games.find((g: Json) => g.id === first.id);
  return { dana, id, tournament, clock, game };
}

describe("the tournament's own hours", () => {
  it("stay as set when its first match starts hours early, on its day", async () => {
    const k = await evening("2026-10-06");
    expect((await k.clock("start")).status).toBe(200);
    expect((await k.clock("end", at(12))).status).toBe(200);
    expect(await k.tournament()).toMatchObject({ heldOn: "2026-10-06", startTime: "19:00", endTime: "21:30" });
  });

  it("stay as set, day and all, when its first match is started on another day: the match just starts", async () => {
    const k = await evening("2026-10-30");
    expect((await k.clock("start")).status).toBe(200);
    expect((await k.game()).startedAt).toBe(NOW.toISOString());
    expect(await k.tournament()).toMatchObject({ heldOn: "2026-10-30", startTime: "19:00", endTime: "21:30" });
  });
});

describe("when a match actually started", () => {
  it("is nobody's guess until it kicks off, then the first Start of its clock", async () => {
    const k = await evening("2026-10-06");
    expect((await k.game()).startedAt).toBe(null);
    expect((await k.clock("start", at(3))).status).toBe(200);
    expect((await k.game()).startedAt).toBe(new Date(NOW.getTime() + 3 * 60_000).toISOString());
  });

  it("isn't moved by pausing and starting the clock again, nor by full time", async () => {
    const k = await evening("2026-10-06");
    await k.clock("start", at(3));
    expect((await k.clock("pause", at(5))).status).toBe(200);
    expect((await k.clock("start", at(8))).status).toBe(200);
    expect((await k.clock("end", at(20))).status).toBe(200);
    expect((await k.game()).startedAt).toBe(new Date(NOW.getTime() + 3 * 60_000).toISOString());
  });

  it("is forgotten when the results are stepped back, the match not played again", async () => {
    const k = await evening("2026-10-06");
    await k.clock("start", at(3));
    await k.clock("end", at(15));
    expect((await k.dana.call("POST", `/api/tournaments/${k.id}/step-back`, { from: "results" }, at(20))).status).toBe(
      200,
    );
    expect(await k.game()).toMatchObject({ status: "next", startedAt: null });
    // Started again, it's the new kick-off
    await k.dana.call("POST", `/api/tournaments/${k.id}/games/${(await k.game()).id}/scorer`, { action: "claim" });
    await k.clock("start", at(30));
    expect((await k.game()).startedAt).toBe(new Date(NOW.getTime() + 30 * 60_000).toISOString());
    expect(await k.tournament()).toMatchObject({ startTime: "19:00", endTime: "21:30" });
  });

  it("isn't made up for a result typed in by an admin", async () => {
    const k = await evening("2026-10-06");
    const g = await k.game();
    const res = await k.dana.call("PUT", `/api/tournaments/${k.id}/games/${g.id}`, { homeGoals: 2, awayGoals: 1 });
    expect(res.status).toBe(200);
    expect(await k.game()).toMatchObject({ status: "done", startedAt: null });
  });
});
