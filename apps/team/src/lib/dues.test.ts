import { describe, expect, it } from "vitest";
import { aged, bucketOf, collected, feeOn, ledger, overdue, owed, type Charge, type Payment } from "./dues";

const charge = (over: Partial<Charge>): Charge => ({
  id: 1,
  memberId: 1,
  kind: "session",
  refId: 1,
  quarter: null,
  title: null,
  seriesId: null,
  typeId: null,
  startTime: null,
  pence: 1000,
  dueOn: "2026-10-02",
  paidOn: null,
  paidVia: null,
  paidPence: 0,
  byHand: false,
  ...over,
});

describe("feeOn", () => {
  const fees = [
    { pence: 800, from: "2025-09-01" },
    { pence: 1000, from: "2026-07-01" },
  ];
  it("uses the fee in force on the day, going forward", () => {
    expect(feeOn(fees, "2026-06-30")).toBe(800);
    expect(feeOn(fees, "2026-07-01")).toBe(1000);
    expect(feeOn(fees, "2027-01-01")).toBe(1000);
  });
  it("is free before the first fee, whatever order they were added in", () => {
    expect(feeOn([...fees].reverse(), "2025-01-01")).toBe(0);
    expect(feeOn([...fees].reverse(), "2026-08-01")).toBe(1000);
  });
});

describe("bucketOf", () => {
  it("counts London days across the clock change", () => {
    expect(bucketOf("2026-09-25", "2026-10-26")).toBe(1); // 31 days, BST ends on the 25th
  });
});

describe("aged", () => {
  const today = "2026-10-06";
  const charges = [
    charge({ id: 1, memberId: 1, dueOn: "2026-10-02" }),
    charge({ id: 2, memberId: 1, dueOn: "2026-08-01" }),
    charge({ id: 3, memberId: 2, dueOn: "2026-10-02", pence: 2500 }),
    charge({ id: 4, memberId: 3, dueOn: "2026-06-01", paidOn: "2026-06-05", paidVia: "cash" }),
  ];
  it("adds up only unpaid charges, per member and by age", () => {
    const rows = aged(charges, today);
    expect(rows.map((r) => r.memberId)).toEqual([1, 2]);
    expect(rows[0]).toEqual({ memberId: 1, amounts: [1000, 0, 1000, 0], total: 2000, oldest: 2 });
    expect(rows[1].total).toBe(2500);
  });
  it("puts the oldest debt first, then the biggest", () => {
    const rows = aged([...charges, charge({ id: 5, memberId: 4, dueOn: "2026-10-01", pence: 9000 })], today);
    expect(rows.map((r) => r.memberId)).toEqual([1, 4, 2]);
  });
  it("matches what each member owes", () => {
    for (const r of aged(charges, today)) expect(r.total).toBe(owed(charges, r.memberId));
  });
});

describe("overdue", () => {
  it("is what's left on charges whose day has passed: tonight's isn't late yet, a part paid one is what's to go", () => {
    const charges = [
      charge({ id: 1, dueOn: "2026-10-06" }),
      charge({ id: 2, dueOn: "2026-10-05", paidPence: 400 }),
      charge({ id: 3, dueOn: "2026-09-01", paidOn: "2026-09-02", paidVia: "cash" }),
      charge({ id: 4, memberId: 2, dueOn: "2026-09-01" }),
    ];
    expect(overdue(charges, 1, "2026-10-06")).toBe(600);
    expect(overdue(charges, 1, "2026-10-07")).toBe(1600);
    expect(overdue([charges[0]], 1, "2026-10-06")).toBe(0);
  });
});

describe("collected", () => {
  it("shows what a session was due and what it brought in", () => {
    const charges = [
      charge({ id: 1, memberId: 1, refId: 7 }),
      charge({ id: 2, memberId: 2, refId: 7, paidOn: "2026-10-03", paidVia: "transfer" }),
      charge({ id: 3, memberId: 3, refId: 7, paidOn: "2026-10-03", paidVia: "cash" }),
      charge({ id: 4, memberId: 3, refId: 8 }),
      charge({ id: 5, memberId: 3, kind: "tournament", refId: 7, pence: 1500 }),
    ];
    expect(collected(charges, "session", 7)).toEqual({ due: 3000, paid: 2000, people: 3, paidPeople: 2 });
  });
});

describe("ledger", () => {
  const pay = (id: number, pence: number, receivedOn: string): Payment => ({
    id,
    memberId: 1,
    pence,
    receivedOn,
    via: "transfer",
  });
  const summary = (lines: ReturnType<typeof ledger>) => lines.map((l) => [l.kind, l.on, l.pence, l.balance]);

  it("runs a balance from the oldest, shown newest first; below nothing is credit", () => {
    const lines = ledger(
      [charge({ id: 1, dueOn: "2026-09-25", pence: 1200 }), charge({ id: 2, dueOn: "2026-10-02", pence: 1200 })],
      [pay(1, 3000, "2026-09-28")],
    );
    expect(summary(lines)).toEqual([
      ["charge", "2026-10-02", 1200, -600],
      ["payment", "2026-09-28", 3000, -1800],
      ["charge", "2026-09-25", 1200, 1200],
    ]);
  });

  it("on one day, the charge comes before its payment, so a night paid on the night nets out", () => {
    const lines = ledger([charge({ id: 9, dueOn: "2026-10-02", pence: 1200 })], [pay(1, 1200, "2026-10-02")]);
    expect(summary(lines)).toEqual([
      ["payment", "2026-10-02", 1200, 0],
      ["charge", "2026-10-02", 1200, 1200],
    ]);
  });

  it("nothing yet: no lines", () => {
    expect(ledger([], [])).toEqual([]);
  });
});
