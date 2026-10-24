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

/** Each charge's paid and each payment's spent, as stored (the schema's triggers keep them). */
const dues = (raw) => ({
  charges: raw.prepare("SELECT id, paid_pence n FROM charges ORDER BY id").all(),
  payments: raw.prepare("SELECT id, spent_pence n FROM payments ORDER BY id").all(),
});
/** The same, added up from every allocation. */
const duesFromAllocations = (raw) => ({
  charges: raw
    .prepare(
      "SELECT c.id, COALESCE((SELECT SUM(amount_pence) FROM payment_allocations WHERE charge_id = c.id), 0) n FROM charges c ORDER BY c.id",
    )
    .all(),
  payments: raw
    .prepare(
      "SELECT p.id, COALESCE((SELECT SUM(amount_pence) FROM payment_allocations WHERE payment_id = p.id), 0) n FROM payments p ORDER BY p.id",
    )
    .all(),
});
/** What a member owes: every charge less every payment. */
const balanceOf = (raw, id) =>
  raw
    .prepare(
      `SELECT COALESCE((SELECT SUM(amount_pence) FROM charges WHERE member_id = ?), 0)
            - COALESCE((SELECT SUM(amount_pence) FROM payments WHERE member_id = ?), 0) n`,
    )
    .get(id, id).n;
/** Each member's nights played before today, counted from every night's attendance. */
const playedFromAttendance = (raw) =>
  Object.fromEntries(
    raw
      .prepare(
        `SELECT m.id, (SELECT COUNT(*) FROM attendance a JOIN training_sessions s ON s.id = a.session_id
            WHERE a.member_id = m.id AND a.signup = 'in' AND COALESCE(a.attended, 1) = 1
              AND s.held_on < ? AND s.cancelled_at IS NULL) n FROM members m WHERE m.status = 'active'`,
      )
      .all(TODAY)
      .map((r) => [r.id, r.n]),
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
    // No logo but the generated crests, each small enough to come as itself (#177)
    expect(JSON.stringify(boot.body)).not.toMatch(/data:image\/(webp|png|jpeg)/);
    // Her nights at Tuesday Skills are charged, and some paid: on her ledger, what's left on the club read
    const ledger = (await dana.call("GET", `/api/members/${boot.body.me}/ledger`)).body;
    expect(ledger.lines.some((l) => l.kind === "charge")).toBe(true);
    expect(ledger.lines.some((l) => l.kind === "payment")).toBe(true);

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

    // A page of crests is no requests: each comes as itself, and is at its address too
    const crest = seen.flatMap((e) => e.teams).find((t) => t.logo);
    expect(crest.logo).toMatch(/^data:image\/svg\+xml;base64,/);
    const logo = await dana.open("GET", `/api/tournament-teams/${crest.id}/logo`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("owes exactly what each member's ledger adds up to, and each has played the nights they came to (#177)", async () => {
    const dana = await w.signedIn("dana@example.com");
    // The club in use: today's first open has counted the nights closed so far
    await dana.call("GET", "/api/bootstrap");
    expect(w.db.raw.prepare("SELECT played_through FROM data_version").get().played_through).not.toBeNull();
    await seedHistory(db, { today: TODAY });
    expect(dues(w.db.raw)).toEqual(duesFromAllocations(w.db.raw));
    const boot = (await dana.club()).body;
    const owed = Object.fromEntries(boot.dues.map((d) => [d.memberId, d.owed - d.credit]));
    for (const m of boot.members) {
      // Unpaid fees' line is what the top of their ledger says, and what every charge less every payment comes to
      const top = (await dana.call("GET", `/api/members/${m.id}/ledger?limit=1`)).body.lines[0]?.balance ?? 0;
      expect([owed[m.id] ?? 0, top], m.name).toEqual([balanceOf(w.db.raw, m.id), balanceOf(w.db.raw, m.id)]);
    }
    expect(Object.fromEntries(boot.members.map((m) => [m.id, m.played]))).toEqual(playedFromAttendance(w.db.raw));
  });

  it("read back as a rebuild reads rows back (db-rebuild.mjs: parents first, the stored sums left out), comes out the same", async () => {
    await seedHistory(db, { today: TODAY });
    const was = dues(w.db.raw);
    const raw = w.db.raw;
    const rows = Object.fromEntries(
      ["charges", "payments", "payment_allocations"].map((t) => [t, raw.prepare(`SELECT * FROM ${t}`).all()]),
    );
    raw.pragma("foreign_keys = OFF");
    for (const t of ["payment_allocations", "payments", "charges"]) raw.exec(`DELETE FROM ${t}`);
    const insert = (t, list, leave) => {
      for (const r of list) {
        const cols = Object.keys(r).filter((c) => c !== leave);
        raw
          .prepare(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
          .run(...cols.map((c) => r[c]));
      }
    };
    insert("charges", rows.charges, "paid_pence");
    insert("payments", rows.payments, "spent_pence");
    insert("payment_allocations", rows.payment_allocations);
    raw.pragma("foreign_keys = ON");
    expect(dues(raw)).toEqual(was);
  });

  it("refuses to go on twice, and --remove leaves the club as it was", async () => {
    const dana = await w.signedIn("dana@example.com");
    await dana.call("GET", "/api/bootstrap");
    const before = sizes(w.db.raw);
    const [owedBefore, playedBefore] = [dues(w.db.raw), playedFromAttendance(w.db.raw)];
    await seedHistory(db, { today: TODAY });
    await w.scheduled("7 * * * *", NOW);
    await expect(seedHistory(db, { today: TODAY })).rejects.toThrow(/already there/);
    const { after } = await removeHistory(db);
    expect(nothingLeft(after)).toBe(true);
    expect(nothingLeft(await leftovers(db))).toBe(true);
    const now = sizes(w.db.raw);
    // Everything as it was but the data version, moved on so phones reload
    expect(now).toEqual(before);
    expect(w.db.raw.pragma("foreign_key_check")).toEqual([]);
    // What anyone owes, and played, as before (#177)
    expect([dues(w.db.raw), playedFromAttendance(w.db.raw)]).toEqual([owedBefore, playedBefore]);
    // Seeded, its nights counted in (the hourly run), then taken away: the counts go back with them
    const boot = (await dana.club()).body;
    expect(Object.fromEntries(boot.members.map((m) => [m.id, m.played]))).toEqual(playedBefore);
  });
});
