// A captain brings their team to the next edition of a series (ADR 0060, team-name.ts): driven through the real
// Worker handlers in the fake world (testing.ts).
//
// The user (2026-10-23): "Once I set my team name, if I get chosen as captain again, that would be my team name again
// unless I change it." The Kumite is one club's series, so nothing about it lives on the member: a captain's new team
// is worked out from the last one they captained in an earlier edition of the same series, its name and logo.
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
/** A team's logo, as the browser sends it shrunk. */
const CREST = "data:image/png;base64,iVBORw0KGgo=";
const OTHER_CREST = "data:image/webp;base64,UklGRg==";

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
  const tournament = async (id: number) => (await p.sees()).tournaments.find((x: Json) => x.id === id);
  return {
    ...p,
    tournament,
    /** An edition of a series (the Kumite unless said), its captains named, their teams as given (unnamed unless). */
    async schedule(
      captains: (number | { captainMemberId: number; name?: string; logo?: string })[],
      heldOn: string,
      typeId = KUMITE,
    ) {
      const res = await p.call("POST", "/api/tournaments", {
        typeId,
        name: `Edition ${heldOn}`,
        heldOn,
        status: "planned",
        teams: captains.map((c) => ({
          name: "",
          logo: null,
          players: [],
          ...(typeof c === "number" ? { captainMemberId: c } : c),
        })),
      });
      expect(res.status).toBe(201);
      return res.body.id as number;
    },
    /** Its teams' names, by captain. */
    async teamNames(id: number) {
      const t = await tournament(id);
      return Object.fromEntries(t.teams.map((x: Json) => [x.captainMemberId, x.name]));
    },
    /** A captain's team there: its name and logo. */
    async look(id: number, captain: number) {
      const t = (await tournament(id)).teams.find((x: Json) => x.captainMemberId === captain);
      return { name: t.name, logo: t.logo };
    },
    async teamOf(id: number, captain: number) {
      const t = await tournament(id);
      return t.teams.find((x: Json) => x.captainMemberId === captain).id as number;
    },
  };
}

const rename = (
  as: { call: (...a: Json[]) => Promise<Json> },
  id: number,
  teamId: number,
  name: string,
  logo: string | null = null,
) => as.call("PUT", `/api/tournaments/${id}/teams/${teamId}/look`, { name, logo });

async function cast() {
  const dana = await admin();
  const cara = (await dana.member("Cara Captain")).id as number;
  const cole = (await dana.member("Cole Captain")).id as number;
  const reg = (await dana.member("Reg Player")).id as number;
  return { dana, cara, cole, reg };
}

describe("a captain brings their team to the next edition of the series", () => {
  it("captains in edition 2 start with the name and logo of their team in edition 1", async () => {
    const { dana, cara, cole } = await cast();
    const first = await dana.schedule([cara, cole], "2026-11-06");
    const caraP = await person("cara@example.com");
    expect((await rename(caraP, first, await dana.teamOf(first, cara), "Reacher Rounds", CREST)).status).toBe(200);

    const second = await dana.schedule([cara, cole], "2026-12-04");
    expect(await dana.look(second, cara)).toEqual({ name: "Reacher Rounds", logo: CREST });
    // Cole never named his: his is the automatic "Team Cole"
    expect(await dana.look(second, cole)).toEqual({ name: "", logo: null });
  });

  it("a rename in edition 2 changes only edition 2's team, and edition 3 brings the new one", async () => {
    const { dana, cara, cole } = await cast();
    const caraP = await person("cara@example.com");
    const first = await dana.schedule([cara, cole], "2026-11-06");
    await rename(caraP, first, await dana.teamOf(first, cara), "Dux's Disciples", CREST);
    const second = await dana.schedule([cara, cole], "2026-12-04");
    expect((await rename(caraP, second, await dana.teamOf(second, cara), "Kumite Kings", OTHER_CREST)).status).toBe(
      200,
    );
    // Edition 1 is history: still Dux's Disciples
    expect(await dana.look(first, cara)).toEqual({ name: "Dux's Disciples", logo: CREST });
    const third = await dana.schedule([cara, cole], "2027-01-08");
    expect(await dana.look(third, cara)).toEqual({ name: "Kumite Kings", logo: OTHER_CREST });
  });

  it("it's the last edition before this one, by its day: one scheduled earlier on the calendar brings the one before it", async () => {
    const { dana, cara, cole } = await cast();
    const caraP = await person("cara@example.com");
    const sept = await dana.schedule([cara, cole], "2026-09-04");
    await rename(caraP, sept, await dana.teamOf(sept, cara), "September Side");
    const dec = await dana.schedule([cara, cole], "2026-12-04");
    await rename(caraP, dec, await dana.teamOf(dec, cara), "December Side");
    // Added afterwards, but held between them
    const oct = await dana.schedule([cara, cole], "2026-10-02");
    expect((await dana.teamNames(oct))[cara]).toBe("September Side");
  });

  it("an admin renaming a team in the tournament's editor changes what its captain brings next time", async () => {
    const { dana, cara, cole } = await cast();
    const id = await dana.schedule([cara, cole], "2026-11-06");
    const t = await dana.tournament(id);
    const teams = t.teams.map((x: Json) => ({ ...x, name: x.captainMemberId === cole ? "Cole's Crew" : x.name }));
    expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...t, teams })).status).toBe(200);
    expect((await dana.teamNames(await dana.schedule([cara, cole], "2026-12-04")))[cole]).toBe("Cole's Crew");
  });

  it("another series doesn't bring the Kumite's team, and the Kumite doesn't bring the other's", async () => {
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
    await rename(caraP, kumite, await dana.teamOf(kumite, cara), "Dux's Disciples", CREST);
    const cupDay = await dana.schedule([cara, cole], "2026-12-04", cup.body.id);
    expect(await dana.look(cupDay, cara)).toEqual({ name: "", logo: null });
    await rename(caraP, cupDay, await dana.teamOf(cupDay, cara), "Cup Crew");
    // The Kumite after it still brings the Kumite's
    expect((await dana.teamNames(await dana.schedule([cara, cole], "2027-01-08")))[cara]).toBe("Dux's Disciples");
    // And the Cup's next brings the Cup's
    expect((await dana.teamNames(await dana.schedule([cara, cole], "2027-06-04", cup.body.id)))[cara]).toBe("Cup Crew");
  });

  it("a captain who has never captained in the series starts blank, even if they have played in it", async () => {
    const { dana, cara, cole, reg } = await cast();
    const caraP = await person("cara@example.com");
    const first = await dana.schedule([cara, cole], "2026-11-06");
    await rename(caraP, first, await dana.teamOf(first, cara), "Dux's Disciples");
    const second = await dana.schedule([reg, cole], "2026-12-04");
    expect(await dana.look(second, reg)).toEqual({ name: "", logo: null });
  });

  it("a name given for the new team wins over the one they'd bring, and keeps its own logo", async () => {
    const { dana, cara, cole } = await cast();
    const caraP = await person("cara@example.com");
    const first = await dana.schedule([cara, cole], "2026-11-06");
    await rename(caraP, first, await dana.teamOf(first, cara), "Dux's Disciples", CREST);
    const second = await dana.schedule([{ captainMemberId: cara, name: "Fresh Start" }, cole], "2026-12-04");
    expect(await dana.look(second, cara)).toEqual({ name: "Fresh Start", logo: null });
  });

  it("the member and their profile hold no team name anywhere", async () => {
    const { dana, cara, cole } = await cast();
    const caraP = await person("cara@example.com");
    const first = await dana.schedule([cara, cole], "2026-11-06");
    await rename(caraP, first, await dana.teamOf(first, cara), "Dux's Disciples");
    const columns = w.db.raw.prepare("SELECT name FROM pragma_table_info('members')").all() as { name: string }[];
    expect(columns.map((c) => c.name).filter((n) => /team/i.test(n))).toEqual([]);
    const me = await caraP.member("Cara Captain");
    expect(Object.keys(me).filter((k) => /team/i.test(k))).toEqual([]);
    // A profile save sending one changes nothing about the next team
    expect(
      (await caraP.call("PUT", "/api/me", { position: "F", phone: "", bio: "", kumiteTeamName: "Other" })).status,
    ).toBe(200);
    expect((await dana.teamNames(await dana.schedule([cara, cole], "2026-12-04")))[cara]).toBe("Dux's Disciples");
  });

  it("an admin's editor, still showing the teams as it sent them, saves again: the brought name and logo stay", async () => {
    const { dana, cara, cole } = await cast();
    const caraP = await person("cara@example.com");
    const first = await dana.schedule([cara, cole], "2026-11-06");
    await rename(caraP, first, await dana.teamOf(first, cara), "Dux's Disciples", CREST);
    // The editor as it was sent: the captains, no ids, no names, no logos
    const stale = [cara, cole].map((captainMemberId) => ({ name: "", logo: null, captainMemberId, players: [] }));
    const id = await dana.schedule([cara, cole], "2026-12-04");
    const t = await dana.tournament(id);
    expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...t, teams: stale })).status).toBe(200);
    expect(await dana.look(id, cara)).toEqual({ name: "Dux's Disciples", logo: CREST });
    expect(await dana.look(id, cole)).toEqual({ name: "", logo: null });
  });

  it('a brought name another captain goes by automatically ("Team Cara") gives way: its bringer has their own automatic name', async () => {
    const { dana, cara, cole, reg } = await cast();
    const coleP = await person("cole@example.com");
    const first = await dana.schedule([cole, reg], "2026-11-06");
    await rename(coleP, first, await dana.teamOf(first, cole), "team cara", CREST);
    const id = await dana.schedule([cole, cara], "2026-12-04");
    expect(await dana.look(id, cole)).toEqual({ name: "", logo: null });
    // Without Cara there, it's his (an edition between the two, so the one before it is still the one he named)
    expect(await dana.look(await dana.schedule([cole, reg], "2026-11-20"), cole)).toEqual({
      name: "team cara",
      logo: CREST,
    });
  });

  it("two captains bringing the same name: the first named keeps it, the other has the automatic name", async () => {
    const { dana, cara, cole, reg } = await cast();
    const first = await dana.schedule(
      [
        { captainMemberId: cara, name: "Dux's Disciples" },
        { captainMemberId: cole, name: "DUX'S DISCIPLES " },
      ],
      "2026-11-06",
    );
    expect((await dana.teamNames(first))[cole]).toBe("DUX'S DISCIPLES");
    const id = await dana.schedule([cole, cara, reg], "2026-12-04");
    expect(await dana.teamNames(id)).toEqual({ [cole]: "DUX'S DISCIPLES", [cara]: "", [reg]: "" });
  });

  it("an erased member's old teams never come back", async () => {
    const { dana, cara, cole } = await cast();
    const last = await dana.schedule([cara, cole], "2026-11-06");
    const coleP = await person("cole@example.com");
    await rename(coleP, last, await dana.teamOf(last, cole), "Cole's Crew", CREST);
    expect((await coleP.call("DELETE", "/api/me")).status).toBe(200);
    // Their old team's still called it, but nothing reads it as theirs
    const next = await dana.schedule([cara, cole], "2026-12-04");
    expect(await dana.look(next, cole)).toEqual({ name: "", logo: null });
  });
});
