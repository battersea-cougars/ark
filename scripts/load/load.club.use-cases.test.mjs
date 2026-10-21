// A load run against dev brings its own people and takes them away again (docs/load-testing.md, "Against dev"): its
// members signed in with sessions it mints, which the real API takes as any other sign-in, and everything they made
// gone afterwards, the club's own members and data untouched. The target is dev's or nothing.
import { describe, expect, it } from "vitest";
import { testWorld } from "../../apps/team/worker/testing.ts";
import { addMembers, cleanUp, leftovers, loadRoster, MARK, mintSessions, nothingLeft } from "./load.club.mjs";
import { DEV, notDev } from "./load.dev.mjs";

/** The fake world's SQLite as load.club.mjs reaches a database. */
const reach = (db) => ({
  name: "the fake world",
  run: async (sql) => void db.raw.exec(sql),
  rows: async (sql) => db.raw.prepare(sql).all(),
});
const club = [
  { name: "Ada Admin", position: "D", rating: 60, email: "ada@example.com", roles: ["Admin"] },
  { name: "Ben Member", position: "F", rating: 50, email: "ben@example.com" },
];

describe("a load run's own people", () => {
  it("are signed in by the sessions it mints, do what members do, and leave nothing behind", async () => {
    const w = testWorld(club);
    const db = reach(w.db);
    const before = w.db.raw.prepare("SELECT COUNT(*) n FROM members").get().n;
    const roster = loadRoster(5);
    await addMembers(db, roster);
    const sessions = await mintSessions(
      db,
      roster.map((r) => r.email),
      new Date(),
    );
    // Stored as the app stores a sign-in: the hash, never the token
    const stored = w.db.raw.prepare("SELECT token_hash FROM auth_sessions WHERE method = 'load'").all();
    expect(stored).toHaveLength(5);
    expect(stored.map((s) => s.token_hash)).not.toContain(sessions["admin@load.test"].token);

    const as = (email) => {
      const b = w.browser();
      b.jar.set("__Host-cougars_session", sessions[email].token);
      return b;
    };
    const admin = as("admin@load.test");
    const now = { now: new Date() };
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await admin.call("GET", "/api/bootstrap", undefined, now)).status).toBe(200);
    // The admin makes a training night and a tournament, as the scenarios do
    const series = await admin.call(
      "POST",
      "/api/series",
      {
        name: `Load night ${MARK}`,
        shortName: "Load",
        icon: "skate",
        tone: "green",
        repeatEvery: 1,
        weekdays: [["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${day}T12:00:00Z`).getUTCDay()]],
        startsOn: day,
        endsOn: day,
        startTime: "19:00",
        endTime: "21:00",
        capacity: 40,
        goalieCapacity: 2,
        public: false,
        active: true,
        fees: [],
      },
      now,
    );
    expect(series.status).toBe(201);
    const night = (await admin.call("GET", "/api/bootstrap", undefined, now)).body.sessions.find(
      (s) => s.seriesId === series.body.id,
    );
    expect(
      (await as("m1@load.test").call("POST", `/api/sessions/${night.id}/answer`, { answer: "in" }, now)).status,
    ).toBe(200);
    const cup = await admin.call(
      "POST",
      "/api/tournaments",
      { name: `Load Scrimmage ${MARK}`, public: false, heldOn: day, status: "planned", feePence: 0 },
      now,
    );
    expect(cup.status).toBe(201);
    expect(nothingLeft(await leftovers(db))).toBe(false);

    const { after } = await cleanUp(db);
    expect(after).toEqual({
      members: 0,
      signIns: 0,
      trainings: 0,
      sessions: 0,
      tournamentTypes: 0,
      tournaments: 0,
      auditRows: 0,
    });
    // The club's own members are all still there, and the minted sign-ins sign nobody in now
    expect(w.db.raw.prepare("SELECT COUNT(*) n FROM members").get().n).toBe(before);
    expect((await admin.call("GET", "/api/bootstrap", undefined, now)).status).toBe(401);
  });

  it("are only ever @load.test, and never someone's name", async () => {
    const w = testWorld(club);
    const db = reach(w.db);
    await expect(mintSessions(db, ["ben@example.com"])).rejects.toThrow(/load\.test/);
    await expect(addMembers(db, [{ ...loadRoster(1)[0], name: "Ben Member" }])).rejects.toThrow(/already members/);
    await addMembers(db, loadRoster(2));
    // A run's people still there: the next run refuses until --cleanup
    await expect(addMembers(db, loadRoster(2))).rejects.toThrow(/cleanup/);
  });
});

describe("the target", () => {
  it("is dev's, or the run is refused", () => {
    expect(notDev(DEV)).toBeNull();
    expect(notDev({ ...DEV, url: "https://team.batterseacougars.com" })).toMatch(/isn't dev's/);
    expect(notDev({ ...DEV, url: "https://team.cougars-dev.workers.dev.evil.example" })).toMatch(/isn't dev's/);
    expect(notDev({ ...DEV, database: "cougars" })).toMatch(/isn't dev's/);
    expect(notDev({ ...DEV, env: { SITE_ENV: "production" } })).toMatch(/production/);
  });
});
