// Two people at once: each sign-up decision is one statement, so two taps for the last place can't both get it.
// Calls the sign-up rules directly.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { parseRoster, rosterSql } from "../../../../scripts/lib/roster.mjs";
import { answer, listEntries, setPlayer } from "./entries";

const ROSTER = [
  { name: "Ann First", position: "F", rating: 60, roles: ["Admin"] },
  { name: "Ben Second", position: "D", rating: 60 },
  { name: "Cat Third", position: "F", rating: 60 },
];
const NOW = "2026-10-06T11:00:00.000Z";
let db: ReturnType<typeof createTestD1>;
let ann: number, ben: number, cat: number, event: number;

beforeEach(async () => {
  db = createTestD1();
  db.raw.exec(rosterSql(parseRoster(JSON.stringify(ROSTER)), new Date(NOW)));
  const ids = db.raw.prepare("SELECT id, name FROM members").all() as { id: number; name: string }[];
  [ann, ben, cat] = ["Ann First", "Ben Second", "Cat Third"].map((n) => ids.find((m) => m.name === n)!.id);
  db.raw.exec(
    `INSERT INTO club_events (title, starts_at, ends_at, signup_enabled, capacity)
     VALUES ('Curry night', '2026-10-24T19:00:00Z', '2026-10-24T22:00:00Z', 1, 1)`,
  );
  event = (db.raw.prepare("SELECT id FROM club_events").get() as { id: number }).id;
});
const entries = async () => (await listEntries(db, "event", [event])).get(event)!;

describe("two people at once", () => {
  it("two taps for the last place: one gets it, the other's on the waitlist", async () => {
    await Promise.all([answer(db, "event", event, ann, "in", NOW), answer(db, "event", event, ben, "in", NOW)]);
    const e = await entries();
    expect(e.going).toHaveLength(1);
    expect(e.waitlist).toHaveLength(1);
  });

  it("a place comes free just as someone new signs up: still one in", async () => {
    await answer(db, "event", event, ann, "in", NOW);
    await answer(db, "event", event, ben, "in", NOW); // waitlist
    await Promise.all([answer(db, "event", event, ann, "out", NOW), answer(db, "event", event, cat, "in", NOW)]);
    const e = await entries();
    expect(e.going).toHaveLength(1);
    expect(e.going.length + e.waitlist.length).toBe(2);
  });

  it("an admin can still put someone in past the limit", async () => {
    await answer(db, "event", event, ann, "in", NOW);
    await setPlayer(db, "event", event, ben, true, NOW);
    expect((await entries()).going).toEqual([ann, ben]);
  });
});
