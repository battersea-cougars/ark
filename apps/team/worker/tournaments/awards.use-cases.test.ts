// Who won a tournament's awards (ADR 0044): the awards are the tournament's own (its series', ADR 0044, 0030); an
// admin says who won each, a team (Champions) or one of its players (Top scorer), on the tournament's page, and
// everyone sees them. Driven through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Mo Member", position: "G", rating: 55, email: "mo@example.com" },
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
  const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
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
    awards: [
      { name: "Champions", about: "" },
      { name: "Top scorer", about: "" },
    ],
    teams: [
      { name: "Ants", logo: null, captainMemberId: idOf("Cara Captain"), players: [] },
      { name: "Bees", logo: null, captainMemberId: idOf("Cole Captain"), players: [] },
    ],
  });
  expect(res.status).toBe(201);
  const id = res.body.id as number;
  const tournament = async (as = dana) =>
    ((await as.call("GET", "/api/bootstrap")).body as Json).tournaments.find((t: Json) => t.id === id);
  const t = await tournament();
  const winners = (as: { call: Json }, list: object[]) =>
    as.call("PUT", `/api/tournaments/${id}/winners`, { winners: list });
  return { dana, id, tournament, winners, idOf, ants: t.teams[0].id as number, bees: t.teams[1].id as number };
}

describe("who won the awards", () => {
  it("an admin says who won each, a team or a player, and everyone sees it", async () => {
    const { dana, tournament, winners, idOf, ants } = await cup();
    expect(
      (
        await winners(dana, [
          { award: "Champions", teamId: ants },
          { award: "Top scorer", memberId: idOf("Cole Captain") },
        ])
      ).status,
    ).toBe(200);
    const mo = await w.signedIn("mo@example.com");
    expect((await tournament(mo)).winners).toEqual([
      { award: "Champions", teamId: ants, memberId: null, title: null },
      { award: "Top scorer", teamId: null, memberId: idOf("Cole Captain"), title: null },
    ]);
    // Changed their mind: the list is the whole list
    await winners(dana, [{ award: "Champions", teamId: ants }]);
    expect((await tournament()).winners).toHaveLength(1);
  });

  it("only the tournament's own awards, its own teams, and players on them", async () => {
    const { dana, winners, idOf, ants } = await cup();
    expect((await winners(dana, [{ award: "Best hair", teamId: ants }])).status).toBe(400);
    expect((await winners(dana, [{ award: "Champions", teamId: 99999 }])).status).toBe(400);
    // Mo isn't on a team in this one
    expect((await winners(dana, [{ award: "Top scorer", memberId: idOf("Mo Member") }])).status).toBe(400);
    expect((await winners(dana, [{ award: "Top scorer" }])).status).toBe(400);
  });

  it("a member can't say who won", async () => {
    const { winners, ants } = await cup();
    const mo = await w.signedIn("mo@example.com");
    expect((await winners(mo, [{ award: "Champions", teamId: ants }])).status).toBe(403);
  });
});
