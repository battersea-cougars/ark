// Dues' pure sums at their edges (ADR 0007): quarters at the turn of the year, the day a fee starts, Unpaid fees'
// buckets on the exact day, leap years, and charges paid in part or past what they cost.
import { describe, expect, it } from "vitest";
import {
  aged,
  bucketOf,
  collected,
  daysBetween,
  feeOn,
  leftOn,
  ledger,
  nextQuarter,
  owed,
  quarterMonths,
  quarterOf,
  quarterStart,
  type Charge,
} from "./dues";

const charge = (o: Partial<Charge>): Charge => ({
  id: 1,
  memberId: 1,
  kind: "session",
  refId: 10,
  quarter: null,
  title: null,
  seriesId: null,
  typeId: null,
  startTime: null,
  pence: 800,
  dueOn: "2026-10-02",
  paidOn: null,
  paidVia: null,
  paidPence: 0,
  byHand: false,
  ...o,
});

describe("quarters", () => {
  it("each quarter's first and last day belong to it", () => {
    expect(["2026-01-01", "2026-03-31", "2026-04-01", "2026-06-30"].map(quarterOf)).toEqual([
      "2026-Q1",
      "2026-Q1",
      "2026-Q2",
      "2026-Q2",
    ]);
    expect(["2026-07-01", "2026-09-30", "2026-10-01", "2026-12-31"].map(quarterOf)).toEqual([
      "2026-Q3",
      "2026-Q3",
      "2026-Q4",
      "2026-Q4",
    ]);
    expect(quarterOf("2028-02-29")).toBe("2028-Q1");
  });

  it("the quarter after the last of the year is the first of the next, and starts on 1 January", () => {
    expect(nextQuarter("2026-Q4")).toBe("2027-Q1");
    expect(quarterStart(nextQuarter("2026-Q4"))).toBe("2027-01-01");
    expect(nextQuarter("2026-Q3")).toBe("2026-Q4");
    expect(quarterStart("2026-Q4")).toBe("2026-10-01");
  });

  it("a quarter's months read in plain words", () => {
    expect(["2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4"].map(quarterMonths)).toEqual([
      "Jan–Mar 2027",
      "Apr–Jun 2027",
      "Jul–Sep 2027",
      "Oct–Dec 2027",
    ]);
  });
});

describe("the fee on a day", () => {
  const fees = [
    { pence: 800, from: "2026-01-01" },
    { pence: 1000, from: "2026-10-02" },
  ];
  it("a fee is in force on the day it starts, not the day before", () => {
    expect(feeOn(fees, "2026-10-01")).toBe(800);
    expect(feeOn(fees, "2026-10-02")).toBe(1000);
  });
  it("a fee set to nothing is nothing from then on", () => {
    expect(feeOn([...fees, { pence: 0, from: "2026-11-01" }], "2026-12-01")).toBe(0);
  });
  it("no fees at all is free", () => {
    expect(feeOn([], "2026-10-02")).toBe(0);
  });
});

describe("Unpaid fees' buckets on the exact day", () => {
  it("30 days is the first bucket, 31 the second; 60 and 61; 90 and 91", () => {
    const today = "2026-12-31";
    const ago = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    expect([0, 30, 31, 60, 61, 90, 91, 400].map((n) => bucketOf(ago(n), today))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
  it("a charge due later than today (a payment dated ahead) is in the first bucket", () => {
    expect(bucketOf("2026-10-09", "2026-10-06")).toBe(0);
  });
  it("counts 29 February in a leap year, and not in another", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2027-02-28", "2027-03-01")).toBe(1);
    expect(daysBetween("2027-12-31", "2028-12-31")).toBe(366);
  });
  it("the spring clock change is a day, not 23 hours", () => {
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
  });
});

describe("what's left on a charge", () => {
  it("part paid: what's left; paid in full: nothing", () => {
    expect(leftOn(charge({ paidPence: 301 }))).toBe(499);
    expect(leftOn(charge({ paidPence: 800, paidOn: "2026-10-02" }))).toBe(0);
  });
  it("paid past what it costs (a fee gone down, not yet given back): nothing, never below", () => {
    expect(leftOn(charge({ pence: 600, paidPence: 800 }))).toBe(0);
  });
  it("Unpaid fees counts what's left of a charge paid in part, and what someone owes agrees", () => {
    const charges = [
      charge({ id: 1, paidPence: 300 }),
      charge({ id: 2, dueOn: "2026-06-01", pence: 1201 }),
      charge({ id: 3, memberId: 2, paidPence: 800, paidOn: "2026-10-02" }),
    ];
    expect(aged(charges, "2026-10-06")).toEqual([{ memberId: 1, amounts: [500, 0, 0, 1201], total: 1701, oldest: 3 }]);
    expect(owed(charges, 1)).toBe(1701);
    expect(owed(charges, 2)).toBe(0);
  });
  it("a session part paid has collected only what's been paid", () => {
    expect(collected([charge({ paidPence: 299 }), charge({ id: 2, memberId: 2 })], "session", 10)).toEqual({
      due: 1600,
      paid: 299,
      people: 2,
      paidPeople: 0,
    });
  });
});

describe("the ledger", () => {
  it("two charges on one day go in the order they were made, then the day's payment", () => {
    const lines = ledger(
      [charge({ id: 2, pence: 500 }), charge({ id: 1, pence: 800 })],
      [{ id: 1, memberId: 1, pence: 1300, receivedOn: "2026-10-02", via: "cash" }],
    );
    expect(lines.map((l) => [l.kind, l.pence, l.balance])).toEqual([
      ["payment", 1300, 0],
      ["charge", 500, 1300],
      ["charge", 800, 800],
    ]);
  });
  it("credit before any charge runs below nothing, then back up", () => {
    const lines = ledger(
      [charge({ dueOn: "2026-10-02" })],
      [{ id: 1, memberId: 1, pence: 1000, receivedOn: "2026-09-01", via: "adjustment", reason: "Reffed" }],
    );
    expect(lines.map((l) => l.balance)).toEqual([-200, -1000]);
  });
});
