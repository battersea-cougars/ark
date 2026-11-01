// Who won, at the edges (ADR 0044): a tie, clearing the list, an award given to a team and a player at once, a team
// that leaves the tournament, and a tournament that isn't there. Driven through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A cup two teams entered, with Champions and Top scorer to give out. */
async function cup() {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.club()).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  const res = await dana.call("POST", "/api/tournaments", {
    name: "Summer Cup",
    heldOn: "2026-11-14",
    startTime: "10:00",
    endTime: "15:00",
    status: "planned",
    feePence: 0,
    kind: "teams",
    awards: [
      { name: "Champions", about: "" },
      { name: "Top scorer", about: "" },
    ],
    teams: [
      { name: "Ants", captainMemberId: idOf("Cara Captain"), players: [] },
      { name: "Bees", captainMemberId: idOf("Cole Captain"), players: [] },
    ],
  });
  expect(res.status).toBe(201);
  const id = res.body.id as number;
  const tournament = async () => ((await dana.club()).body as Json).tournaments.find((t: Json) => t.id === id);
  const t = await tournament();
  const winners = (list: unknown, tournamentId = id) =>
    dana.call("PUT", `/api/tournaments/${tournamentId}/winners`, { winners: list });
  return { dana, id, t, tournament, winners, idOf, ants: t.teams[0].id as number, bees: t.teams[1].id as number };
}

describe("who won, at the edges", () => {
  it("joint winners: two players tied for Top scorer both get it, in the order the admin gave them", async () => {
    const { tournament, winners, idOf } = await cup();
    const tie = [
      { award: "Top scorer", memberId: idOf("Cole Captain") },
      { award: "Top scorer", memberId: idOf("Cara Captain") },
    ];
    expect((await winners(tie)).status).toBe(200);
    expect((await tournament()).winners.map((x: Json) => x.memberId)).toEqual([
      idOf("Cole Captain"),
      idOf("Cara Captain"),
    ]);
  });

  it("an empty list takes every winner off; a list that isn't one is refused and changes nothing", async () => {
    const { tournament, winners, ants } = await cup();
    expect((await winners([{ award: "Champions", teamId: ants }])).status).toBe(200);
    expect((await winners("Ants")).status).toBe(400);
    expect((await tournament()).winners).toHaveLength(1);
    expect((await winners([])).status).toBe(200);
    expect((await tournament()).winners).toEqual([]);
  });

  it("an award goes to a team or a player, never both; one bad row refuses the whole list", async () => {
    const { tournament, winners, idOf, ants } = await cup();
    expect((await winners([{ award: "Champions", teamId: ants, memberId: idOf("Cara Captain") }])).status).toBe(400);
    const res = await winners([
      { award: "Champions", teamId: ants },
      { award: "Best hair", teamId: ants },
    ]);
    expect(res.status).toBe(400);
    expect((await tournament()).winners).toEqual([]);
  });

  it("a team taken out of the tournament takes its award with it", async () => {
    const { dana, id, t, tournament, winners, ants, bees } = await cup();
    expect((await winners([{ award: "Champions", teamId: ants }])).status).toBe(200);
    expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...t, teams: [t.teams[1]] })).status).toBe(200);
    expect((await tournament()).teams.map((x: Json) => x.id)).toEqual([bees]);
    expect((await tournament()).winners).toEqual([]);
  });

  it("winners for a tournament that isn't there is a 404", async () => {
    const { winners, ants } = await cup();
    expect((await winners([{ award: "Champions", teamId: ants }], 9999)).status).toBe(404);
  });
});
