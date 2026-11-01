import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { syncAll } from "@cougars/shared/agenda";
import { FIRST_KUMITE_SQL } from "@cougars/shared/testing/kumite";
import { clearCache } from "./cache";
import { cachedWhatsOn, weeklyRows, whatsOn, type WhatsOnItem } from "./whats-on";

// Tuesday 6 October 2026, late morning in London
const NOW = new Date("2026-10-06T11:00:00Z");

describe("what's on", () => {
  let db: ReturnType<typeof createTestD1>;
  beforeEach(() => {
    db = createTestD1();
    // The team app makes Fridays ahead; here, the next four, one moved to the other rink and one called off
    const friday = db.raw.prepare("SELECT id FROM training_series WHERE slug = 'friday'").get() as { id: number };
    const add = db.raw.prepare(
      "INSERT INTO training_sessions (series_id, held_on, venue, cancelled_at) VALUES (?, ?, ?, ?)",
    );
    add.run(friday.id, "2026-10-09", null, null);
    add.run(friday.id, "2026-10-16", "Other rink", null);
    add.run(friday.id, "2026-10-23", null, "2026-10-01T09:00:00Z");
    add.run(friday.id, "2026-10-30", null, null);
    const event = db.raw.prepare(
      `INSERT INTO club_events (title, starts_at, ends_at, venue, description, public, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    event.run("Summer social", "2026-10-10T18:00:00Z", "2026-10-10T22:00:00Z", "The pub", "Drinks.", 1, null);
    event.run("Committee", "2026-10-11T18:00:00Z", "2026-10-11T19:00:00Z", "", "", 0, null);
    event.run("Kit day", "2026-10-12T09:00:00Z", "2026-10-12T11:00:00Z", "", "", 1, "2026-10-05T09:00:00Z");
    event.run("Last week's", "2026-10-01T18:00:00Z", "2026-10-01T20:00:00Z", "", "", 1, null);
    db.raw.exec(FIRST_KUMITE_SQL); // a public Kumite, a season so far
  });

  it("lists the next few public trainings, tournaments and events, soonest first", async () => {
    const items = await whatsOn(db, NOW);
    expect(items.map((i) => [i.title, i.startsAt, i.cancelled])).toEqual([
      // 19:30 in London is 18:30 UTC in October (BST)
      ["Friday Training", "2026-10-09T18:30:00.000Z", false],
      ["Summer social", "2026-10-10T18:00:00Z", false],
      ["Kit day", "2026-10-12T09:00:00Z", true],
      ["Friday Training", "2026-10-16T18:30:00.000Z", false],
      ["Friday Training", "2026-10-23T18:30:00.000Z", true],
      // The Kumite goes by its own name, just a season so far: sorted at its end
      ["The Cougars Kumite", "2027-08-31T10:00:00.000Z", false],
    ]);
    expect(items.find((i) => i.title === "The Cougars Kumite")).toMatchObject({ kind: "tournament", dateTbc: true });
    expect(items[1]).toMatchObject({ venue: "The pub", description: "Drinks." });
    // A session's own venue wins over its series'
    expect(items[3].venue).toBe("Other rink");
    expect(items[0].venue).toBe("Battersea Sports Centre");
  });

  it("shows a tournament that's just a season as the season, sorted at its end", async () => {
    db.raw.prepare("UPDATE tournaments SET season = 'summer', held_on = '2027-08-31'").run();
    await syncAll(db); // as the team app does when it changes a tournament
    const kumite = (await whatsOn(db, NOW)).find((i) => i.title === "The Cougars Kumite");
    expect(kumite).toMatchObject({ season: "Summer 2027", dateTbc: true });
  });

  it("leaves out a Kumite played early, its day still ahead: it's been, whatever its date (ADR 0074, #182)", async () => {
    db.raw.exec(`UPDATE tournaments SET season = NULL, held_on = '2026-10-30';
      INSERT INTO tournament_games (tournament_id, stage, round, position, status) VALUES (1, 'group', 1, 1, 'done')`);
    await syncAll(db);
    expect((await whatsOn(db, NOW)).map((i) => i.title)).not.toContain("The Cougars Kumite");
  });

  it("leaves out what isn't public", async () => {
    db.raw.exec("UPDATE training_series SET public = 0; UPDATE tournaments SET public = 0");
    await syncAll(db);
    expect((await whatsOn(db, NOW)).map((i) => i.title)).toEqual(["Summer social", "Kit day"]);
  });

  it("reads the calendar once a minute, however many people look", async () => {
    clearCache();
    await syncAll(db); // the team app keeps the agenda; reading it is what's counted
    const prepare = vi.spyOn(db, "prepare");
    let t = NOW.getTime();
    const deps = { now: () => t, edge: null };
    const first = await cachedWhatsOn(db, undefined, deps);
    const reads = prepare.mock.calls.length;
    for (let i = 0; i < 5; i++) expect(await cachedWhatsOn(db, undefined, deps)).toBe(first);
    expect(prepare.mock.calls.length).toBe(reads);
    t += 61_000;
    await cachedWhatsOn(db, undefined, deps);
    expect(prepare.mock.calls.length).toBe(reads * 2);
  });
});

describe("the weekly trainings in what's on", () => {
  const training = (startsAt: string, extra: Partial<WhatsOnItem> = {}): WhatsOnItem => ({
    key: `training:${startsAt}`,
    kind: "training",
    title: "Friday Training",
    startsAt,
    endsAt: null,
    venue: "Battersea Sports Centre",
    mapUrl: null,
    description: "",
    cancelled: false,
    dateTbc: false,
    season: null,
    ...extra,
  });
  const social = {
    ...training("2026-10-10T18:00:00Z"),
    key: "event:1",
    kind: "event" as const,
    title: "Summer social",
  };

  it("are one row, at the next one, naming any week that's called off", () => {
    const rows = weeklyRows([
      training("2026-10-09T18:30:00Z"),
      social,
      training("2026-10-16T18:30:00Z", { cancelled: true }),
      training("2026-10-23T18:30:00Z"),
    ]);
    expect(rows.map((r) => [r.title, r.startsAt, r.weekly])).toEqual([
      ["Friday Training", "2026-10-09T18:30:00Z", { skipped: ["2026-10-16T18:30:00Z"] }],
      ["Summer social", "2026-10-10T18:00:00Z", undefined],
    ]);
  });

  it("start from the first that's on when the next is called off", () => {
    const rows = weeklyRows([training("2026-10-09T18:30:00Z", { cancelled: true }), training("2026-10-16T18:30:00Z")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startsAt: "2026-10-16T18:30:00Z", weekly: { skipped: ["2026-10-09T18:30:00Z"] } });
  });

  it("keep a session somewhere else as its own row, so nobody goes to the wrong rink", () => {
    const rows = weeklyRows([
      training("2026-10-09T18:30:00Z"),
      training("2026-10-16T18:30:00Z", { venue: "Other rink" }),
      training("2026-10-23T18:30:00Z"),
    ]);
    expect(rows.map((r) => [r.venue, Boolean(r.weekly)])).toEqual([
      ["Battersea Sports Centre", true],
      ["Other rink", false],
    ]);
  });

  it("stay as they are when there's only one, or every one is called off", () => {
    expect(weeklyRows([training("2026-10-09T18:30:00Z")])[0].weekly).toBeUndefined();
    const off = [
      training("2026-10-09T18:30:00Z", { cancelled: true }),
      training("2026-10-16T18:30:00Z", { cancelled: true }),
    ];
    expect(weeklyRows(off)).toEqual(off);
  });
});
