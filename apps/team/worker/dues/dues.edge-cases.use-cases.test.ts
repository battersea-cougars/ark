// Dues at the edges (ADR 0007): money to the penny (a payment that just covers a charge, a penny, a lump sum split over
// odd pence, credit nobody else can spend), what an admin can't get wrong (amounts, days, quarters, fees), the quarter
// turning over in London time, and who may touch money at all (ADR 0024). Driven through the real Worker handlers in
// the fake world (ADR 0031); the hourly Cron Trigger is chargeDue, called as the Worker's scheduled handler calls it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chargeDue } from "./dues";
import { NOW, testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Dot Door", position: "F", rating: 50, email: "dot@example.com", roles: ["Session lead"] },
  { name: "Tess Treasurer", position: "F", rating: 50, email: "tess@example.com" },
  { name: "Val Viewer", position: "F", rating: 50, email: "val@example.com" },
];

// NOW is Tuesday 6 October 2026: the Fridays before it are 18 and 25 September and 2 October
const FRIDAYS = ["2026-09-18", "2026-09-25", "2026-10-02"];

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
interface Charge {
  id: number;
  memberId: number;
  kind: string;
  quarter: string | null;
  title: string | null;
  pence: number;
  dueOn: string;
  paidOn: string | null;
  paidPence: number;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  // A treasurer records payments but doesn't set fees; a viewer only sees Unpaid fees (roles are data, ADR 0024)
  w.db.raw.exec(`INSERT INTO roles (id, name, description, is_system) VALUES
      (8, 'Treasurer', 'Records payments', 0), (9, 'Viewer', 'Sees dues', 0);
    INSERT INTO role_actions (role_id, action) VALUES (8, 'record:Payment'), (9, 'read:Dues');
    INSERT INTO member_roles (member_id, role_id) SELECT id, 8 FROM members WHERE email = 'tess@example.com';
    INSERT INTO member_roles (member_id, role_id) SELECT id, 9 FROM members WHERE email = 'val@example.com';`);
});

const boot = async (b: Browser, now = NOW) => (await b.call("GET", "/api/bootstrap", undefined, { now })).body;
const memberId = async (b: Browser, name: string) =>
  (await boot(b)).members.find((m: { name: string }) => m.name === name).id as number;
const sessionOn = async (b: Browser, day: string) =>
  (await boot(b)).sessions.find((s: { heldOn: string }) => s.heldOn === day).id as number;
const chargesOf = async (b: Browser, id: number, now = NOW) =>
  ((await boot(b, now)).charges as Charge[]).filter((c) => c.memberId === id);
/** What each of a member's payments has left to spend: their credit. */
const credit = (id: number) =>
  (
    w.db.raw
      .prepare(
        `SELECT COALESCE(SUM(p.amount_pence - COALESCE((SELECT SUM(amount_pence) FROM payment_allocations
           WHERE payment_id = p.id), 0)), 0) n FROM payments p WHERE p.member_id = ?`,
      )
      .get(id) as { n: number }
  ).n;
/** Signed in on another day: a session from today would have run out by then. */
async function signedInAt(email: string, now: Date) {
  const b = w.browser();
  const { devCode } = await w.ask(b, email, now);
  expect((await b.call("POST", "/api/auth/verify", { code: devCode }, { now })).status).toBe(200);
  return b;
}
const paymentsOf = (id: number) =>
  w.db.raw.prepare("SELECT amount_pence pence, via FROM payments WHERE member_id = ? ORDER BY id").all(id);

/** Friday Training costs this much a session, from this day on. */
async function fridayFee(dana: Browser, pence: number, from = "2026-01-01") {
  const series = (await boot(dana)).series[0];
  const r = await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [{ pence, from }] });
  expect(r.status).toBe(200);
}

/** Reg came to these Fridays, at this fee. */
async function came(pence: number, days = FRIDAYS) {
  const dana = await w.signedIn("dana@example.com");
  await fridayFee(dana, pence);
  const reg = await memberId(dana, "Reg Player");
  for (const day of days)
    expect(
      (await dana.call("POST", `/api/sessions/${await sessionOn(dana, day)}/register`, { memberId: reg, here: true }))
        .status,
    ).toBe(200);
  const pay = (pence: number, more: Record<string, unknown> = {}, b = dana) =>
    b.call("POST", `/api/members/${reg}/payments`, { via: "transfer", pence, ...more });
  return { dana, reg, pay };
}

describe("paying, to the penny", () => {
  it("a payment of exactly what a night costs pays it in full, and leaves no credit", async () => {
    const { dana, reg, pay } = await came(800, [FRIDAYS[2]]);
    expect((await pay(800)).status).toBe(200);
    expect(await chargesOf(dana, reg)).toEqual([expect.objectContaining({ pence: 800, paidPence: 800 })]);
    expect((await chargesOf(dana, reg))[0].paidOn).not.toBeNull();
    expect(credit(reg)).toBe(0);
  });

  it("a penny pays a penny of the oldest night, and nothing else", async () => {
    const { dana, reg, pay } = await came(800);
    expect((await pay(1)).status).toBe(200);
    expect((await chargesOf(dana, reg)).map((c) => [c.dueOn, c.paidPence, c.paidOn])).toEqual([
      ["2026-10-02", 0, null],
      ["2026-09-25", 0, null],
      ["2026-09-18", 1, null],
    ]);
  });

  it("a lump sum over nights of odd pence pays each in full, oldest first, and the penny over is credit", async () => {
    const { dana, reg, pay } = await came(333);
    expect((await pay(1000)).status).toBe(200);
    expect((await chargesOf(dana, reg)).map((c) => c.paidPence)).toEqual([333, 333, 333]);
    expect(credit(reg)).toBe(1);
  });

  it("credit is the member's own: it never pays anyone else's dues", async () => {
    const { dana, reg, pay } = await came(800, [FRIDAYS[2]]);
    const danaId = await memberId(dana, "Dana Admin");
    await dana.call("POST", `/api/sessions/${await sessionOn(dana, FRIDAYS[2])}/register`, {
      memberId: danaId,
      here: true,
    });
    expect((await pay(5000)).status).toBe(200);
    expect(credit(reg)).toBe(4200);
    expect(await chargesOf(dana, danaId)).toEqual([expect.objectContaining({ paidPence: 0, paidOn: null })]);
  });

  it("credit from an adjustment, owed nothing, pays the next night as it comes", async () => {
    const { dana, reg } = await came(800, []);
    expect(
      (await dana.call("POST", `/api/members/${reg}/adjustments`, { pence: -1000, reason: "Reffed" })).status,
    ).toBe(201);
    expect(credit(reg)).toBe(1000);
    await dana.call("POST", `/api/sessions/${await sessionOn(dana, FRIDAYS[2])}/register`, {
      memberId: reg,
      here: true,
    });
    expect(await chargesOf(dana, reg)).toEqual([expect.objectContaining({ paidPence: 800 })]);
    expect(credit(reg)).toBe(200);
  });

  it("marking a night paid twice in a row records one payment, not two", async () => {
    const { dana, reg } = await came(800, [FRIDAYS[2]]);
    const [night] = await chargesOf(dana, reg);
    for (let i = 0; i < 2; i++)
      expect((await dana.call("POST", `/api/charges/${night.id}/payment`, { via: "cash" })).status).toBe(200);
    expect(paymentsOf(reg)).toEqual([{ pence: 800, via: "cash" }]);
  });

  it("marking a night paid that credit already paid part of records only what was left", async () => {
    const { dana, reg, pay } = await came(800, [FRIDAYS[2]]);
    await pay(500);
    const [night] = await chargesOf(dana, reg);
    expect((await dana.call("POST", `/api/charges/${night.id}/payment`, { via: "cash" })).status).toBe(200);
    expect(paymentsOf(reg)).toEqual([
      { pence: 500, via: "transfer" },
      { pence: 300, via: "cash" },
    ]);
    expect(credit(reg)).toBe(0);
  });

  it("marking a night unpaid that was never paid changes nothing", async () => {
    const { dana, reg } = await came(800, [FRIDAYS[2]]);
    const [night] = await chargesOf(dana, reg);
    expect((await dana.call("DELETE", `/api/charges/${night.id}/payment`)).status).toBe(200);
    expect(await chargesOf(dana, reg)).toEqual([expect.objectContaining({ pence: 800, paidPence: 0 })]);
  });

  it("a night paid in part, then unticked, goes, and what was paid on it is credit again", async () => {
    const { dana, reg, pay } = await came(800, FRIDAYS.slice(1));
    await pay(1200); // the 25th in full, £4 of the 2nd
    expect((await chargesOf(dana, reg)).map((c) => [c.dueOn, c.paidPence])).toEqual([
      ["2026-10-02", 400],
      ["2026-09-25", 800],
    ]);
    await dana.call("POST", `/api/sessions/${await sessionOn(dana, FRIDAYS[2])}/register`, {
      memberId: reg,
      here: false,
    });
    expect((await chargesOf(dana, reg)).map((c) => c.dueOn)).toEqual(["2026-09-25"]);
    expect(credit(reg)).toBe(400);
  });

  it("a fee taken down to nothing gives back what the nights were paid, as credit, and they're off the ledger", async () => {
    const { dana, reg, pay } = await came(800);
    await pay(1600);
    await fridayFee(dana, 0);
    expect(await chargesOf(dana, reg)).toEqual([]);
    expect(credit(reg)).toBe(1600);
  });
});

describe("what an admin can't get wrong", () => {
  it("a payment needs a whole, positive number of pence, up to £10,000, and says how it came", async () => {
    const { reg, pay } = await came(800, [FRIDAYS[2]]);
    for (const pence of ["800", 8.5, 0, -100, null, 1_000_001, true])
      expect((await pay(pence as number)).status, `pence ${String(pence)}`).toBe(400);
    for (const via of ["card", "", undefined, "adjustment"])
      expect((await pay(800, { via })).status, `via ${String(via)}`).toBe(400);
    expect(paymentsOf(reg)).toEqual([]);
    expect((await pay(1_000_000)).status).toBe(200);
    expect(credit(reg)).toBe(1_000_000 - 800);
  });

  it("a payment can be dated a leap day once it's past", async () => {
    const { reg, pay } = await came(800, []);
    // Today it's still in the future
    expect((await pay(800, { receivedOn: "2028-02-29" })).status).toBe(400);
    const payment = { via: "cash", pence: 800, receivedOn: "2028-02-29" };
    const now = new Date("2028-03-01T12:00:00Z");
    const dana = await signedInAt("dana@example.com", now);
    expect((await dana.call("POST", `/api/members/${reg}/payments`, payment, { now })).status).toBe(200);
    expect(w.db.raw.prepare("SELECT received_on d FROM payments").all()).toEqual([{ d: "2028-02-29" }]);
  });

  // A day that wasn't on the calendar was taken as written (Date.parse rolls 30 February on to 2 March), so the
  // ledger, Unpaid fees' ages and the audit log showed a day that never was (#120, fixed with #129's dates)
  it(
    "a payment dated a day that doesn't exist (30 February, 29 February 2027) is refused (#120)",
    async () => {
      const { reg, pay } = await came(800, []);
      expect((await pay(800, { receivedOn: "2026-02-30" })).status).toBe(400);
      expect((await pay(800, { receivedOn: "2026-04-31" })).status).toBe(400);
      expect(paymentsOf(reg)).toEqual([]);
    },
  );

  it("a payment, charge or adjustment for nobody, or a charge or payment that isn't there, is a 404", async () => {
    const dana = await w.signedIn("dana@example.com");
    const calls: [string, string, unknown?][] = [
      ["POST", "/api/members/9999/payments", { via: "cash", pence: 100 }],
      ["POST", "/api/members/9999/charges", { quarter: "2026-Q4", pence: 100 }],
      ["POST", "/api/members/9999/adjustments", { pence: 100, reason: "Who?" }],
      ["POST", "/api/members/9999/recalculate"],
      ["DELETE", "/api/charges/9999"],
      ["POST", "/api/charges/9999/payment", { via: "cash" }],
      ["DELETE", "/api/charges/9999/payment"],
      ["DELETE", "/api/payments/9999"],
    ];
    for (const [method, path, payload] of calls)
      expect((await dana.call(method, path, payload)).status, `${method} ${path}`).toBe(404);
  });

  it("a night's charge can't be taken back by hand (change who came instead), nor a quarter once it's part paid", async () => {
    const { dana, reg, pay } = await came(800, [FRIDAYS[2]]);
    const [night] = await chargesOf(dana, reg);
    expect((await dana.call("DELETE", `/api/charges/${night.id}`)).status).toBe(409);
    const q = await dana.call("POST", `/api/members/${reg}/charges`, { quarter: "2026-Q3", pence: 5000 });
    expect(q.status).toBe(201);
    await pay(100);
    expect((await dana.call("DELETE", `/api/charges/${q.body.id}`)).body).toEqual({
      error: "It's paid: mark it unpaid first.",
    });
    expect((await chargesOf(dana, reg)).map((c) => c.kind).sort()).toEqual(["quarter", "session"]);
  });

  it("a quarter charged by hand is named like 2026-Q3, for something, and only once", async () => {
    const { dana, reg } = await came(800, []);
    const charge = (o: Record<string, unknown>) => dana.call("POST", `/api/members/${reg}/charges`, o);
    for (const quarter of ["2026-Q0", "2026-Q5", "2026-q1", "2026Q1", "", 2026, undefined])
      expect((await charge({ quarter, pence: 100 })).status, `quarter ${String(quarter)}`).toBe(400);
    for (const pence of [0, -1, 1.5, "100", 100_001])
      expect((await charge({ quarter: "2026-Q1", pence })).status, `pence ${String(pence)}`).toBe(400);
    expect((await charge({ quarter: "2026-Q1", pence: 100_000 })).status).toBe(201);
    expect((await charge({ quarter: "2026-Q1", pence: 100 })).status).toBe(409);
  });

  it("an adjustment's reason is up to 120 characters, its spaces tidied, its accents and emoji kept", async () => {
    const { dana, reg } = await came(800, []);
    const adjust = (o: Record<string, unknown>) => dana.call("POST", `/api/members/${reg}/adjustments`, o);
    expect((await adjust({ pence: 100, reason: "x".repeat(121) })).status).toBe(400);
    expect((await adjust({ pence: 100, reason: "x".repeat(120) })).status).toBe(201);
    const r = await adjust({ pence: 100, reason: "  Zoë's   stick 🏒\n broke  " });
    expect(r).toMatchObject({ status: 201, body: { reason: "Zoë's stick 🏒 broke" } });
    expect((await chargesOf(dana, reg)).map((c) => c.title)).toContain("Zoë's stick 🏒 broke");
  });

  it("an adjustment is whole pence, up to £10,000 either way, never a string or nothing", async () => {
    const { dana, reg } = await came(800, []);
    const adjust = (pence: unknown) => dana.call("POST", `/api/members/${reg}/adjustments`, { pence, reason: "Kit" });
    for (const pence of ["500", 1.5, 0, null, 1_000_001, -1_000_001])
      expect((await adjust(pence)).status, `pence ${String(pence)}`).toBe(400);
    expect((await adjust(1_000_000)).status).toBe(201);
    expect((await adjust(-1_000_000)).status).toBe(201);
    expect(credit(reg)).toBe(0);
  });

  it("a fee is whole pence from a day, up to £1,000, one per day", async () => {
    const dana = await w.signedIn("dana@example.com");
    const series = (await boot(dana)).series[0];
    const fees = (fees: unknown) => dana.call("PUT", `/api/series/${series.id}`, { ...series, fees });
    for (const bad of [
      [{ pence: -1, from: "2026-01-01" }],
      [{ pence: 12.5, from: "2026-01-01" }],
      [{ pence: 100_001, from: "2026-01-01" }],
      [{ pence: "800", from: "2026-01-01" }],
      [{ pence: 800, from: "1 January" }],
      [{ pence: 800 }],
      [
        { pence: 800, from: "2026-01-01" },
        { pence: 900, from: "2026-01-01" },
      ],
      Array.from({ length: 101 }, (_, i) => ({ pence: 800, from: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` })),
      "800",
    ])
      expect((await fees(bad)).status, JSON.stringify(bad).slice(0, 60)).toBe(400);
    for (const bad of [
      { pence: -1, from: "2026-10-01" },
      { pence: 100, from: "" },
      { pence: 100_001, from: "2026-10-01" },
    ])
      expect((await dana.call("POST", "/api/subscription-fees", bad)).status).toBe(400);
    expect((await dana.call("POST", "/api/subscription-fees", { pence: 100_000, from: "2026-10-01" })).status).toBe(
      200,
    );
  });
});

describe("the quarter turning over, in London", () => {
  const quarters = (id: number) =>
    (
      w.db.raw.prepare("SELECT quarter, due_on d FROM charges WHERE member_id = ? ORDER BY quarter").all(id) as {
        quarter: string;
        d: string;
      }[]
    ).map((r) => `${r.quarter} ${r.d}`);

  async function quarterly() {
    const dana = await w.signedIn("dana@example.com");
    const reg = await memberId(dana, "Reg Player");
    expect((await dana.call("POST", `/api/members/${reg}/quarterly`, { quarterly: true })).status).toBe(200);
    expect(quarters(reg)).toEqual(["2026-Q4 2026-10-06"]);
    return reg;
  }

  it("a Quarterly Member's January is charged at midnight on New Year's Eve, not a minute before (GMT)", async () => {
    const reg = await quarterly();
    await chargeDue(w.env, new Date("2026-12-31T23:59:00Z"));
    expect(quarters(reg)).toEqual(["2026-Q4 2026-10-06"]);
    await chargeDue(w.env, new Date("2027-01-01T00:00:00Z"));
    expect(quarters(reg)).toEqual(["2026-Q4 2026-10-06", "2027-Q1 2027-01-01"]);
  });

  it("their July is charged at midnight in London, an hour before it's July in UTC (BST)", async () => {
    const reg = await quarterly();
    await chargeDue(w.env, new Date("2027-06-30T22:59:00Z"));
    expect(quarters(reg).at(-1)).toBe("2027-Q2 2027-04-01");
    await chargeDue(w.env, new Date("2027-06-30T23:00:00Z")); // 00:00 on 1 July in London
    expect(quarters(reg).at(-1)).toBe("2027-Q3 2027-07-01");
  });

  it("a Quarterly Member who joins on a leap day pays the quarter from that day", async () => {
    const leap = new Date("2028-02-29T12:00:00Z");
    const dana = await signedInAt("dana@example.com", leap);
    const reg = await memberId(dana, "Reg Player");
    expect((await dana.call("POST", `/api/members/${reg}/quarterly`, { quarterly: true }, { now: leap })).status).toBe(
      200,
    );
    expect(quarters(reg)).toEqual(["2028-Q1 2028-02-29"]);
  });
});

describe("who may touch money (ADR 0024)", () => {
  /** Every change to someone's dues, for Reg, on a night he owes and a payment he made. */
  async function everyChange() {
    const { dana, reg, pay } = await came(800, [FRIDAYS[2]]);
    await pay(300);
    const [night] = await chargesOf(dana, reg);
    const payment = (w.db.raw.prepare("SELECT id FROM payments").get() as { id: number }).id;
    return {
      dana,
      reg,
      calls: [
        ["POST", `/api/members/${reg}/payments`, { via: "cash", pence: 100 }],
        ["POST", `/api/members/${reg}/charges`, { quarter: "2026-Q1", pence: 100 }],
        ["POST", `/api/members/${reg}/adjustments`, { pence: -100, reason: "Mates' rates" }],
        ["POST", `/api/members/${reg}/recalculate`],
        ["POST", `/api/charges/${night.id}/payment`, { via: "cash" }],
        ["DELETE", `/api/charges/${night.id}/payment`],
        ["DELETE", `/api/payments/${payment}`],
        ["DELETE", `/api/charges/${night.id}`],
        ["POST", "/api/subscription-fees", { pence: 1, from: "2026-10-01" }],
        ["POST", `/api/members/${reg}/quarterly`, { quarterly: true }],
      ] as [string, string, unknown?][],
    };
  }
  const unchanged = (reg: number) => {
    expect(paymentsOf(reg)).toEqual([{ pence: 300, via: "transfer" }]);
    expect(w.db.raw.prepare("SELECT COUNT(*) n FROM charges WHERE member_id = ?").get(reg)).toEqual({ n: 1 });
  };

  it("someone not signed in can't change anyone's dues", async () => {
    const { reg, calls } = await everyChange();
    const stranger = w.browser();
    for (const [method, path, payload] of calls)
      expect((await stranger.call(method, path, payload)).status, `${method} ${path}`).toBe(401);
    unchanged(reg);
  });

  it("a member can't change their own dues, nor a session lead, nor someone who only sees Unpaid fees", async () => {
    const { reg, calls } = await everyChange();
    for (const email of ["reg@example.com", "dot@example.com", "val@example.com"]) {
      const them = await w.signedIn(email);
      for (const [method, path, payload] of calls)
        expect((await them.call(method, path, payload)).status, `${email} ${method} ${path}`).toBe(403);
    }
    unchanged(reg);
  });

  it("someone who only sees Unpaid fees sees everyone's charges; a member only their own", async () => {
    const { dana, reg } = await everyChange();
    const danaId = await memberId(dana, "Dana Admin");
    await dana.call("POST", `/api/sessions/${await sessionOn(dana, FRIDAYS[2])}/register`, {
      memberId: danaId,
      here: true,
    });
    const val = await boot(await w.signedIn("val@example.com"));
    expect(new Set((val.charges as Charge[]).map((c) => c.memberId))).toEqual(new Set([reg, danaId]));
    const dot = await boot(await w.signedIn("dot@example.com"));
    expect(dot.charges).toEqual([]);
  });

  it("a treasurer records payments, charges and adjustments, but can't set the quarterly rate", async () => {
    const { reg } = await came(800, [FRIDAYS[2]]);
    const tess = await w.signedIn("tess@example.com");
    expect((await tess.call("POST", `/api/members/${reg}/payments`, { via: "cash", pence: 800 })).status).toBe(200);
    expect((await tess.call("POST", `/api/members/${reg}/adjustments`, { pence: 200, reason: "Puck" })).status).toBe(
      201,
    );
    expect((await tess.call("POST", `/api/members/${reg}/charges`, { quarter: "2026-Q1", pence: 100 })).status).toBe(
      201,
    );
    expect((await tess.call("POST", "/api/subscription-fees", { pence: 1, from: "2026-10-01" })).status).toBe(403);
  });
});

describe("taps at once", () => {
  // The same night marked paid from two phones (or a double tap): each reads what's left, then writes a payment for it
  // in a statement of its own, so both go in and the night is paid twice (£8 recorded as £16): https://github.com/battersea-cougars/ark/issues/119
  // Seeds that land the two reads before either write (any seed may; these do, run after run)
  it.fails.each([2, 3, 5])(
    "an admin double-taps Paid on a night: one payment is recorded, not two (known bug #119, seed %i)",
    async (seed) => {
      const { dana, reg } = await came(800, [FRIDAYS[2]]);
      const [night] = await chargesOf(dana, reg);
      w.db.interleave(seed);
      const replies = await Promise.all([
        dana.call("POST", `/api/charges/${night.id}/payment`, { via: "cash" }),
        dana.call("POST", `/api/charges/${night.id}/payment`, { via: "cash" }),
      ]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status)).toEqual([200, 200]);
      expect(paymentsOf(reg)).toEqual([{ pence: 800, via: "cash" }]);
    },
  );

  // The second insert meets the UNIQUE index (charges_quarter) after the check before it passed, and the admin is told
  // something went wrong (a 500) rather than that it's already charged: https://github.com/battersea-cougars/ark/issues/121
  it.fails.each([2, 5])(
    "two admins charge the same quarter at once: one is charged, the other told it's there (known bug #121, seed %i)",
    async (seed) => {
      const { dana, reg } = await came(800, []);
      const tess = await w.signedIn("tess@example.com");
      w.db.interleave(seed);
      const replies = await Promise.all([
        dana.call("POST", `/api/members/${reg}/charges`, { quarter: "2026-Q1", pence: 5000 }),
        tess.call("POST", `/api/members/${reg}/charges`, { quarter: "2026-Q1", pence: 5000 }),
      ]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(w.db.raw.prepare("SELECT COUNT(*) n FROM charges WHERE quarter = '2026-Q1'").get()).toEqual({ n: 1 });
    },
  );

  it.each(seeds(5))(
    "two lump sums recorded at once both count, and no night is paid past what it costs (seed %i)",
    async (seed) => {
      const { dana, reg, pay } = await came(800);
      const tess = await w.signedIn("tess@example.com");
      w.db.interleave(seed);
      await Promise.all([pay(1000), pay(1000, {}, tess)]);
      w.db.interleave(null);
      // Both payments are money that came in; together they pay £20 of the £24
      await chargeDue(w.env, NOW);
      expect((await chargesOf(dana, reg)).reduce((s, c) => s + c.paidPence, 0)).toBe(2000);
      expect(credit(reg)).toBe(0);
      expect(
        w.db.raw
          .prepare(
            `SELECT c.id FROM charges c WHERE c.amount_pence <
               (SELECT COALESCE(SUM(amount_pence), 0) FROM payment_allocations WHERE charge_id = c.id)`,
          )
          .all(),
      ).toEqual([]);
    },
  );
});
