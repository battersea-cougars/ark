// A past Kumite recorded (ADR 0126): the club played Kumites before the app, and an admin puts one in after the fact:
// its day, its teams, its matches with their scores (a final among them) and who scored where anyone remembers, and
// who won each award. It goes straight into history, done, its awards out, with nobody charged for it; the all-time
// leaders count the goals that have a scorer. A member who doesn't run tournaments can't. Driven through the real
// Worker handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { atAfters, championOf, editionState, playedOn } from "../../src/lib/edition";
import { londonEvening } from "../../src/lib/dates";
import { NOW, testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...["Ash", "Bo", "Cy", "Di", "Ed", "Flo", "Gus", "Hal", "Ivy"].map((name, i) => ({
    name: `${name} Player`,
    position: i === 1 || i === 5 ? "G" : "F",
    rating: 50,
    email: `${name.toLowerCase()}@example.com`,
  })),
];
const KUMITE = 1;

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
const rows = (sql: string, ...params: unknown[]) => w.db.raw.prepare(sql).all(...params) as Json[];

async function admin() {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === `${name} Player`).id as number;
  const tournament = async (id: number) =>
    ((await dana.call("GET", "/api/bootstrap")).body as Json).tournaments.find((t: Json) => t.id === id);
  return { dana, idOf, tournament };
}

/** Last spring's Kumite, as remembered: three teams, a round robin and a final, a few scorers, the awards. */
function lastSpring(idOf: (n: string) => number) {
  return {
    typeId: KUMITE,
    name: "Kumite Spring 2026",
    heldOn: "2026-04-17",
    teams: [
      { name: "Shidoshi", captainMemberId: idOf("Ash"), players: [idOf("Bo"), idOf("Cy")] },
      { name: "Dux", captainMemberId: idOf("Di"), players: [idOf("Ed"), idOf("Flo")] },
      { name: "Chong Li", captainMemberId: idOf("Gus"), players: [idOf("Hal"), idOf("Ivy")] },
    ],
    games: [
      { home: 0, away: 1, homeGoals: 2, awayGoals: 1, scorers: { home: [idOf("Ash"), idOf("Ash")], away: [] } },
      { home: 1, away: 2, homeGoals: 0, awayGoals: 0 },
      { home: 2, away: 0, homeGoals: 1, awayGoals: 3, scorers: { home: [idOf("Hal")], away: [idOf("Cy")] } },
      { home: 0, away: 2, homeGoals: 4, awayGoals: 2, final: true, scorers: { home: [idOf("Ash")] } },
    ],
    winners: [
      { award: "Champions", team: 0 },
      { award: "Top scorer", memberId: idOf("Ash") },
      { award: "Best keeper", memberId: idOf("Flo") },
      { award: "The Judges' Call", memberId: idOf("Ed"), title: "Most Dramatic Fall" },
    ],
  };
}

describe("an admin records a past Kumite", () => {
  it("it goes straight into history: done, champions, table, results, awards out, nobody charged", async () => {
    const a = await admin();
    const res = await a.dana.call("POST", "/api/tournaments/past", lastSpring(a.idOf));
    expect(res.status).toBe(201);
    const t = await a.tournament(res.body.id);

    // Done, on its own day, not at an after-party tonight: Past Kumites
    expect(editionState(t)).toBe("done");
    expect(playedOn(t)).toBe("2026-04-17");
    expect(atAfters(t, londonEvening(NOW))).toBe(false);
    expect(t.draftState).toBe("closed");

    // Its teams as named, with their captains and players, all in
    expect(t.teams.map((x: Json) => x.name)).toEqual(["Shidoshi", "Dux", "Chong Li"]);
    expect(t.teams[0].captainMemberId).toBe(a.idOf("Ash"));
    expect(t.teams[1].players.map((p: Json) => p.memberId)).toEqual([a.idOf("Ed"), a.idOf("Flo")]);
    expect(t.going).toHaveLength(9);

    // Every match done with its score, the final last; each score is its goals, scorers where said
    expect(t.games).toHaveLength(4);
    expect(t.games.every((g: Json) => g.status === "done")).toBe(true);
    for (const g of t.games) expect(g.goals).toHaveLength(g.homeGoals + g.awayGoals);
    expect(t.games[3]).toMatchObject({ stage: "playoff", name: "Final", homeGoals: 4, awayGoals: 2 });
    expect(t.games[0].goals.filter((x: Json) => x.scorerId === a.idOf("Ash"))).toHaveLength(2);
    expect(t.games[3].goals.filter((x: Json) => x.scorerId === null)).toHaveLength(5);
    expect(championOf(t)).toBe(t.teams[0].id);

    // The awards confirmed and every one out: it's history, no reveal left
    expect(t.winners).toHaveLength(4);
    expect(t.awardsRevealed).toBe(4);
    expect(t.awardsConfirmedAt).toBeTruthy();

    // Paid for at the time: no fee, no charges
    expect(t.feePence).toBe(0);
    expect(rows("SELECT COUNT(*) n FROM charges WHERE tournament_id = ?", t.id)[0].n).toBe(0);

    // On the record
    const [entry] = rows("SELECT detail FROM audit_log WHERE action = 'tournament.recorded'");
    expect(JSON.parse(entry.detail).to).toMatchObject({ teams: 3, games: 4, goals: 13, winners: 4 });
  });

  it("scores only: the all-time leaders count only the goals someone's named for", async () => {
    const a = await admin();
    const spring = lastSpring(a.idOf);
    const res = await a.dana.call("POST", "/api/tournaments/past", {
      ...spring,
      games: spring.games.map(({ scorers: _, ...g }) => g),
    });
    expect(res.status).toBe(201);
    const t = await a.tournament(res.body.id);
    const goals = t.games.flatMap((g: Json) => g.goals);
    expect(goals).toHaveLength(13);
    expect(goals.every((x: Json) => x.scorerId === null && x.atMs === null)).toBe(true);
  });

  it("refuses a day still to come, a final that ends level, a scorer on the other team, an award to someone who didn't play: nothing goes in", async () => {
    const a = await admin();
    const spring = lastSpring(a.idOf);
    const tries = [
      { ...spring, heldOn: "2026-10-06" },
      { ...spring, games: [{ home: 0, away: 1, homeGoals: 1, awayGoals: 1, final: true }] },
      { ...spring, games: [{ home: 0, away: 1, homeGoals: 1, awayGoals: 0, scorers: { home: [a.idOf("Ed")] } }] },
      { ...spring, winners: [{ award: "Top scorer", memberId: 99_999 }] },
      { ...spring, winners: [{ award: "Nobody's award", team: 0 }] },
    ];
    for (const body of tries) expect((await a.dana.call("POST", "/api/tournaments/past", body)).status).toBe(400);
    expect(rows("SELECT COUNT(*) n FROM tournaments WHERE name = 'Kumite Spring 2026'")[0].n).toBe(0);
  });

  it("a list holding a null, a number or a list where a team, match or winner goes is refused, not a server error", async () => {
    const a = await admin();
    const spring = lastSpring(a.idOf);
    for (const bad of [null, 1, "Shidoshi", []]) {
      for (const body of [
        { ...spring, teams: [bad, bad] },
        { ...spring, games: [bad] },
        { ...spring, winners: [bad] },
      ]) {
        const res = await a.dana.call("POST", "/api/tournaments/past", body);
        expect([res.status, typeof res.body.error]).toEqual([400, "string"]);
      }
    }
    expect(rows("SELECT COUNT(*) n FROM tournaments WHERE name = 'Kumite Spring 2026'")[0].n).toBe(0);
  });

  it("a member who doesn't run tournaments can't record one", async () => {
    const a = await admin();
    const ash = await w.signedIn("ash@example.com");
    const res = await ash.call("POST", "/api/tournaments/past", lastSpring(a.idOf));
    expect(res.status).toBe(403);
    expect(rows("SELECT COUNT(*) n FROM tournaments WHERE name = 'Kumite Spring 2026'")[0].n).toBe(0);
  });
});
