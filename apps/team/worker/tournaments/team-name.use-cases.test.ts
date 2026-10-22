// A captain carries their team name from one Kumite to the next (ADR 0060, team-name.ts): driven through the real
// Worker handlers in the fake world (testing.ts).
//
// The user: "A team captain usually carries a team name with them. If I was in a Kumite and set my team name, I want
// that to be my default team name next time." It's one field on the member, their default Kumite team name: theirs on
// their profile, an admin's in their editor, overwritten whenever their Kumite team's renamed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
/** The Kumite, as the club seed has it. */
const KUMITE = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

async function person(email: string) {
  const b = await w.signedIn(email);
  const sees = async () => (await b.call("GET", "/api/bootstrap")).body as Json;
  const member = async (name: string) => (await sees()).members.find((m: Json) => m.name === name);
  return { call: b.call, sees, member };
}

async function admin() {
  const p = await person("dana@example.com");
  return {
    ...p,
    /** A tournament in a series (the Kumite unless said), its captains named, their teams left unnamed. */
    async schedule(captains: number[], heldOn: string, typeId = KUMITE) {
      const res = await p.call("POST", "/api/tournaments", {
        typeId,
        name: `Kumite ${heldOn}`,
        heldOn,
        status: "planned",
        teams: captains.map((captainMemberId) => ({ name: "", logo: null, captainMemberId, players: [] })),
      });
      expect(res.status).toBe(201);
      return res.body.id as number;
    },
    /** Its teams' names, by captain. */
    async teamNames(id: number) {
      const t = (await p.sees()).tournaments.find((x: Json) => x.id === id);
      return Object.fromEntries(t.teams.map((x: Json) => [x.captainMemberId, x.name]));
    },
    async teamOf(id: number, captain: number) {
      const t = (await p.sees()).tournaments.find((x: Json) => x.id === id);
      return t.teams.find((x: Json) => x.captainMemberId === captain).id as number;
    },
  };
}

const rename = (as: { call: (...a: Json[]) => Promise<Json> }, id: number, teamId: number, name: string) =>
  as.call("PUT", `/api/tournaments/${id}/teams/${teamId}/look`, { name, logo: null });

async function cast() {
  const dana = await admin();
  const cara = (await dana.member("Cara Captain")).id as number;
  const cole = (await dana.member("Cole Captain")).id as number;
  const reg = (await dana.member("Reg Player")).id as number;
  return { dana, cara, cole, reg };
}

describe("a captain carries their team name to the next Kumite", () => {
  it('a captain who renamed their team "Dux\'s Disciples" last Kumite gets it by default this Kumite', async () => {
    const { dana, cara, cole } = await cast();
    const last = await dana.schedule([cara, cole], "2026-11-06");
    const caraP = await person("cara@example.com");
    expect((await rename(caraP, last, await dana.teamOf(last, cara), "Dux's Disciples")).status).toBe(200);
    // On her profile now, for next time
    expect((await caraP.member("Cara Captain")).kumiteTeamName).toBe("Dux's Disciples");

    const next = await dana.schedule([cara, cole], "2026-12-04");
    expect(await dana.teamNames(next)).toEqual({ [cara]: "Dux's Disciples", [cole]: "" });
    // She can still rename it, and the new name is what carries
    expect((await rename(caraP, next, await dana.teamOf(next, cara), "Kumite Kings")).status).toBe(200);
    expect((await caraP.member("Cara Captain")).kumiteTeamName).toBe("Kumite Kings");
    expect((await dana.teamNames(await dana.schedule([cara, cole], "2027-01-08")))[cara]).toBe("Kumite Kings");
  });

  it('a captain who never renamed theirs gets the automatic "Team <name>" (an empty name)', async () => {
    const { dana, cara, cole } = await cast();
    await dana.schedule([cara, cole], "2026-11-06");
    const next = await dana.schedule([cara, cole], "2026-12-04");
    expect(await dana.teamNames(next)).toEqual({ [cara]: "", [cole]: "" });
  });

  it("a member sets their default Kumite team name on their profile, and their next team takes it", async () => {
    const { dana, reg, cole } = await cast();
    const regP = await person("reg@example.com");
    expect(
      (await regP.call("PUT", "/api/me", { position: "F", phone: "", bio: "", kumiteTeamName: "  Reg's   Rockets " }))
        .status,
    ).toBe(200);
    expect((await regP.member("Reg Player")).kumiteTeamName).toBe("Reg's   Rockets");
    // A profile save that leaves it out keeps it
    await regP.call("PUT", "/api/me", { position: "F", phone: "", bio: "Fast" });
    expect((await regP.member("Reg Player")).kumiteTeamName).toBe("Reg's   Rockets");
    // Too long for a team name: refused, as a team's look is
    expect((await regP.call("PUT", "/api/me", { position: "F", kumiteTeamName: "x".repeat(41) })).status).toBe(400);
    const id = await dana.schedule([reg, cole], "2026-12-04");
    expect((await dana.teamNames(id))[reg]).toBe("Reg's   Rockets");
  });

  it("an admin sets it for a member in their editor; a member can't for someone else", async () => {
    const { dana, cole, cara } = await cast();
    const coleRow = await dana.member("Cole Captain");
    expect(
      (await dana.call("PUT", `/api/members/${cole}`, { ...coleRow, roles: ["Member"], kumiteTeamName: "Cole Train" }))
        .status,
    ).toBe(200);
    expect((await dana.member("Cole Captain")).kumiteTeamName).toBe("Cole Train");
    const regP = await person("reg@example.com");
    expect(
      (await regP.call("PUT", `/api/members/${cole}`, { ...coleRow, roles: ["Member"], kumiteTeamName: "Losers" }))
        .status,
    ).toBe(403);
    // Only your own is yours to see
    expect((await regP.member("Cole Captain")).kumiteTeamName).toBeNull();
    const id = await dana.schedule([cara, cole], "2026-12-04");
    expect((await dana.teamNames(id))[cole]).toBe("Cole Train");
  });

  it("an admin renaming a Kumite team in the tournament's editor changes what its captain carries", async () => {
    const { dana, cara, cole } = await cast();
    const id = await dana.schedule([cara, cole], "2026-11-06");
    const t = (await dana.sees()).tournaments.find((x: Json) => x.id === id);
    const teams = t.teams.map((x: Json) => ({ ...x, name: x.captainMemberId === cole ? "Cole's Crew" : x.name }));
    expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...t, teams })).status).toBe(200);
    expect((await dana.member("Cole Captain")).kumiteTeamName).toBe("Cole's Crew");
    // Cara's, saved unchanged, is still her team's automatic name
    expect((await dana.member("Cara Captain")).kumiteTeamName).toBe("");
    expect(w.db.raw.prepare("SELECT kumite_team_name n FROM members WHERE id = ?").get(cara)).toEqual({ n: null });
  });

  it("two captains carrying the same name: the first named keeps it, the other has the automatic name", async () => {
    const { dana, cara, cole, reg } = await cast();
    for (const [m, name] of [
      [cara, "Dux's Disciples"],
      [cole, "DUX'S DISCIPLES"],
    ] as const) {
      const row = await dana.member(m === cara ? "Cara Captain" : "Cole Captain");
      await dana.call("PUT", `/api/members/${m}`, { ...row, roles: ["Member"], kumiteTeamName: name });
    }
    const id = await dana.schedule([cole, cara, reg], "2026-12-04");
    expect(await dana.teamNames(id)).toEqual({ [cole]: "DUX'S DISCIPLES", [cara]: "", [reg]: "" });
    // The automatic name isn't a rename: Cara still carries hers
    expect((await dana.member("Cara Captain")).kumiteTeamName).toBe("Dux's Disciples");
  });

  it("captains from before the field keep their latest Kumite team's name: it's read from their history", async () => {
    const { dana, cara, cole } = await cast();
    const older = await dana.schedule([cara, cole], "2026-09-04");
    const last = await dana.schedule([cara, cole], "2026-10-02");
    w.db.raw
      .prepare("UPDATE tournament_teams SET name = ? WHERE tournament_id = ? AND captain_member_id = ?")
      .run("Old Name", older, cara);
    w.db.raw
      .prepare("UPDATE tournament_teams SET name = ? WHERE tournament_id = ? AND captain_member_id = ?")
      .run("Dux's Disciples", last, cara);
    expect(w.db.raw.prepare("SELECT kumite_team_name n FROM members WHERE id = ?").get(cara)).toEqual({ n: null });
    expect((await dana.member("Cara Captain")).kumiteTeamName).toBe("Dux's Disciples");
    const next = await dana.schedule([cara, cole], "2026-12-04");
    expect((await dana.teamNames(next))[cara]).toBe("Dux's Disciples");
  });

  it("an erased member's old names never carry", async () => {
    const { dana, cara, cole } = await cast();
    const last = await dana.schedule([cara, cole], "2026-11-06");
    const coleP = await person("cole@example.com");
    await rename(coleP, last, await dana.teamOf(last, cole), "Cole's Crew");
    expect((await coleP.call("DELETE", "/api/me")).status).toBe(200);
    expect(w.db.raw.prepare("SELECT kumite_team_name n FROM members WHERE id = ?").get(cole)).toEqual({ n: null });
    // Their latest team's still called it, but nothing reads it as theirs
    const next = await dana.schedule([cara, cole], "2026-12-04");
    expect((await dana.teamNames(next))[cole]).toBe("");
  });

  it("another series doesn't carry the Kumite's name, nor change it", async () => {
    const { dana, cara, cole } = await cast();
    const cup = await dana.call("POST", "/api/tournament-types", {
      name: "Summer Cup",
      shortName: "Cup",
      icon: "trophy",
      tone: "green",
      kind: "draft",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      gameMinutes: 12,
      active: true,
      defaultFeePence: 0,
      awards: [],
    });
    expect(cup.status).toBe(201);
    const caraP = await person("cara@example.com");
    const kumite = await dana.schedule([cara, cole], "2026-11-06");
    await rename(caraP, kumite, await dana.teamOf(kumite, cara), "Dux's Disciples");
    const cupDay = await dana.schedule([cara, cole], "2026-12-04", cup.body.id);
    expect((await dana.teamNames(cupDay))[cara]).toBe("");
    await rename(caraP, cupDay, await dana.teamOf(cupDay, cara), "Cup Crew");
    expect((await caraP.member("Cara Captain")).kumiteTeamName).toBe("Dux's Disciples");
  });
});
