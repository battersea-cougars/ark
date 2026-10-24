// What members owe, read without every charge and payment there has been (#177, ADR 0007): opening the app sends
// your own unpaid charges and a line per member of what they owe, by age (Unpaid fees); a member's ledger is read a
// page at a time, newest first, each line with what they owed after it. Balances must come out exactly as the whole
// ledger worked out in one go does (lib/dues.ts ledger and aged, the sums the app used to do itself), for members in
// credit, part paid, adjusted either way and with a payment taken back, however the pages fall. Driven through the
// real Worker handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, onTheNight, testWorld } from "../testing";
import { aged, collected, ledger, type Charge, type Payment } from "../../src/lib/dues";
import { ledgerOf, owedLines } from "./dues.testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Paul Payg", position: "F", rating: 55, email: "paul@example.com" },
  { name: "Cleo Credit", position: "D", rating: 52, email: "cleo@example.com" },
  { name: "Ada Adjusted", position: "F", rating: 50, email: "ada@example.com" },
];
// NOW is Tuesday 6 October 2026: ten Fridays behind it, from 31 July (over 60 days back) to 2 October
const FRIDAYS = Array.from(
  { length: 10 },
  (_, i) => new Date(Date.parse("2026-07-31T12:00:00Z") + i * 7 * 86_400_000),
).map((d) => d.toISOString().slice(0, 10));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/**
 * A season of dues: everyone at every Friday at £8.50 (odd pence), then Reg pays some (part of a night), Paul pays it
 * all, Cleo pays more than she owes (credit) and Ada is adjusted both ways, a cash payment of hers taken back.
 */
async function season() {
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.club()).body as Json;
  const id = Object.fromEntries(boot.members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
  const series = boot.series[0];
  const fee = { ...series, fees: [{ pence: 850, from: "2026-01-01" }] };
  expect((await dana.call("PUT", `/api/series/${series.id}`, fee)).status).toBe(200);
  const sessions = (await dana.club()).body.sessions as Json[];
  const players = ["Reg", "Paul", "Cleo", "Ada"].map((n) => ({ memberId: id[n], in: true }));
  for (const day of FRIDAYS.slice(-4)) {
    const s = sessions.find((x) => x.heldOn === day);
    expect(
      (await dana.call("POST", `/api/sessions/${s.id}/players`, { players }, { now: onTheNight(day) })).status,
    ).toBe(200);
  }
  // The older Fridays, before the weeks the app shows, as the register left them
  const older = w.db.raw.prepare(
    `INSERT INTO attendance (session_id, member_id, signup, signed_up_at, attended)
     SELECT s.id, ?, 'in', ?, 1 FROM training_sessions s WHERE s.held_on = ?`,
  );
  for (const day of FRIDAYS.slice(0, -4))
    for (const n of ["Reg", "Paul", "Cleo", "Ada"]) older.run(id[n], NOW.toISOString(), day);
  await w.scheduled("7 * * * *", NOW);
  const pay = (who: string, pence: number, receivedOn?: string) =>
    dana.call("POST", `/api/members/${id[who]}/payments`, { via: "transfer", pence, receivedOn });
  expect((await pay("Reg", 2000, "2026-08-20")).status).toBe(200);
  expect((await pay("Paul", 4000, "2026-09-01")).status).toBe(200);
  expect((await pay("Paul", 4500)).status).toBe(200);
  expect((await pay("Cleo", 10_000, "2026-09-15")).status).toBe(200);
  const adjust = (pence: number, reason: string, on: string) =>
    dana.call("POST", `/api/members/${id.Ada}/adjustments`, { pence, reason, on });
  expect((await adjust(-1200, "Reffed the Kumite", "2026-09-04")).status).toBe(201);
  expect((await adjust(300, "Lost a puck", "2026-09-04")).status).toBe(201);
  const cash = await dana.call("POST", `/api/members/${id.Ada}/payments`, { via: "cash", pence: 900 });
  expect(cash.status).toBe(200);
  const mistaken = w.db.raw.prepare("SELECT MAX(id) id FROM payments WHERE member_id = ?").get(id.Ada) as Json;
  expect((await dana.call("DELETE", `/api/payments/${mistaken.id}`)).status).toBe(200);
  return { dana, id };
}

/** A member's charges and payments straight from D1, as the app was sent them all before (lib/dues.ts shapes). */
function everything(memberId: number): { charges: Charge[]; payments: Payment[] } {
  const charges = w.db.raw
    .prepare(
      `SELECT c.id, c.member_id memberId, c.amount_pence pence, c.due_on dueOn,
              COALESCE((SELECT SUM(amount_pence) FROM payment_allocations WHERE charge_id = c.id), 0) paidPence,
              CASE WHEN c.session_id IS NOT NULL THEN 'session' WHEN c.reason IS NOT NULL THEN 'adjustment'
                ELSE 'quarter' END kind, c.session_id refId
       FROM charges c WHERE c.member_id = ?`,
    )
    .all(memberId) as Json[];
  const payments = w.db.raw
    .prepare(
      "SELECT id, member_id memberId, amount_pence pence, received_on receivedOn, via FROM payments WHERE member_id = ?",
    )
    .all(memberId) as Payment[];
  return {
    charges: charges.map((c) => ({ ...c, paidOn: c.paidPence >= c.pence ? "paid" : null })),
    payments,
  };
}
const lineKey = (l: { kind: string; charge?: { id: number }; payment?: { id: number }; balance: number }) =>
  `${l.kind} ${l.kind === "charge" ? l.charge!.id : l.payment!.id} ${l.balance}`;

describe("a member's ledger, a page at a time", () => {
  it("each line's balance is what the whole ledger works out, for every member, whatever the page size", async () => {
    const { dana, id } = await season();
    for (const name of ["Reg", "Paul", "Cleo", "Ada", "Dana"]) {
      const all = everything(id[name]);
      const whole = ledger(all.charges, all.payments).map(lineKey);
      for (const limit of [1, 3, 7, 30])
        expect((await ledgerOf(dana, id[name], NOW, limit)).map(lineKey), `${name}, ${limit} a page`).toEqual(whole);
    }
  });

  it("a member reads their own; the first page says what they've paid in all and the quarters charged", async () => {
    const { id } = await season();
    const reg = await w.signedIn("reg@example.com");
    const first = (await reg.call("GET", `/api/members/${id.Reg}/ledger?limit=2`)).body;
    expect(first).toMatchObject({ paid: 2000, quarters: [] });
    expect(first.lines).toHaveLength(2);
    // Ten nights at £8.50, £20 paid: £65 owed, the newest line first
    expect(first.lines[0]).toMatchObject({ kind: "charge", balance: 6500 });
    const next = (await reg.call("GET", `/api/members/${id.Reg}/ledger?limit=2&before=${first.next}`)).body;
    expect(next).not.toHaveProperty("paid");
    expect((await reg.call("GET", `/api/members/${id.Paul}/ledger`)).status).toBe(403);
    expect((await reg.call("GET", `/api/members/${id.Reg}/ledger?before=yesterday`)).status).toBe(400);
  });

  it("asked again unchanged it's an empty 304; after a payment, it's read again", async () => {
    const { dana, id } = await season();
    const path = `/api/members/${id.Reg}/ledger`;
    const res = await dana.open("GET", path);
    const tag = res.headers.get("etag")!;
    expect((await dana.open("GET", path, { headers: { "if-none-match": tag } })).status).toBe(304);
    await dana.call("POST", `/api/members/${id.Reg}/payments`, { via: "cash", pence: 500 });
    expect((await dana.open("GET", path, { headers: { "if-none-match": tag } })).status).toBe(200);
  });
});

describe("opening the app", () => {
  it("sends your own unpaid charges and what you owe, not your paid ones or anyone else's", async () => {
    const { id } = await season();
    const paul = (await (await w.signedIn("paul@example.com")).club()).body;
    expect(paul.charges).toEqual([]);
    expect(paul.dues).toEqual([]);
    expect(paul).not.toHaveProperty("payments");
    const reg = (await (await w.signedIn("reg@example.com")).club()).body;
    const unpaid = everything(id.Reg).charges.filter((c) => !c.paidOn);
    expect((reg.charges as Charge[]).map((c) => c.id).sort()).toEqual(unpaid.map((c) => c.id).sort());
    expect((reg.charges as Charge[]).find((c) => c.paidPence > 0)).toMatchObject({ pence: 850, paidPence: 300 });
    expect(reg.dues.map((d: Json) => d.memberId)).toEqual([id.Reg]);
  });

  it("an admin's Unpaid fees is what everyone's whole list adds up to, by age, worst first, with credit beside it", async () => {
    const { dana, id } = await season();
    const all = Object.values(id).flatMap((m) => everything(m).charges);
    const expected = aged(all, "2026-10-06");
    const lines = await owedLines(dana);
    expect(
      lines
        .filter((l) => l.owed > 0)
        .map(({ memberId, amounts, owed, oldest }) => ({ memberId, amounts, total: owed, oldest })),
    ).toEqual(expected);
    // Cleo paid £100 for £85: £15 credit, nothing owed; Paul paid it all: not on the list
    expect(lines.find((l) => l.memberId === id.Cleo)).toMatchObject({ owed: 0, credit: 1500 });
    expect(lines.find((l) => l.memberId === id.Paul)).toBeUndefined();
    // What's overdue: everything due before today
    for (const l of lines) expect(l.overdue).toBe(l.owed);
  });

  it("stays the same size with weeks more history paid off", async () => {
    const { dana, id } = await season();
    const size = async () => JSON.stringify((await dana.club()).body.dues).length;
    const before = await size();
    expect((await dana.call("POST", `/api/members/${id.Reg}/payments`, { via: "cash", pence: 6500 })).status).toBe(200);
    expect((await dana.call("POST", `/api/members/${id.Ada}/payments`, { via: "cash", pence: 10_000 })).status).toBe(
      200,
    );
    expect(await size()).toBeLessThan(before);
  });
});

describe("what a night collected, for its editor", () => {
  it("is each night's charges added up, as the whole list did; how many were charged for anyone who edits it", async () => {
    const { dana, id } = await season();
    const all = Object.values(id).flatMap((m) => everything(m).charges);
    const sessions = [...new Set(all.filter((c) => c.kind === "session").map((c) => c.refId!))].sort((a, b) => a - b);
    const res = (await dana.call("GET", `/api/dues/collected?sessions=${sessions.join(",")}`)).body;
    expect(res.sessions).toEqual(sessions.map((s) => ({ refId: s, ...collected(all, "session", s) })));
    const reg = await w.signedIn("reg@example.com");
    const theirs = (await reg.call("GET", `/api/dues/collected?sessions=${sessions[0]}`)).body;
    expect(theirs.sessions).toEqual([{ refId: sessions[0], people: 4, due: 0, paid: 0, paidPeople: 0 }]);
  });
});
