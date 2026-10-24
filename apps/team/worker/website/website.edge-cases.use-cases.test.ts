// Unusual results on the website (ADR 0100): a goalless draw, a score typed in with nobody said to have scored, a
// tournament an admin calls finished before its Final, champions an admin confirms over the table, and the website
// following an admin's correction. Driven through the real Worker handlers (ADR 0031), then read the way the
// website's build reads them: the snapshot's rows (scripts/lib/results-sql.mjs), worked out by the website's own
// module.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editionsFrom } from "../../../web/src/lib/results";
import { readResultRows } from "../../../../scripts/lib/results-sql.mjs";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Member", position: "G", rating: 55, email: "mo@example.com" },
];
const FULL_NAMES = /Dana Admin|Cara Captain|Cole Captain|Reg Player|Mo Member/;
const CREST = "data:image/png;base64,iVBORw0KGgo=";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
/** What the website shows after its next build. */
const rows = () => readResultRows(async (sql: string) => w.db.raw.prepare(sql).all());
const publishedEditions = async () => editionsFrom(await rows());
const publishedEdition = async (id: number) => (await publishedEditions()).find((e) => e.id === id) ?? null;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A cup two teams entered: the Ants (Cara, with Reg) and the Bees (Cole, with Mo), one game between them. */
async function cup(changes: object = {}) {
  const dana = await w.signedIn("dana@example.com");
  // Who's who, straight from the database: the story is the website's, not the app's pages
  const one = (sql: string, ...p: unknown[]) => (w.db.raw.prepare(sql).get(...p) as { id: number }).id;
  const idOf = (name: string) => one("SELECT id FROM members WHERE name = ?", name);
  const res = await dana.call("POST", "/api/tournaments", {
    name: "Summer Cup",
    location: "Battersea Park",
    heldOn: "2026-09-12",
    startTime: "10:00",
    endTime: "15:00",
    status: "planned",
    feePence: 0,
    kind: "teams",
    playoffs: [],
    awards: [
      { name: "Champions", about: "Top of the table." },
      { name: "Top scorer", about: "Most goals." },
    ],
    teams: [
      { name: "Ants", logo: CREST, captainMemberId: idOf("Cara Captain"), players: [{ memberId: idOf("Reg Player") }] },
      { name: "Bees", logo: null, captainMemberId: idOf("Cole Captain"), players: [{ memberId: idOf("Mo Member") }] },
    ],
    ...changes,
  });
  expect(res.status).toBe(201);
  const id = res.body.id as number;
  expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
  const team = (name: string) => one("SELECT id FROM tournament_teams WHERE tournament_id = ? AND name = ?", id, name);
  const [ants, bees] = [team("Ants"), team("Bees")];
  const game = one("SELECT id FROM tournament_games WHERE tournament_id = ?", id);
  const goal = (teamId: number, scorer: string, assist?: string) =>
    dana.call("POST", `/api/tournaments/${id}/games/${game}/goals`, {
      teamId,
      scorerId: idOf(scorer),
      assistId: assist ? idOf(assist) : null,
    });
  /** The game's played: 0–0 at full time, then the admin puts in who scored, 2–1 to the Ants. */
  const play = async () => {
    expect(
      (await dana.call("PUT", `/api/tournaments/${id}/games/${game}`, { homeGoals: 0, awayGoals: 0 })).status,
    ).toBe(200);
    for (const [team, scorer, assist] of [
      [ants, "Cara Captain", "Reg Player"],
      [ants, "Cara Captain"],
      [bees, "Cole Captain"],
    ] as const)
      expect((await goal(team, scorer, assist)).status).toBe(200);
  };
  /** A penalty an admin puts on the played game: on a player, or the bench. */
  const penalty = (teamId: number, who: string | null, minutes: number) =>
    dana.call("POST", `/api/tournaments/${id}/games/${game}/penalties`, {
      teamId,
      memberId: who ? idOf(who) : null,
      minutes,
      infraction: who ? "roughing" : "delay-of-game",
    });
  const confirm = (list: object[]) => dana.call("PUT", `/api/tournaments/${id}/winners`, { winners: list });
  return { dana, id, idOf, ants, bees, play, penalty, confirm };
}

describe("unusual results on the website", () => {
  it("a goalless draw is a played game: 0–0 on the website, a point each, and nobody on the scorers' list", async () => {
    const { id, dana } = await cup();
    const game = (w.db.raw.prepare("SELECT id FROM tournament_games WHERE tournament_id = ?").get(id) as Json).id;
    expect(
      (await dana.call("PUT", `/api/tournaments/${id}/games/${game}`, { homeGoals: 0, awayGoals: 0 })).status,
    ).toBe(200);
    const r = (await publishedEdition(id))!;
    expect(r.games.map((g) => [g.homeGoals, g.awayGoals])).toEqual([[0, 0]]);
    expect(r.table.map((x) => [x.name, x.d, x.pts])).toEqual([
      ["Ants", 1, 1],
      ["Bees", 1, 1],
    ]);
    expect(r.scorers).toEqual([]);
  });

  it("a score typed in without who scored shows the score, and lists nobody for those goals", async () => {
    const { id, dana } = await cup();
    const game = (w.db.raw.prepare("SELECT id FROM tournament_games WHERE tournament_id = ?").get(id) as Json).id;
    await dana.call("PUT", `/api/tournaments/${id}/games/${game}`, { homeGoals: 3, awayGoals: 1 });
    const r = (await publishedEdition(id))!;
    expect(r.games[0].homeGoals + r.games[0].awayGoals).toBe(4);
    expect(r.scorers).toEqual([]);
    expect(r.champions).not.toBeNull();
  });

  it("level at the top with no playoffs, the champions an admin confirms are the ones on the website", async () => {
    const { id, dana, bees, confirm } = await cup();
    const game = (w.db.raw.prepare("SELECT id FROM tournament_games WHERE tournament_id = ?").get(id) as Json).id;
    await dana.call("PUT", `/api/tournaments/${id}/games/${game}`, { homeGoals: 1, awayGoals: 1 });
    expect((await confirm([{ award: "Champions", teamId: bees }])).status).toBe(200);
    expect((await publishedEdition(id))!.champions).toBe("Bees");
  });

  it("an admin's correction after the day changes the website: the score, the table and the champions", async () => {
    const { id, dana, play } = await cup();
    await play();
    expect((await publishedEdition(id))!.champions).toBe("Ants");
    const game = (w.db.raw.prepare("SELECT id FROM tournament_games WHERE tournament_id = ?").get(id) as Json).id;
    // It was 2–3, the Bees' way
    const ants = (await publishedEdition(id))!.games[0].home === "Ants";
    await dana.call(
      "PUT",
      `/api/tournaments/${id}/games/${game}`,
      ants ? { homeGoals: 2, awayGoals: 3 } : { homeGoals: 3, awayGoals: 2 },
    );
    const r = (await publishedEdition(id))!;
    expect(r.champions).toBe("Bees");
    expect(JSON.stringify(r)).not.toMatch(FULL_NAMES);
    expect(r.table[0]).toMatchObject({ name: "Bees", pts: 3, gf: 3, ga: 2 });
  });

  it("a cup an admin calls finished before its Final is on the website: the games played, and no champions", async () => {
    const { id, dana } = await cup({ playoffs: [{ name: "Final", home: 1, away: 2 }] });
    const group = (
      w.db.raw.prepare("SELECT id FROM tournament_games WHERE tournament_id = ? AND stage = 'group'").get(id) as Json
    ).id;
    await dana.call("PUT", `/api/tournaments/${id}/games/${group}`, { homeGoals: 1, awayGoals: 0 });
    // Rained off before the Final
    expect(await publishedEdition(id)).toBeNull();
    const saved = ((await dana.club()).body as Json).tournaments.find((t: Json) => t.id === id);
    expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...saved, status: "finished" })).status).toBe(200);
    const r = (await publishedEdition(id))!;
    expect(r.games).toHaveLength(1);
    expect(r.champions).toBeNull();
    expect(r.table.map((x) => x.p)).toEqual([1, 1]);
  });
});
