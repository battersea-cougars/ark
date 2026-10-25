// Status, not the date, says whether something is past, on or next (ADR 0074, #182). Seen on dev: a Kumite set for the
// 30th was played early; Home's feed still had it "on the 30th" while its page showed History. The rule (the user,
// 2026-10-25): done is past, whatever its date; live is on, even running late; not started, its time gone by, is
// still next until it's played, closed or cancelled. Here what the Worker sends and does by it, through the real
// handlers and the cron; how the app reads it is lib/phase.ts's, and the journeys'.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { londonISO } from "@cougars/shared/london";
import { testWorld } from "../testing";
import { currentOf } from "../../src/lib/edition";
import { tournamentPhase } from "../../src/lib/phase";
import type { Tournament } from "../../src/demo/model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "G", rating: 68, email: "cole@example.com" },
  { name: "Mo Member", position: "D", rating: 55, email: "mo@example.com" },
];
/** The Kumite series, as the club's seed has it. */
const KUMITE = 1;
/** London's wall clock as an instant. */
const at = (day: string, time: string) => new Date(londonISO(day, time));

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(() => vi.restoreAllMocks());

/** An admin puts on a Kumite on `heldOn`, Ants v Bees, its one match made; `play(when)` plays it, 3–1. */
async function kumiteOn(heldOn: string, extra: object = {}) {
  const dana = await w.signedIn("dana@example.com");
  const club = (await dana.club()).body as Json;
  const idOf = (name: string) => club.members.find((m: Json) => m.name === name).id as number;
  const made = await dana.call("POST", "/api/tournaments", {
    typeId: KUMITE,
    name: "Kumite Autumn 2026",
    heldOn,
    startTime: "19:30",
    endTime: "21:30",
    kind: "teams",
    playoffs: [],
    teams: [
      { name: "Ants", logo: null, captainMemberId: idOf("Cara Captain"), players: [] },
      { name: "Bees", logo: null, captainMemberId: idOf("Cole Captain"), players: [] },
    ],
    ...extra,
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
  /** The app's core as it opens at `now`: the bootstrap alone (#178). */
  const opening = async (now: Date) => (await dana.call("GET", "/api/bootstrap", undefined, { now })).body as Json;
  /** Played at `now`: the first match kicked off on the clock (so that evening's when it was played), then the results. */
  const play = async (now: Date) => {
    const t = (await opening(now)).tournaments.find((x: Json) => x.id === id);
    const first = `/api/tournaments/${id}/games/${t.games[0].id}`;
    expect((await dana.call("POST", `${first}/scorer`, { action: "claim" }, { now })).status).toBe(200);
    expect((await dana.call("POST", `${first}/clock`, { action: "start" }, { now })).status).toBe(200);
    for (const g of t.games) {
      const res = await dana.call(
        "PUT",
        `/api/tournaments/${id}/games/${g.id}`,
        { homeGoals: 3, awayGoals: 1 },
        { now },
      );
      expect(res.status).toBe(200);
    }
  };
  return { dana, id, opening, play };
}

describe("a Kumite played early, its day still ahead, is past", () => {
  // Set for Friday 16 October, played on Friday the 9th
  const DAY = "2026-10-16";
  const PLAYED = at("2026-10-09", "21:00");
  const MORNING = at("2026-10-10", "06:30");

  it("it reaches the app as it opens, played: at its after-party that evening, then History", async () => {
    const k = await kumiteOn(DAY);
    await k.play(PLAYED);
    const evening = (await k.opening(PLAYED)).tournaments as Tournament[];
    const t = evening.find((x) => x.id === k.id)!;
    expect(tournamentPhase(t)).toBe("past");
    // Its evening is its after-party (ADR 0129), not its date's
    expect(currentOf(evening, "2026-10-09")?.id).toBe(k.id);
    const morning = (await k.opening(MORNING)).tournaments as Tournament[];
    expect(tournamentPhase(morning.find((x) => x.id === k.id)!)).toBe("past");
    // From the morning the series' page is on its next one (the world's first Kumite, a season so far), not this
    expect(currentOf(morning, "2026-10-10")?.id).not.toBe(k.id);
  });

  it("its sign-up's opening day, coming after it was played, tells nobody", async () => {
    const mo = await w.signedIn("mo@example.com");
    expect((await mo.call("PUT", "/api/auth/device", { token: "token-mo", platform: "ios" })).status).toBe(200);
    const k = await kumiteOn(DAY, { status: "planned", signupOpensOn: "2026-10-12" });
    await k.play(PLAYED);
    await w.scheduled("*/5 * * * *", at("2026-10-12", "00:05"));
    expect(w.pushes.filter((p) => p.path.startsWith("/tournaments/"))).toEqual([]);
  });
});

describe("a Kumite whose time has gone by unplayed is still next", () => {
  it("its day is still on the agenda the app reads, for Home and the calendar, until it's played", async () => {
    const k = await kumiteOn("2026-10-07");
    const later = await k.opening(at("2026-10-09", "12:00"));
    expect(later.agenda.some((r: Json) => r.kind === "tournament" && r.sourceId === k.id)).toBe(true);
    expect(later.tournaments.some((t: Json) => t.id === k.id)).toBe(true);
  });

  it("played three weeks late, it still reaches the app at its after-party", async () => {
    const k = await kumiteOn("2026-10-07");
    const LATE = at("2026-10-30", "21:00");
    await k.play(LATE);
    const t = (await k.opening(LATE)).tournaments.find((x: Json) => x.id === k.id);
    expect(t).toBeDefined();
    expect(tournamentPhase(t)).toBe("past");
    expect(currentOf([t], "2026-10-30")?.id).toBe(k.id);
  });
});

describe("a training night is next until its register closes, not when its time is up", () => {
  // Friday 9 October's training, 19:30 to 21:30 (the club seed's Fridays)
  it("after midnight, till 06:00, last night is still on the agenda and among the nights the app opens with", async () => {
    const dana = await w.signedIn("dana@example.com");
    const open = async (now: Date) => (await dana.call("GET", "/api/bootstrap", undefined, { now })).body as Json;
    const friday = (body: Json) => ({
      agenda: body.agenda.some((r: Json) => r.source === "session" && r.day === "2026-10-09"),
      night: body.sessions.some((s: Json) => s.heldOn === "2026-10-09"),
    });
    expect(friday(await open(at("2026-10-09", "22:30")))).toEqual({ agenda: true, night: true });
    expect(friday(await open(at("2026-10-10", "01:00")))).toEqual({ agenda: true, night: true });
    expect(friday(await open(at("2026-10-10", "06:30")))).toEqual({ agenda: false, night: false });
  });
});
