// A tournament's edges as an admin sets it up (ADR 0030, 0074): what the editor can send that the server must refuse
// (names too long or blank, dates that can't be, sign-up and draft days out of order, too many teams, someone on two
// teams), what it must keep exactly (names in any script, emoji), a series' slugs, and who may change a team's look.
// Driven through the real Worker handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

async function admin() {
  const dana = await w.signedIn("dana@example.com");
  const boot = async () => (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = async (name: string) => (await boot()).members.find((m: Json) => m.name === name).id as number;
  const cup = (o: Record<string, unknown> = {}) => ({
    name: "Winter Cup",
    heldOn: "2026-12-12",
    startTime: "11:00",
    endTime: "16:00",
    status: "planned",
    feePence: 1000,
    ...o,
  });
  const create = (o: Record<string, unknown> = {}) => dana.call("POST", "/api/tournaments", cup(o));
  const series = (o: Record<string, unknown> = {}) =>
    dana.call("POST", "/api/tournament-types", {
      name: "Kumite",
      shortName: "Kumite",
      icon: "trophy",
      tone: "red",
      kind: "draft",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      gameMinutes: 12,
      active: true,
      defaultFeePence: 0,
      awards: [],
      location: "",
      ...o,
    });
  const tournament = async (id: number) => (await boot()).tournaments.find((t: Json) => t.id === id);
  return { ...dana, boot, idOf, cup, create, series, tournament };
}

describe("an admin names a tournament", () => {
  it("a name in any script, with emoji, is kept exactly as typed, and shows the same for a member", async () => {
    const dana = await admin();
    const name = "Kumite 空手 · Zoë's 🥋 Cup";
    const res = await dana.create({ name });
    expect(res.status).toBe(201);
    expect((await dana.tournament(res.body.id)).name).toBe(name);
    const reg = await w.signedIn("reg@example.com");
    expect(
      (await reg.call("GET", "/api/bootstrap")).body.tournaments.find((t: Json) => t.id === res.body.id).name,
    ).toBe(name);
  });

  it("up to 80 characters; one more, no name, or a name that isn't text is refused, and nothing is made", async () => {
    const dana = await admin();
    expect((await dana.create({ name: "x".repeat(80) })).status).toBe(201);
    for (const name of ["x".repeat(81), "", 42, ["Cup"]]) expect((await dana.create({ name })).status).toBe(400);
    expect((await dana.boot()).tournaments).toHaveLength(2); // the seeded Kumite and the one of 80
  });

  it("spaces round a name are trimmed", async () => {
    const dana = await admin();
    const res = await dana.create({ name: "  Winter Cup  " });
    expect((await dana.tournament(res.body.id)).name).toBe("Winter Cup");
  });

  // A name of spaces passes the "is it there" check, then is trimmed to nothing and saved: a tournament with no
  // name. https://github.com/battersea-cougars/ark/issues/133
  it.fails("a name of only spaces is refused like no name at all (known bug #133)", async () => {
    const dana = await admin();
    expect((await dana.create({ name: "   " })).status).toBe(400);
  });
});

describe("an admin gives a tournament its days", () => {
  it("sign-up opens and closes on the day itself at the latest, and the draft is on the day or before", async () => {
    const dana = await admin();
    const day = "2026-12-12";
    expect((await dana.create({ signupOpensOn: day, signupClosesOn: day, draftOn: day, heldOn: day })).status).toBe(
      201,
    );
    const refused = [
      [{ signupOpensOn: "2026-12-13" }, "Sign-up has to open before the day."],
      [{ signupClosesOn: "2026-12-13" }, "Sign-up can't close after the day."],
      [{ signupOpensOn: "2026-12-05", signupClosesOn: "2026-12-04" }, "Sign-up can't close before it opens."],
      [{ draftOn: "2026-12-13" }, "The draft has to be before the day."],
    ] as const;
    for (const [o, error] of refused) {
      const res = await dana.create(o);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(error);
    }
  });

  it("a date that isn't a date, or a time that isn't one, is refused", async () => {
    const dana = await admin();
    for (const o of [
      { heldOn: "12/12/2026" },
      { heldOn: "2026-12-1" },
      { heldOn: null },
      { startTime: "11am" },
      { endTime: "4:00" },
      { signupOpensOn: "soon" },
    ])
      expect((await dana.create(o)).status, JSON.stringify(o)).toBe(400);
  });

  // The date and time checks look only at the shape (four digits, two, two), so 30 February and 25:99 go in, and the
  // calendar and the website get a day that isn't one. https://github.com/battersea-cougars/ark/issues/133
  it.fails(
    "a day that doesn't exist (30 February, month 13) or a time past 23:59 is refused (known bug #133)",
    async () => {
      const dana = await admin();
      for (const o of [{ heldOn: "2027-02-30" }, { heldOn: "2026-13-01" }, { startTime: "25:99" }])
        expect((await dana.create(o)).status, JSON.stringify(o)).toBe(400);
    },
  );

  it("29 February is a day in a leap year (2028), and just a season's date is its last day", async () => {
    const dana = await admin();
    expect((await dana.create({ heldOn: "2028-02-29" })).status).toBe(201);
    expect((await dana.create({ season: "summer", heldOn: "2027-08-31" })).status).toBe(201);
    const wrong = await dana.create({ season: "summer", heldOn: "2027-08-30" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("A season's date is its last day.");
    expect((await dana.create({ season: "monsoon" })).status).toBe(400);
  });

  it("room for 1 to 500, or no limit; a fee from nothing to £1,000, never less than nothing", async () => {
    const dana = await admin();
    for (const capacity of [1, 500, null]) expect((await dana.create({ capacity })).status).toBe(201);
    for (const capacity of [0, 501, 2.5, "10"]) expect((await dana.create({ capacity })).status).toBe(400);
    for (const feePence of [0, 100_000]) expect((await dana.create({ feePence })).status).toBe(201);
    for (const feePence of [-1, 100_001, 9.99]) expect((await dana.create({ feePence })).status).toBe(400);
  });
});

describe("an admin sets a tournament's teams", () => {
  it("up to 16 teams; a 17th is refused", async () => {
    const dana = await admin();
    const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Team ${i + 1}`, players: [] }));
    expect((await dana.create({ kind: "teams", teams: teams(16) })).status).toBe(201);
    const res = await dana.create({ kind: "teams", teams: teams(17) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Up to 16 teams.");
  });

  it("nobody captains two teams of a draft, and every team of a draft has a captain; nothing is made when refused", async () => {
    const dana = await admin();
    const cara = await dana.idOf("Cara Captain");
    const twice = await dana.create({ kind: "draft", teams: [{ captainMemberId: cara }, { captainMemberId: cara }] });
    expect(twice.status).toBe(400);
    expect(twice.body.error).toBe("Someone is on two teams.");
    const none = await dana.create({ kind: "draft", teams: [{ captainMemberId: cara }, { captainMemberId: null }] });
    expect(none.status).toBe(400);
    expect(none.body.error).toBe("In a draft, every team's captain is a member.");
    expect((await dana.boot()).tournaments.filter((t: Json) => t.name === "Winter Cup")).toEqual([]);
  });

  // The tournament goes in before its teams are checked against the members, so a refusal there leaves it behind,
  // with no teams. https://github.com/battersea-cougars/ark/issues/132
  it.fails("a create refused for a captain who isn't a member leaves nothing behind (known bug #132)", async () => {
    const dana = await admin();
    const cara = await dana.idOf("Cara Captain");
    const nobody = await dana.create({
      kind: "draft",
      teams: [{ captainMemberId: cara }, { captainMemberId: 99_999 }],
    });
    expect(nobody.status).toBe(400);
    expect(nobody.body.error).toBe("No such member.");
    expect((await dana.boot()).tournaments.filter((t: Json) => t.name === "Winter Cup")).toEqual([]);
  });

  it("a team that enters needs a name, of up to 40, and up to 30 players, nobody on two teams", async () => {
    const dana = await admin();
    const reg = await dana.idOf("Reg Player");
    expect((await dana.create({ kind: "teams", teams: [{ name: "" }] })).status).toBe(400);
    expect((await dana.create({ kind: "teams", teams: [{ name: "x".repeat(41) }] })).status).toBe(400);
    const players = (n: number) => Array.from({ length: n }, (_, i) => ({ memberId: null, name: `Guest ${i}` }));
    expect((await dana.create({ kind: "teams", teams: [{ name: "Full", players: players(30) }] })).status).toBe(201);
    expect((await dana.create({ kind: "teams", teams: [{ name: "Over", players: players(31) }] })).status).toBe(400);
    const two = await dana.create({
      kind: "teams",
      teams: [
        { name: "A", players: [{ memberId: reg }] },
        { name: "B", players: [{ memberId: reg }] },
      ],
    });
    expect(two.status).toBe(400);
    expect(two.body.error).toBe("Someone is on two teams.");
  });

  it("once its draft has started, a draft stays a draft; before, it can become one teams enter", async () => {
    const dana = await admin();
    const [cara, cole] = [await dana.idOf("Cara Captain"), await dana.idOf("Cole Captain")];
    const made = await dana.create({ kind: "draft", teams: [{ captainMemberId: cara }, { captainMemberId: cole }] });
    const id = made.body.id as number;
    // Not started yet: it can change, its teams named
    const before = await dana.tournament(id);
    const named = before.teams.map((t: Json, i: number) => ({ ...t, name: `Team ${i + 1}` }));
    expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...before, kind: "teams", teams: named })).status).toBe(
      200,
    );
    expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...before, kind: "draft", teams: named })).status).toBe(
      200,
    );
    // Drawn: still not started. Opened: it stays a draft
    expect((await dana.call("POST", `/api/tournaments/${id}/draft/draw`, {})).status).toBe(200);
    w.db.raw.prepare("UPDATE tournaments SET draft_state = 'open' WHERE id = ?").run(id);
    const res = await dana.call("PUT", `/api/tournaments/${id}`, { ...(await dana.tournament(id)), kind: "teams" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("The draft has started: it stays a draft.");
  });

  it("a change to a tournament that isn't there is a 404", async () => {
    const dana = await admin();
    expect((await dana.call("PUT", "/api/tournaments/9999", dana.cup())).status).toBe(404);
  });
});

describe("a team's look", () => {
  async function drafted() {
    const dana = await admin();
    const [cara, cole] = [await dana.idOf("Cara Captain"), await dana.idOf("Cole Captain")];
    const made = await dana.create({ kind: "draft", teams: [{ captainMemberId: cara }, { captainMemberId: cole }] });
    const id = made.body.id as number;
    const teamIds = (await dana.tournament(id)).teams.map((t: Json) => t.id) as number[];
    const look = (as: { call: typeof dana.call }, team: number, o: object, tournament = id) =>
      as.call("PUT", `/api/tournaments/${tournament}/teams/${team}/look`, o);
    return { dana, id, teamIds, look };
  }

  it("a captain names their team in any script, up to 40; longer is refused; blank goes back to its captain's name", async () => {
    const { dana, id, teamIds, look } = await drafted();
    const cara = await w.signedIn("cara@example.com");
    expect((await look(cara, teamIds[0], { name: "猫 Cats 🐾" })).status).toBe(200);
    expect((await dana.tournament(id)).teams[0].name).toBe("猫 Cats 🐾");
    expect((await look(cara, teamIds[0], { name: "x".repeat(41) })).status).toBe(400);
    expect((await look(cara, teamIds[0], { name: "" })).status).toBe(200);
    expect((await dana.tournament(id)).teams[0].name).toBe("");
  });

  it("a team of another tournament, or none, is a 404, for its captain and an admin alike", async () => {
    const { dana, teamIds, look } = await drafted();
    const cara = await w.signedIn("cara@example.com");
    const other = await dana.create({ name: "Other Cup" });
    expect((await look(cara, teamIds[0], { name: "X" }, other.body.id)).status).toBe(404);
    expect((await look(dana, 9999, { name: "X" })).status).toBe(404);
  });

  it("not signed in, a team's look can't be changed; a member who isn't its captain neither", async () => {
    const { teamIds, look } = await drafted();
    expect((await look(w.browser(), teamIds[0], { name: "X" })).status).toBe(401);
    expect((await look(await w.signedIn("reg@example.com"), teamIds[0], { name: "X" })).status).toBe(403);
  });
});

describe("an admin makes a series", () => {
  it("two series with the same name each get a page of their own (a slug each)", async () => {
    const dana = await admin();
    const a = await dana.series({ name: "Spring Cup", shortName: "Spring" });
    const b = await dana.series({ name: "Spring Cup", shortName: "Spring" });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.slug).not.toBe(b.body.slug);
  });

  it("a short name of up to 12, up to 8 awards (empty ones dropped), up to 8 playoffs between two places", async () => {
    const dana = await admin();
    expect((await dana.series({ shortName: "x".repeat(13) })).status).toBe(400);
    const awards = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Award ${i}`, about: "" }));
    expect((await dana.series({ name: "Nine", awards: awards(9) })).status).toBe(400);
    const kept = await dana.series({ name: "Eight", awards: [...awards(8), { name: "", about: "dropped" }] });
    expect(kept.status).toBe(201);
    expect((await dana.boot()).tournamentTypes.find((t: Json) => t.id === kept.body.id).awards).toHaveLength(8);
    const same = await dana.series({ name: "Self", playoffs: [{ name: "Final", home: 1, away: 1 }] });
    expect(same.status).toBe(400);
    expect(same.body.error).toBe("A playoff game is between two different places.");
    expect((await dana.series({ name: "Far", playoffs: [{ name: "Final", home: 1, away: 17 }] })).status).toBe(400);
    expect((await dana.series({ name: "Nameless", playoffs: [{ name: " ", home: 1, away: 2 }] })).status).toBe(400);
  });

  it("only someone who manages tournaments makes or changes a series, or a tournament", async () => {
    const dana = await admin();
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", "/api/tournament-types", {})).status).toBe(403);
    expect((await reg.call("POST", "/api/tournaments", dana.cup())).status).toBe(403);
    const id = (await dana.create()).body.id;
    expect((await reg.call("PUT", `/api/tournaments/${id}`, dana.cup({ name: "Mine" }))).status).toBe(403);
    expect((await w.browser().call("POST", "/api/tournaments", dana.cup())).status).toBe(401);
    expect((await dana.tournament(id)).name).toBe("Winter Cup");
  });
});
