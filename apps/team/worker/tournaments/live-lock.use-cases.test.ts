// Once a tournament's started, a member can't take themselves out (ADR 0074): "once the kumite goes live, the player
// cannot remove themselves. only the admin can adjust it. it has fees implications" (the user, 2026-10-23). Started
// is marked live or finished (KUMITE!, The Anchor), or a match being played or played. Their place, and the fee it's
// charged from the day (ADR 0007), stay as they are; an admin can still take them off. Before then they leave as
// ever. Driven through the real Worker handlers in the fake world, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { chargeDue } from "../dues/dues";
import { testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Player", position: "D", rating: 58, email: "mo@example.com" },
];
/** The Cup's day, mid-morning: it's charged from today */
const DAY = { now: new Date("2026-10-10T10:00:00Z") };

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** The Autumn Cup, £15, sign-up open, Reg and Mo in, on its day (so they're charged). */
async function cup() {
  const dana = await w.signedIn("dana@example.com");
  const reg = await w.signedIn("reg@example.com");
  const mo = await w.signedIn("mo@example.com");
  const made = await dana.call("POST", "/api/tournaments", {
    name: "Autumn Cup",
    heldOn: "2026-10-10",
    startTime: "11:00",
    endTime: "17:00",
    status: "open",
    feePence: 1500,
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  for (const b of [reg, mo])
    expect((await b.call("POST", `/api/tournaments/${id}/answer`, { answer: "in" })).status).toBe(200);
  await chargeDue(w.env, DAY.now);
  const boot = (await dana.club(DAY)).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  /** An admin marks it live or finished, as the editor's status does. */
  const mark = async (status: "live" | "finished") => {
    const t = ((await dana.club(DAY)).body as Json).tournaments.find((x: Json) => x.id === id);
    return dana.call("PUT", `/api/tournaments/${id}`, { ...t, status }, DAY);
  };
  /** Someone's sign-up, as stored. */
  const entry = (name: string) =>
    (
      w.db.raw
        .prepare("SELECT signup FROM tournament_entries WHERE tournament_id = ? AND member_id = ?")
        .get(id, idOf(name)) as { signup: string } | undefined
    )?.signup ?? null;
  /** Someone's charges for it, as stored. */
  const charges = (name: string) =>
    w.db.raw
      .prepare("SELECT amount_pence pence, due_on dueOn FROM charges WHERE tournament_id = ? AND member_id = ?")
      .all(id, idOf(name));
  return { dana, reg, mo, id, idOf, mark, entry, charges };
}

describe("a member can't take themselves out once it's started", () => {
  it.each(["live", "finished"] as const)(
    "marked %s: Reg's Out is refused, his place and his £15 charge stay as they were",
    async (status) => {
      const c = await cup();
      expect(c.charges("Reg Player")).toEqual([{ pence: 1500, dueOn: "2026-10-10" }]);
      expect((await c.mark(status)).status).toBe(200);

      const said = await c.reg.call("POST", `/api/tournaments/${c.id}/answer`, { answer: "out" }, DAY);
      expect(said.status).toBe(409);
      expect(said.body.error).toBe("It's started: ask an admin to take you off.");
      expect(c.entry("Reg Player")).toBe("in");
      expect(c.charges("Reg Player")).toEqual([{ pence: 1500, dueOn: "2026-10-10" }]);
    },
  );

  it("an admin can still take him off, and his unpaid charge goes with him", async () => {
    const c = await cup();
    expect((await c.mark("live")).status).toBe(200);
    const off = await c.dana.call(
      "POST",
      `/api/tournaments/${c.id}/players`,
      { memberId: c.idOf("Reg Player"), in: false },
      DAY,
    );
    expect(off.status).toBe(200);
    expect(c.entry("Reg Player")).toBeNull();
    expect(c.charges("Reg Player")).toEqual([]);
    // And put him back on: charged again
    const on = await c.dana.call(
      "POST",
      `/api/tournaments/${c.id}/players`,
      { memberId: c.idOf("Reg Player"), in: true },
      DAY,
    );
    expect(on.status).toBe(200);
    expect(c.entry("Reg Player")).toBe("in");
    expect(c.charges("Reg Player")).toEqual([{ pence: 1500, dueOn: "2026-10-10" }]);
  });

  it("before it's started, a member leaves as ever, on the day too, and the unpaid charge goes", async () => {
    const c = await cup();
    const said = await c.reg.call("POST", `/api/tournaments/${c.id}/answer`, { answer: "out" }, DAY);
    expect(said.status).toBe(200);
    expect(c.entry("Reg Player")).toBe("out");
    expect(c.charges("Reg Player")).toEqual([]);
  });
});

describe("the Kumite: started once a match has been played, whatever its status says", () => {
  // A captains' draft: three captains, five goalies (one a team, so two left over) and a skater
  const KUMITE_ROSTER = [
    ROSTER[0],
    ...["Cara", "Cole", "Cy"].map((n) => ({
      name: `${n} Captain`,
      position: "F",
      rating: 70,
      email: `${n.toLowerCase()}@example.com`,
    })),
    ...["Gus", "Gil", "Gav", "Gwen", "Gabe"].map((n) => ({
      name: `${n} Goalie`,
      position: "G",
      rating: 60,
      email: `${n.toLowerCase()}@example.com`,
    })),
    { name: "Reg Player", position: "F", rating: 55, email: "reg@example.com" },
  ];
  const AT = { now: new Date("2026-12-08T19:30:00Z") };

  it("fixtures set, a goalie left over says he's out; a match played, the next one can't, nor can anyone come in", async () => {
    w = testWorld(KUMITE_ROSTER);
    const dana = await w.signedIn("dana@example.com");
    const boot = (await dana.club()).body as Json;
    const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
    const made = await dana.call("POST", "/api/tournaments", {
      typeId: 1,
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
    const as = async (n: string) => w.signedIn(`${n}@example.com`);
    for (const n of ["gus", "gil", "gav", "gwen", "gabe", "reg"])
      expect((await (await as(n)).call("POST", `/api/tournaments/${id}/answer`, { answer: "in" }, AT)).status).toBe(
        200,
      );
    expect(
      (await dana.call("POST", `/api/tournaments/${id}/move`, { from: "signup", to: "fixtures" }, AT)).status,
    ).toBe(200);
    const players = () =>
      w.db.raw
        .prepare(
          `SELECT p.member_id m FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
           WHERE t.tournament_id = ?`,
        )
        .all(id)
        .map((r) => (r as { m: number }).m);
    const goalies = ["Gus", "Gil", "Gav", "Gwen", "Gabe"];
    const leftOver = goalies.filter((g) => !players().includes(idOf(`${g} Goalie`)));
    expect(leftOver).toHaveLength(2);
    const signup = (name: string) =>
      (
        w.db.raw
          .prepare("SELECT signup FROM tournament_entries WHERE tournament_id = ? AND member_id = ?")
          .get(id, idOf(name)) as { signup: string }
      ).signup;

    // Fixtures set, nothing played: not started, so the first left over can still say he's out
    const first = await (
      await as(leftOver[0].toLowerCase())
    ).call("POST", `/api/tournaments/${id}/answer`, { answer: "out" }, AT);
    expect(first.status).toBe(200);

    // A match played (its status still says sign-up open): started
    const t = ((await dana.club(AT)).body as Json).tournaments.find((x: Json) => x.id === id);
    expect(t.status).toBe("open");
    expect(
      (await dana.call("PUT", `/api/tournaments/${id}/games/${t.games[0].id}`, { homeGoals: 2, awayGoals: 1 }, AT))
        .status,
    ).toBe(200);
    const second = await (
      await as(leftOver[1].toLowerCase())
    ).call("POST", `/api/tournaments/${id}/answer`, { answer: "out" }, AT);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("The Kumite's started: ask an admin to take you off.");
    expect(signup(`${leftOver[1]} Goalie`)).toBe("in");
    // Coming back in is an admin's too
    const back = await (
      await as(leftOver[0].toLowerCase())
    ).call("POST", `/api/tournaments/${id}/answer`, { answer: "in" }, AT);
    expect(back.status).toBe(409);
    expect(signup(`${leftOver[0]} Goalie`)).toBe("out");
  });
});

describe("Out at the moment it goes live", () => {
  it.each(seeds(8))(
    "refused with his place kept, or done whole with his charge gone: never half (seed %i)",
    async (seed) => {
      const c = await cup();
      w.db.interleave(seed);
      const [, said] = await Promise.all([
        c.mark("live"),
        c.reg.call("POST", `/api/tournaments/${c.id}/answer`, { answer: "out" }, DAY),
      ]);
      w.db.interleave(null);
      if (said.status === 200) {
        expect(c.entry("Reg Player")).toBe("out");
        expect(c.charges("Reg Player")).toEqual([]);
      } else {
        expect(said.status).toBe(409);
        expect(c.entry("Reg Player")).toBe("in");
        expect(c.charges("Reg Player")).toEqual([{ pence: 1500, dueOn: "2026-10-10" }]);
      }
      // Either way it's live now, and he can't
      expect((await c.reg.call("POST", `/api/tournaments/${c.id}/answer`, { answer: "out" }, DAY)).status).toBe(
        said.status === 200 ? 200 : 409,
      );
    },
  );
});
