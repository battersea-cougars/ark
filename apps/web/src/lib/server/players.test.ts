import { describe, expect, it } from "vitest";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { publicName } from "@cougars/shared/names";
import { memberId, toPlayer } from "../roster";
import { livePlayer } from "./players";
import { ROSTER_SQL } from "../../../../../scripts/lib/roster-sql.mjs";

describe("the roster on the website", () => {
  it("shows a first name and initial, never a full name", () => {
    expect(publicName("Adrian Kowalski")).toBe("Adrian K.");
    expect(publicName("  Mary  de la Cruz ")).toBe("Mary C.");
    expect(publicName("Altai")).toBe("Altai");
  });

  it("turns a member into a card: position spelled out, bio as the quote", () => {
    const p = toPlayer({ id: 7, name: "Dana Smith", web_name: null, position: "G", bio: " Stops pucks. " });
    expect(p).toEqual({ _id: "member-7", name: "Dana S.", position: "Goalie", quote: "Stops pucks." });
    expect(memberId(p)).toBe(7);
    expect(memberId({ _id: "player-abc", name: "Sample" })).toBeNull();
    // Their own choice wins
    expect(toPlayer({ id: 8, name: "Sam Jones", web_name: "The Wall", position: "D", bio: "" }).name).toBe("The Wall");
  });

  it("gives a picked-up card the latest details, for active Cougars only", async () => {
    const db = createTestD1();
    const add = db.raw.prepare(
      `INSERT INTO members (name, web_name, position, bio, status, cougar, joined_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')`,
    );
    const cougar = Number(add.run("Sam Jones", null, "D", "Hits hard.", "active", 1).lastInsertRowid);
    const named = Number(add.run("Dee Fence", "Deefer", "D", "", "active", 1).lastInsertRowid);
    const friday = Number(add.run("Fri Day", null, "F", "", "active", 0).lastInsertRowid);
    const gone = Number(add.run("Old Timer", null, "F", "", "inactive", 1).lastInsertRowid);
    expect(await livePlayer(db, cougar)).toMatchObject({ name: "Sam J.", position: "Defence", quote: "Hits hard." });
    expect((await livePlayer(db, named))?.name).toBe("Deefer");
    expect(await livePlayer(db, friday)).toBeNull();
    expect(await livePlayer(db, gone)).toBeNull();
    expect(await livePlayer(db, 9999)).toBeNull();
  });

  it("never shows a member's photo: the build's roster and a picked-up card leave it in the database", async () => {
    const db = createTestD1();
    const sam = Number(
      db.raw
        .prepare(
          `INSERT INTO members (name, position, bio, status, cougar, photo, photo_at, joined_on, created_at)
           VALUES ('Sam Jones', 'D', '', 'active', 1, 'data:image/webp;base64,UklGRg==', '2026-10-01T00:00:00Z',
             '2026-01-01', '2026-01-01')`,
        )
        .run().lastInsertRowid,
    );
    const said = JSON.stringify([await livePlayer(db, sam), db.raw.prepare(ROSTER_SQL).all()]);
    expect(said).toContain("Sam");
    expect(said).not.toMatch(/photo|data:image/);
  });
});
