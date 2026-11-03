// The name rules behind a bank reference (apps/team/worker/dues/README.md): fiddly enough to pin down on their own.
import { describe, expect, it } from "vitest";
import { createTestD1 } from "./testing/d1-sqlite";
import { REFERENCE_MAX, assignReferenceSql, referenceBase } from "./payment-reference";

describe("a member's bank reference", () => {
  it("is their first name and surname initial, in capitals", () => {
    expect(referenceBase("Adrian Kaczmarczyk")).toBe("COUGARS ADRIAN K");
    expect(referenceBase("Sam O'Neill")).toBe("COUGARS SAM O");
    expect(referenceBase("Mary Jane van der Berg")).toBe("COUGARS MARY B");
    expect(referenceBase("Prince")).toBe("COUGARS PRINCE");
  });

  it("takes only what a bank takes: accents dropped, other letters spelled out", () => {
    expect(referenceBase("Łukasz Żółć")).toBe("COUGARS LUKASZ Z");
    expect(referenceBase("José Müller")).toBe("COUGARS JOSE M");
    expect(referenceBase("  ")).toBe("COUGARS MEMBER");
  });

  it("fits in 18 characters with room for a clash digit", () => {
    const long = referenceBase("Christopher Featherstonehaugh");
    expect(long).toBe("COUGARS CHRISTO F");
    expect((long + "9").length).toBeLessThanOrEqual(REFERENCE_MAX);
  });

  it("gives a second person of the same name and initial the next number, and never changes the first", async () => {
    const { add, ref, giveAgain } = club();
    const first = await add("Sam Taylor");
    const second = await add("Sam Thomas");
    expect(ref(first)).toBe("COUGARS SAM T");
    expect(ref(second)).toBe("COUGARS SAM T2");

    await giveAgain(first, "Samuel Taylor");
    expect(ref(first)).toBe("COUGARS SAM T");
  });

  it("past nine of the same name and initial, the next is COUGARS and their member number", async () => {
    const { add, ref } = club();
    const nine = [];
    for (let i = 0; i < 9; i++) nine.push(await add("Sam Taylor"));
    expect(nine.map(ref)).toEqual(["", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => `COUGARS SAM T${n}`));
    const tenth = await add("Sam Taylor");
    expect(ref(tenth)).toBe(`COUGARS ${tenth}`);
  });
});

/** A club in D1 that gives each member added a reference, as the Worker and the roster seed do. */
function club() {
  const db = createTestD1();
  const raw = db.raw;
  const giveAgain = async (id: number, name: string) => {
    raw.prepare("UPDATE members SET name = ? WHERE id = ?").run(name, id);
    const { sql, candidates } = assignReferenceSql(name, "id = ?");
    await db
      .prepare(sql)
      .bind(...candidates, id)
      .run();
  };
  const add = async (name: string) => {
    const id = Number(
      raw
        .prepare(`INSERT INTO members (name, joined_on, created_at) VALUES (?, '2026-10-07', '2026-10-07T00:00:00Z')`)
        .run(name).lastInsertRowid,
    );
    await giveAgain(id, name);
    return id;
  };
  const ref = (id: number) =>
    (raw.prepare("SELECT payment_reference r FROM members WHERE id = ?").get(id) as { r: string }).r;
  return { add, ref, giveAgain };
}
