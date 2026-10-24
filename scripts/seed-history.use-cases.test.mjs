// A made-up past for a local club (`npm run seed:history`, scripts/lib/history.mjs): years of Kumites and a year of
// training for the club's own members, that the real app reads as its own (the bootstrap, a past Kumite's page,
// History a page at a time, logos by address, the dues), and that goes again without a trace. Driven through the real
// Worker handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../apps/team/worker/testing.ts";
import {
  historySql,
  leftovers,
  nothingLeft,
  planHistory,
  readClub,
  removeHistory,
  seedHistory,
} from "./lib/history.mjs";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...Array.from({ length: 21 }, (_, i) => ({
    name: `Member ${i + 1}`,
    position: i % 8 === 0 ? "G" : i % 3 ? "F" : "D",
    rating: 40 + ((i * 7) % 45),
    email: `m${i + 1}@example.com`,
  })),
];
const TODAY = NOW.toISOString().slice(0, 10);
const KUMITE = 1;

/** The fake world's SQLite as the seed reaches a database. */
const reach = (db) => ({ run: async (sql) => void db.raw.exec(sql), rows: async (sql) => db.raw.prepare(sql).all() });
/** Every table's row count. */
const sizes = (raw) =>
  Object.fromEntries(
    raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(({ name }) => [name, raw.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n]),
  );

let w;
let db;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  db = reach(w.db);
});

describe("a seeded history", () => {
  it("is the club's own members' past: every row points at something there", async () => {
    const { made, rows } = await seedHistory(db, { today: TODAY });
    expect(made.kumites).toMatchObject({ played: 28, unplayed: 2 });
    expect(made.training.nights).toBeGreaterThan(45);
    expect(rows.tournament_goals).toBeGreaterThan(300);
    expect(rows.tournament_award_votes).toBeGreaterThan(0);
    expect(rows.payments).toBeGreaterThan(0);
    expect(w.db.raw.pragma("foreign_key_check")).toEqual([]);
    const members = new Set(
      w.db.raw
        .prepare("SELECT id FROM members")
        .all()
        .map((m) => m.id),
    );
    const scorers = w.db.raw.prepare("SELECT DISTINCT scorer_member_id id FROM tournament_goals").all();
    expect(scorers.every((s) => members.has(s.id))).toBe(true);
    // Each voted for someone else, once an award
    expect(
      w.db.raw
        .prepare("SELECT COUNT(*) n FROM tournament_award_votes WHERE voter_member_id = candidate_member_id")
        .get().n,
    ).toBe(0);
  });

  it("is the same past for the same seed", async () => {
    const club = await readClub(db);
    expect(historySql(planHistory(club, { today: TODAY, seed: 7 }))).toBe(
      historySql(planHistory(club, { today: TODAY, seed: 7 })),
    );
  });

  it("reads as the app's own: the bootstrap, a past Kumite in full, its logo, and History through every page", async () => {
    const version = w.db.raw.prepare("SELECT version FROM data_version").get().version;
    await seedHistory(db, { today: TODAY });
    expect(w.db.raw.prepare("SELECT version FROM data_version").get().version).toBeGreaterThan(version);
    const dana = await w.signedIn("dana@example.com");
    const boot = await dana.call("GET", "/api/bootstrap");
    expect(boot.status).toBe(200);
    expect(JSON.stringify(boot.body)).not.toContain("base64");
    // Her nights at Tuesday Skills are charged, and some paid
    expect(boot.body.charges?.length ?? boot.body.dues?.charges?.length).toBeGreaterThan(0);

    const seen = [];
    let next = null;
    do {
      const page = await dana.call("GET", `/api/tournament-types/${KUMITE}/editions${next ? `?before=${next}` : ""}`);
      expect(page.status).toBe(200);
      seen.push(...page.body.editions);
      next = page.body.next;
    } while (next);
    expect(seen).toHaveLength(28);
    expect(new Set(seen.map((e) => e.id)).size).toBe(28);
    expect(seen.every((e) => e.champion !== null)).toBe(true);

    const past = (await dana.call("GET", `/api/tournaments/${seen.at(-1).id}`)).body.tournament;
    expect(past.status).toBe("finished");
    expect(past.games.length).toBeGreaterThan(2);
    expect(past.games.every((g) => g.status === "done")).toBe(true);
    expect(past.winners.map((x) => x.award)).toEqual(expect.arrayContaining(["Champions", "Top scorer"]));
    const champions = past.winners.find((x) => x.award === "Champions").teamId;
    expect(champions).toBe(seen.at(-1).champion);

    const crest = seen.flatMap((e) => e.teams).find((t) => t.logo);
    const logo = await dana.open("GET", crest.logo);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("refuses to go on twice, and --remove leaves the club as it was", async () => {
    const before = sizes(w.db.raw);
    await seedHistory(db, { today: TODAY });
    await expect(seedHistory(db, { today: TODAY })).rejects.toThrow(/already there/);
    const { after } = await removeHistory(db);
    expect(nothingLeft(after)).toBe(true);
    expect(nothingLeft(await leftovers(db))).toBe(true);
    const now = sizes(w.db.raw);
    // Everything as it was but the data version, moved on so phones reload
    expect(now).toEqual(before);
    expect(w.db.raw.pragma("foreign_key_check")).toEqual([]);
  });
});
