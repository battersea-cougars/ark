// Dues (ADR 0007): who came is charged that night's fee, Quarterly Members are charged the quarterly rate instead,
// and an admin marks what's been paid. Unpaid fees is whatever isn't. Driven through the real Worker handlers in the
// fake world (ADR 0031); the hourly Cron Trigger is chargeDue, called as the Worker's scheduled handler calls it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chargeDue } from "./dues";
import { NOW, onTheNight, testWorld } from "../testing";
import { chargesOf as ledgerCharges, creditsOf, paymentsOf } from "./dues.testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Dot Door", position: "F", rating: 50, email: "dot@example.com", roles: ["Session lead"] },
];

// NOW is Tuesday 6 October 2026: last Friday was the 2nd, the next is the 9th
const LAST_FRIDAY = "2026-10-02";
const NEXT_FRIDAY = "2026-10-09";
const on = (day: string) => new Date(`${day}T11:00:00Z`);

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
interface Charge {
  id: number;
  memberId: number;
  kind: string;
  refId: number | null;
  quarter: string | null;
  pence: number;
  dueOn: string;
  paidOn: string | null;
  paidVia: string | null;
  paidPence: number;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const boot = async (b: Browser, now = NOW) => (await b.call("GET", "/api/bootstrap", undefined, { now })).body;
const memberId = async (b: Browser, name: string) =>
  (await boot(b)).members.find((m: { name: string }) => m.name === name).id as number;
const sessionOn = async (b: Browser, day: string) =>
  (await boot(b)).sessions.find((s: { heldOn: string }) => s.heldOn === day).id as number;
const chargesOf = async (b: Browser, id: number, now = NOW) => (await ledgerCharges(b, id, now)) as Charge[];

/** Friday Training costs this much a session, from this day on. */
async function fridayFee(dana: Browser, pence: number, from = "2026-01-01") {
  const series = (await boot(dana)).series[0];
  const r = await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [{ pence, from }] });
  expect(r.status).toBe(200);
}

describe("who came is charged", () => {
  it("the session lead ticks someone in at last Friday's session, and they owe that night's fee in Unpaid fees", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    const dot = await w.signedIn("dot@example.com");
    const session = await sessionOn(dana, LAST_FRIDAY);

    expect(
      (
        await dot.call(
          "POST",
          `/api/sessions/${session}/register`,
          { memberId: reg, here: true },
          { now: onTheNight(LAST_FRIDAY) },
        )
      ).status,
    ).toBe(200);

    expect(await chargesOf(dana, reg)).toEqual([
      expect.objectContaining({ kind: "session", refId: session, pence: 800, dueOn: LAST_FRIDAY, paidOn: null }),
    ]);
  });

  it("unticking them takes the charge off again", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    const session = await sessionOn(dana, LAST_FRIDAY);
    await dana.call(
      "POST",
      `/api/sessions/${session}/register`,
      { memberId: reg, here: true },
      { now: onTheNight(LAST_FRIDAY) },
    );
    await dana.call(
      "POST",
      `/api/sessions/${session}/register`,
      { memberId: reg, here: false },
      { now: onTheNight(LAST_FRIDAY) },
    );
    expect(await chargesOf(dana, reg)).toEqual([]);
  });

  it("everyone signed up is charged from the day of the session, except a no-show", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await w.signedIn("reg@example.com");
    const regId = await memberId(dana, "Reg Player");
    const session = await sessionOn(dana, NEXT_FRIDAY);
    await reg.call("POST", `/api/sessions/${session}/answer`, { answer: "in" });
    await dana.call("POST", `/api/sessions/${session}/answer`, { answer: "in" });
    // Not yet: it hasn't happened
    expect(await chargesOf(dana, regId)).toEqual([]);

    // Friday comes (the hourly check), and Dana marks herself a no-show
    await chargeDue(w.env, on(NEXT_FRIDAY));
    const danaId = await memberId(dana, "Dana Admin");
    await dana.call(
      "POST",
      `/api/sessions/${session}/register`,
      { memberId: danaId, here: false },
      { now: on(NEXT_FRIDAY) },
    );
    expect(await chargesOf(dana, regId, on(NEXT_FRIDAY))).toEqual([
      expect.objectContaining({ refId: session, pence: 800 }),
    ]);
    expect(await chargesOf(dana, danaId, on(NEXT_FRIDAY))).toEqual([]);
  });

  it("a cancelled session charges nobody", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    const session = await sessionOn(dana, LAST_FRIDAY);
    await dana.call(
      "POST",
      `/api/sessions/${session}/register`,
      { memberId: reg, here: true },
      { now: onTheNight(LAST_FRIDAY) },
    );
    // Called off that night, before its register closed (#11)
    await dana.call(
      "POST",
      `/api/sessions/${session}/cancelled`,
      { cancelled: true },
      { now: onTheNight(LAST_FRIDAY) },
    );
    expect(await chargesOf(dana, reg)).toEqual([]);
  });

  it("Friday Training is £12 a session (the club's seed), for every night in the last year", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await memberId(dana, "Reg Player");
    await dana.call(
      "POST",
      `/api/sessions/${await sessionOn(dana, "2026-09-25")}/register`,
      {
        memberId: reg,
        here: true,
      },
      { now: onTheNight("2026-09-25") },
    );
    await dana.call(
      "POST",
      `/api/sessions/${await sessionOn(dana, LAST_FRIDAY)}/register`,
      {
        memberId: reg,
        here: true,
      },
      { now: onTheNight(LAST_FRIDAY) },
    );
    expect((await chargesOf(dana, reg)).map((c) => [c.dueOn, c.pence])).toEqual([
      [LAST_FRIDAY, 1200],
      ["2026-09-25", 1200],
    ]);
  });

  it("a new fee from a later date leaves nights before it as they were", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    const session = await sessionOn(dana, LAST_FRIDAY);
    await dana.call(
      "POST",
      `/api/sessions/${session}/register`,
      { memberId: reg, here: true },
      { now: onTheNight(LAST_FRIDAY) },
    );
    const series = (await boot(dana)).series[0];
    await dana.call("PUT", `/api/series/${series.id}`, {
      ...series,
      fees: [
        { pence: 800, from: "2026-01-01" },
        { pence: 1000, from: "2026-10-06" },
      ],
    });
    expect((await chargesOf(dana, reg))[0].pence).toBe(800);
  });

  it("changing the fee from the start recalculates every night already recorded", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    for (const day of ["2026-09-25", LAST_FRIDAY])
      await dana.call(
        "POST",
        `/api/sessions/${await sessionOn(dana, day)}/register`,
        { memberId: reg, here: true },
        { now: onTheNight(day) },
      );
    await fridayFee(dana, 1000);
    expect((await chargesOf(dana, reg)).map((c) => c.pence)).toEqual([1000, 1000]);
  });

  it("a night already paid owes the difference when the fee goes up, and gives credit when it goes down", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    await dana.call(
      "POST",
      `/api/sessions/${await sessionOn(dana, LAST_FRIDAY)}/register`,
      {
        memberId: reg,
        here: true,
      },
      { now: onTheNight(LAST_FRIDAY) },
    );
    await dana.call("POST", `/api/members/${reg}/payments`, { via: "cash", pence: 800 });

    await fridayFee(dana, 1000);
    expect((await chargesOf(dana, reg))[0]).toMatchObject({ pence: 1000, paidPence: 800, paidOn: null });

    await fridayFee(dana, 500);
    expect((await chargesOf(dana, reg))[0]).toMatchObject({ pence: 500, paidPence: 500, paidOn: "2026-10-06" });
    expect(await creditsOf(dana)).toEqual([{ memberId: reg, pence: 300 }]);
  });

  it("an admin recalculates a member's dues by hand", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    await dana.call(
      "POST",
      `/api/sessions/${await sessionOn(dana, LAST_FRIDAY)}/register`,
      {
        memberId: reg,
        here: true,
      },
      { now: onTheNight(LAST_FRIDAY) },
    );
    // Changed behind the app's back: the recalculation puts it right
    w.db.raw.exec("UPDATE charges SET amount_pence = 1");
    expect((await dana.call("POST", `/api/members/${reg}/recalculate`)).status).toBe(200);
    expect((await chargesOf(dana, reg))[0].pence).toBe(800);
  });

  it("with no fee set, nobody is charged", async () => {
    const dana = await w.signedIn("dana@example.com");
    const series = (await boot(dana)).series[0];
    await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [] });
    const reg = await memberId(dana, "Reg Player");
    const session = await sessionOn(dana, LAST_FRIDAY);
    await dana.call(
      "POST",
      `/api/sessions/${session}/register`,
      { memberId: reg, here: true },
      { now: onTheNight(LAST_FRIDAY) },
    );
    expect(await chargesOf(dana, reg)).toEqual([]);
  });

  it("a Quarterly Member isn't charged for training", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    await dana.call("POST", `/api/members/${reg}/quarterly`, { quarterly: true }, { now: on("2026-10-01") });
    const session = await sessionOn(dana, LAST_FRIDAY);
    await dana.call(
      "POST",
      `/api/sessions/${session}/register`,
      { memberId: reg, here: true },
      { now: onTheNight(LAST_FRIDAY) },
    );
    expect((await chargesOf(dana, reg)).filter((c) => c.kind === "session")).toEqual([]);
  });

  it("a tournament charges everyone who entered from its day, Quarterly Members too", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await w.signedIn("reg@example.com");
    const regId = await memberId(dana, "Reg Player");
    await dana.call("POST", `/api/members/${regId}/quarterly`, { quarterly: true });
    const t = await dana.call("POST", "/api/tournaments", {
      name: "Autumn Cup",
      heldOn: "2026-10-10",
      startTime: "11:00",
      endTime: "17:00",
      status: "open",
      feePence: 1500,
    });
    expect(t.status).toBe(201);
    await reg.call("POST", `/api/tournaments/${t.body.id}/answer`, { answer: "in" });
    expect((await chargesOf(dana, regId)).filter((c) => c.kind === "tournament")).toEqual([]);

    await chargeDue(w.env, on("2026-10-10"));
    expect((await chargesOf(dana, regId, on("2026-10-10"))).filter((c) => c.kind === "tournament")).toEqual([
      expect.objectContaining({ kind: "tournament", refId: t.body.id, pence: 1500, dueOn: "2026-10-10" }),
    ]);
  });
});

describe("the quarterly rate", () => {
  it("Quarterly Members are charged it at the start of each quarter", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/subscription-fees", { pence: 6000, from: "2026-07-01" })).status).toBe(200);
    const reg = await memberId(dana, "Reg Player");
    await dana.call("POST", `/api/members/${reg}/quarterly`, { quarterly: true }, { now: on("2026-09-15") });

    await chargeDue(w.env, on("2026-09-15"));
    await chargeDue(w.env, on("2026-10-01"));
    // Joining mid-quarter pays that quarter; the next is due on its first day. Running again charges nothing more.
    await chargeDue(w.env, on("2026-10-06"));
    expect(await chargesOf(dana, reg)).toEqual([
      expect.objectContaining({ kind: "quarter", quarter: "2026-Q4", pence: 6000, dueOn: "2026-10-01" }),
      expect.objectContaining({ kind: "quarter", quarter: "2026-Q3", pence: 6000, dueOn: "2026-09-15" }),
    ]);
  });

  it("an admin charges a member for a quarter by hand, and can take it back", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await memberId(dana, "Reg Player");
    const r = await dana.call("POST", `/api/members/${reg}/charges`, { quarter: "2026-Q3", pence: 5000 });
    expect(r.status).toBe(201);
    expect(await chargesOf(dana, reg)).toEqual([
      expect.objectContaining({ kind: "quarter", quarter: "2026-Q3", pence: 5000, dueOn: "2026-07-01" }),
    ]);
    // Once only
    expect((await dana.call("POST", `/api/members/${reg}/charges`, { quarter: "2026-Q3", pence: 5000 })).status).toBe(
      409,
    );
    expect((await dana.call("DELETE", `/api/charges/${r.body.id}`)).status).toBe(200);
    expect(await chargesOf(dana, reg)).toEqual([]);
  });

  it("a quarter charged by hand covers that quarter's training nights: they come off, other quarters' stay", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    for (const day of ["2026-09-25", LAST_FRIDAY])
      await dana.call(
        "POST",
        `/api/sessions/${await sessionOn(dana, day)}/register`,
        { memberId: reg, here: true },
        { now: onTheNight(day) },
      );

    const q = await dana.call("POST", `/api/members/${reg}/charges`, { quarter: "2026-Q4", pence: 9000 });
    expect(q.status).toBe(201);
    expect((await chargesOf(dana, reg)).map((c) => [c.kind, c.dueOn])).toEqual([
      ["quarter", "2026-10-01"],
      ["session", "2026-09-25"],
    ]);

    // Taken back by mistake: that night is owed again
    await dana.call("DELETE", `/api/charges/${q.body.id}`);
    expect((await chargesOf(dana, reg)).map((c) => [c.kind, c.dueOn])).toEqual([
      ["session", LAST_FRIDAY],
      ["session", "2026-09-25"],
    ]);
  });

  it("joining mid-quarter pays the whole quarter, so the nights before they joined are covered too", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    await dana.call("POST", "/api/subscription-fees", { pence: 9000, from: "2026-01-01" });
    const reg = await memberId(dana, "Reg Player");
    await dana.call(
      "POST",
      `/api/sessions/${await sessionOn(dana, LAST_FRIDAY)}/register`,
      {
        memberId: reg,
        here: true,
      },
      { now: onTheNight(LAST_FRIDAY) },
    );

    await dana.call("POST", `/api/members/${reg}/quarterly`, { quarterly: true }, { now: on("2026-10-06") });
    await chargeDue(w.env, on("2026-10-06"));
    expect((await chargesOf(dana, reg, on("2026-10-06"))).map((c) => [c.kind, c.dueOn])).toEqual([
      ["quarter", "2026-10-06"],
    ]);
  });

  it("a night already paid, then covered by a quarter, is credit", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    await dana.call(
      "POST",
      `/api/sessions/${await sessionOn(dana, LAST_FRIDAY)}/register`,
      {
        memberId: reg,
        here: true,
      },
      { now: onTheNight(LAST_FRIDAY) },
    );
    await dana.call("POST", `/api/members/${reg}/payments`, { via: "cash", pence: 800 });

    await dana.call("POST", `/api/members/${reg}/charges`, { quarter: "2026-Q4", pence: 9000 });
    // The £8 they paid for the night goes towards the quarter
    expect((await chargesOf(dana, reg)).map((c) => [c.kind, c.paidPence])).toEqual([["quarter", 800]]);
  });

  it("a quarter charged by hand uses the quarterly rate when no amount is given", async () => {
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/subscription-fees", { pence: 6000, from: "2026-01-01" });
    const reg = await memberId(dana, "Reg Player");
    await dana.call("POST", `/api/members/${reg}/charges`, { quarter: "2026-Q2" });
    expect((await chargesOf(dana, reg))[0]).toMatchObject({ quarter: "2026-Q2", pence: 6000, dueOn: "2026-04-01" });
  });
});

describe("paying", () => {
  async function owing() {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    for (const day of ["2026-09-25", LAST_FRIDAY])
      await dana.call(
        "POST",
        `/api/sessions/${await sessionOn(dana, day)}/register`,
        { memberId: reg, here: true },
        { now: onTheNight(day) },
      );
    return { dana, reg };
  }

  it("an admin marks a night paid by transfer, and it's off Unpaid fees; a mistake can be taken back", async () => {
    const { dana, reg } = await owing();
    const [newest] = await chargesOf(dana, reg);
    expect((await dana.call("POST", `/api/charges/${newest.id}/payment`, { via: "transfer" })).status).toBe(200);
    expect((await chargesOf(dana, reg)).map((c) => [c.dueOn, c.paidOn, c.paidVia])).toEqual([
      [LAST_FRIDAY, "2026-10-06", "transfer"],
      ["2026-09-25", null, null],
    ]);

    expect((await dana.call("DELETE", `/api/charges/${newest.id}/payment`)).status).toBe(200);
    expect((await chargesOf(dana, reg)).every((c) => c.paidOn === null)).toBe(true);
  });

  it("a payment says how much: there's no marking everything paid at once (Record a payment does it)", async () => {
    const { dana, reg } = await owing();
    expect(await dana.call("POST", `/api/members/${reg}/payments`, { via: "cash" })).toMatchObject({
      status: 400,
      body: { error: "How much, in pence?" },
    });
    expect((await chargesOf(dana, reg)).every((c) => c.paidOn === null)).toBe(true);
  });

  it("a paid night stays on their record if they're unticked later", async () => {
    const { dana, reg } = await owing();
    const [newest] = await chargesOf(dana, reg);
    await dana.call("POST", `/api/charges/${newest.id}/payment`, { via: "cash" });
    await dana.call(
      "POST",
      `/api/sessions/${newest.refId}/register`,
      { memberId: reg, here: false },
      { now: onTheNight(newest.dueOn) },
    );
    expect((await chargesOf(dana, reg)).map((c) => c.id)).toContain(newest.id);
  });

  it("a lump sum pays the oldest dues first, and part of the next", async () => {
    const { dana, reg } = await owing();
    expect((await dana.call("POST", `/api/members/${reg}/payments`, { via: "transfer", pence: 1000 })).status).toBe(
      200,
    );
    expect((await chargesOf(dana, reg)).map((c) => [c.dueOn, c.paidPence, c.paidOn])).toEqual([
      [LAST_FRIDAY, 200, null],
      ["2026-09-25", 800, "2026-10-06"],
    ]);
    expect(await creditsOf(dana)).toEqual([]);
  });

  it("money left over is their credit, and pays the next charge as it comes", async () => {
    const { dana, reg } = await owing();
    await dana.call("POST", `/api/members/${reg}/payments`, { via: "cash", pence: 2000 });
    expect(await creditsOf(dana)).toEqual([{ memberId: reg, pence: 400 }]);

    const next = await sessionOn(dana, NEXT_FRIDAY);
    await dana.call("POST", `/api/sessions/${next}/register`, { memberId: reg, here: true }, { now: on(NEXT_FRIDAY) });
    const [newest] = await chargesOf(dana, reg, on(NEXT_FRIDAY));
    expect(newest).toMatchObject({ dueOn: NEXT_FRIDAY, paidPence: 400, paidOn: null });
    expect(await creditsOf(dana, on(NEXT_FRIDAY))).toEqual([]);
  });

  it("a payment is dated the day it came in: today unless they say, never in the future", async () => {
    const { dana, reg } = await owing();
    await dana.call("POST", `/api/members/${reg}/payments`, { via: "transfer", pence: 800 });
    await dana.call("POST", `/api/members/${reg}/payments`, { via: "cash", pence: 800, receivedOn: "2026-10-02" });
    expect((await paymentsOf(dana, reg)).map((p: { receivedOn: string }) => p.receivedOn)).toEqual([
      "2026-10-06",
      "2026-10-02",
    ]);
    expect(
      await dana.call("POST", `/api/members/${reg}/payments`, { via: "cash", pence: 800, receivedOn: "2026-10-07" }),
    ).toMatchObject({ status: 400, body: { error: "A payment can't be from the future." } });
    expect(
      (await dana.call("POST", `/api/members/${reg}/payments`, { via: "cash", pence: 800, receivedOn: "2 Oct" }))
        .status,
    ).toBe(400);
  });

  it("a payment recorded by mistake is taken back from the ledger: what it paid is owed again", async () => {
    const { dana, reg } = await owing();
    await dana.call("POST", `/api/members/${reg}/payments`, { via: "transfer", pence: 1000 });
    const [payment] = await paymentsOf(dana, reg);
    expect((await dana.call("DELETE", `/api/payments/${payment.id}`)).status).toBe(200);
    expect(await paymentsOf(dana, reg)).toEqual([]);
    expect((await chargesOf(dana, reg)).map((c) => c.paidPence)).toEqual([0, 0]);
    expect((await dana.call("DELETE", `/api/payments/${payment.id}`)).status).toBe(404);
    const regSelf = await w.signedIn("reg@example.com");
    expect((await regSelf.call("DELETE", `/api/payments/${payment.id}`)).status).toBe(403);
  });

  it("taking back one payment leaves the others, which pay the oldest first again", async () => {
    const { dana, reg } = await owing();
    await dana.call("POST", `/api/members/${reg}/payments`, { via: "cash", pence: 800 });
    await dana.call("POST", `/api/members/${reg}/payments`, { via: "transfer", pence: 800 });
    const [newest] = await paymentsOf(dana, reg);
    await dana.call("DELETE", `/api/payments/${newest.id}`);
    expect((await chargesOf(dana, reg)).map((c) => [c.dueOn, c.paidPence])).toEqual([
      [LAST_FRIDAY, 0],
      ["2026-09-25", 800],
    ]);
  });

  it("taking back a lump sum takes back all it paid for", async () => {
    const { dana, reg } = await owing();
    await dana.call("POST", `/api/members/${reg}/payments`, { via: "transfer", pence: 1600 });
    const [newest] = await chargesOf(dana, reg);
    expect((await dana.call("DELETE", `/api/charges/${newest.id}/payment`)).status).toBe(200);
    expect((await chargesOf(dana, reg)).map((c) => c.paidPence)).toEqual([0, 0]);
  });

  it("payments are on the record", async () => {
    const { dana, reg } = await owing();
    const [newest] = await chargesOf(dana, reg);
    await dana.call("POST", `/api/charges/${newest.id}/payment`, { via: "transfer" });
    const log = (await dana.call("GET", "/api/audit")).body.entries as { action: string }[];
    expect(log.map((e) => e.action)).toContain("charge.paid");
  });
});

describe("adjustments", () => {
  async function owing() {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const reg = await memberId(dana, "Reg Player");
    for (const day of ["2026-09-25", LAST_FRIDAY])
      await dana.call(
        "POST",
        `/api/sessions/${await sessionOn(dana, day)}/register`,
        { memberId: reg, here: true },
        { now: onTheNight(day) },
      );
    return { dana, reg };
  }
  const adjust = (b: Browser, reg: number, o: Record<string, unknown>) =>
    b.call("POST", `/api/members/${reg}/adjustments`, o);

  it("an admin adds to what someone owes, saying why: a line on their ledger, owed like any charge", async () => {
    const { dana, reg } = await owing();
    expect((await adjust(dana, reg, { pence: 500, reason: "Lost the club's puck" })).status).toBe(201);
    expect(await chargesOf(dana, reg)).toContainEqual(
      expect.objectContaining({ kind: "adjustment", title: "Lost the club's puck", pence: 500, dueOn: "2026-10-06" }),
    );
  });

  it("an admin takes some off what someone owes, saying why: it pays what they owe, oldest first", async () => {
    const { dana, reg } = await owing();
    expect((await adjust(dana, reg, { pence: -800, reason: "Reffed the Kumite", on: "2026-10-03" })).status).toBe(201);
    expect(await paymentsOf(dana, reg)).toEqual([
      expect.objectContaining({ memberId: reg, pence: 800, via: "adjustment", reason: "Reffed the Kumite" }),
    ]);
    expect((await chargesOf(dana, reg)).map((c) => [c.dueOn, c.paidPence])).toEqual([
      [LAST_FRIDAY, 0],
      ["2026-09-25", 800],
    ]);
  });

  it("either is taken back from the ledger if it was a mistake", async () => {
    const { dana, reg } = await owing();
    const more = await adjust(dana, reg, { pence: 500, reason: "Typo" });
    const less = await adjust(dana, reg, { pence: -500, reason: "Typo" });
    expect((await dana.call("DELETE", `/api/charges/${more.body.id}`)).status).toBe(200);
    expect((await dana.call("DELETE", `/api/payments/${less.body.id}`)).status).toBe(200);
    expect((await chargesOf(dana, reg)).map((c) => c.kind)).toEqual(["session", "session"]);
    expect(await paymentsOf(dana, reg)).toEqual([]);
  });

  it("needs a reason, an amount that isn't nothing, and a day not in the future", async () => {
    const { dana, reg } = await owing();
    expect(await adjust(dana, reg, { pence: 500, reason: " " })).toMatchObject({
      status: 400,
      body: { error: "Say why: it's on their ledger." },
    });
    expect((await adjust(dana, reg, { pence: 0, reason: "Nothing" })).status).toBe(400);
    expect((await adjust(dana, reg, { pence: 500, reason: "Later", on: "2026-10-07" })).status).toBe(400);
  });

  it("is for whoever records payments, and on the record", async () => {
    const { dana, reg } = await owing();
    const regSelf = await w.signedIn("reg@example.com");
    expect((await adjust(regSelf, reg, { pence: -1600, reason: "Mates' rates" })).status).toBe(403);
    await adjust(dana, reg, { pence: 500, reason: "Lost the club's puck" });
    const { entries } = (await dana.call("GET", "/api/audit")).body as { entries: { action: string }[] };
    expect(entries.map((e) => e.action)).toContain("dues.adjusted");
  });
});

describe("who sees what", () => {
  it("a member sees only their own charges, and can't mark anything paid", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const [regId, danaId] = [await memberId(dana, "Reg Player"), await memberId(dana, "Dana Admin")];
    const session = await sessionOn(dana, LAST_FRIDAY);
    for (const id of [regId, danaId])
      await dana.call(
        "POST",
        `/api/sessions/${session}/register`,
        { memberId: id, here: true },
        { now: onTheNight(LAST_FRIDAY) },
      );

    const reg = await w.signedIn("reg@example.com");
    const theirs = (await boot(reg)).charges as Charge[];
    expect(theirs.map((c) => c.memberId)).toEqual([regId]);
    expect((await reg.call("GET", `/api/members/${danaId}/ledger`)).status).toBe(403);
    expect((await reg.call("POST", `/api/charges/${theirs[0].id}/payment`, { via: "cash" })).status).toBe(403);
    expect((await reg.call("POST", "/api/subscription-fees", { pence: 1, from: "2026-10-01" })).status).toBe(403);
  });

  it("each payment is on the ledger with the charges: a member reads their own, an admin anyone's", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fridayFee(dana, 800);
    const [regId, danaId] = [await memberId(dana, "Reg Player"), await memberId(dana, "Dana Admin")];
    for (const id of [regId, danaId]) {
      await dana.call(
        "POST",
        `/api/sessions/${await sessionOn(dana, LAST_FRIDAY)}/register`,
        {
          memberId: id,
          here: true,
        },
        { now: onTheNight(LAST_FRIDAY) },
      );
      await dana.call("POST", `/api/members/${id}/payments`, { via: "transfer", pence: 2000 });
    }

    const payment = { pence: 2000, receivedOn: "2026-10-06", via: "transfer" };
    expect(await paymentsOf(dana, danaId)).toEqual([expect.objectContaining({ memberId: danaId, ...payment })]);
    expect(await paymentsOf(dana, regId)).toEqual([expect.objectContaining({ memberId: regId, ...payment })]);
    const reg = await w.signedIn("reg@example.com");
    expect(await paymentsOf(reg, regId)).toEqual([expect.objectContaining({ memberId: regId, ...payment })]);
    expect((await reg.call("GET", `/api/members/${danaId}/ledger`)).status).toBe(403);
  });
});
