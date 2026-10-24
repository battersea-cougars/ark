// A training's fee on a night's day (ADR 0007): a fee runs from its date until the next one starts, and a night costs
// the one in force on its London day. The boundaries: a fee from the night itself, from the day after, two a day
// apart, one changed back in time over nights whose register has closed (paid or not), one taken to nothing from a
// date, a Quarterly Member across a change, and the hourly run at 00:30 BST, still the day before in UTC. Driven through
// the real Worker handlers in the fake world (ADR 0031); the hourly Cron Trigger is chargeDue, as the Worker calls it.
// The Fees journey (apps/team/journeys/fees.journey.ts) taps the same through the training's editor.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chargeDue } from "./dues";
import { NOW, onTheNight, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Pat Payer", position: "F", rating: 55, email: "pat@example.com" },
];

// NOW is Tuesday 6 October 2026: the Fridays before it are 25 September and 2 October (both registers closed by
// now, at 6am the morning after), the next is the 9th
const FRIDAY_BEFORE = "2026-09-25";
const LAST_FRIDAY = "2026-10-02";
const NEXT_FRIDAY = "2026-10-09";

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
interface Charge {
  memberId: number;
  kind: string;
  refId: number | null;
  pence: number;
  dueOn: string;
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
  (await boot(b)).sessions.find((s: { heldOn: string; seriesId: number }) => s.heldOn === day && s.seriesId === 1)
    .id as number;
/** A member's training charges, as day → pence (two for one night would show as a list). */
const nights = async (b: Browser, id: number, now = NOW) => {
  const charges = ((await boot(b, now)).charges as Charge[]).filter((c) => c.memberId === id && c.kind === "session");
  return charges.map((c) => [c.dueOn, c.pence]).sort();
};
const creditOf = async (b: Browser, id: number) =>
  ((await boot(b)).credits as { memberId: number; pence: number }[]).find((c) => c.memberId === id)?.pence ?? 0;

/** Friday Training's fees, the whole list, as its editor sends them; saved now unless told. */
async function fees(dana: Browser, list: { pence: number; from: string }[], now = NOW) {
  const series = (await boot(dana, now)).series.find((s: { id: number }) => s.id === 1);
  const r = await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: list }, { now });
  expect(r.status).toBe(200);
}

/** Ticked in on the night (before its register closed at 6am the morning after). */
async function cameTo(dana: Browser, id: number, day: string) {
  const session = await sessionOn(dana, day);
  const r = await dana.call(
    "POST",
    `/api/sessions/${session}/register`,
    { memberId: id, here: true },
    { now: onTheNight(day) },
  );
  expect(r.status).toBe(200);
}

describe("a fee on a night's day", () => {
  it("a fee from a Friday charges that Friday the new fee, and the Friday before the old", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fees(dana, [
      { pence: 1000, from: "2026-01-01" },
      { pence: 1200, from: LAST_FRIDAY },
    ]);
    const reg = await memberId(dana, "Reg Player");
    await cameTo(dana, reg, FRIDAY_BEFORE);
    await cameTo(dana, reg, LAST_FRIDAY);
    expect(await nights(dana, reg)).toEqual([
      [FRIDAY_BEFORE, 1000],
      [LAST_FRIDAY, 1200],
    ]);
  });

  it("a fee from the Saturday after a Friday leaves that Friday at the old fee", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fees(dana, [
      { pence: 1000, from: "2026-01-01" },
      { pence: 1200, from: "2026-10-03" },
    ]);
    const reg = await memberId(dana, "Reg Player");
    await cameTo(dana, reg, LAST_FRIDAY);
    expect(await nights(dana, reg)).toEqual([[LAST_FRIDAY, 1000]]);
  });

  it("two fees a day apart, Thursday's and Friday's: Friday costs Friday's", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fees(dana, [
      { pence: 1000, from: "2026-01-01" },
      { pence: 1500, from: "2026-10-01" },
      { pence: 1600, from: LAST_FRIDAY },
    ]);
    const reg = await memberId(dana, "Reg Player");
    await cameTo(dana, reg, LAST_FRIDAY);
    expect(await nights(dana, reg)).toEqual([[LAST_FRIDAY, 1600]]);
  });

  it("the hourly run at 00:30 BST on a Friday (23:30 UTC Thursday) charges it, at the fee from that Friday", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fees(dana, [
      { pence: 1000, from: "2026-01-01" },
      { pence: 1200, from: NEXT_FRIDAY },
    ]);
    const reg = await w.signedIn("reg@example.com");
    const regId = await memberId(dana, "Reg Player");
    expect(
      (await reg.call("POST", `/api/sessions/${await sessionOn(dana, NEXT_FRIDAY)}/answer`, { answer: "in" })).status,
    ).toBe(200);

    const thursdayNight = new Date("2026-10-08T22:30:00Z"); // 23:30 BST Thursday
    await chargeDue(w.env, thursdayNight);
    expect(await nights(dana, regId, thursdayNight)).toEqual([]);
    const fridayMorning = new Date("2026-10-08T23:30:00Z"); // 00:30 BST Friday
    await chargeDue(w.env, fridayMorning);
    expect(await nights(dana, regId, fridayMorning)).toEqual([[NEXT_FRIDAY, 1200]]);
    // And on the night, and the next day: the same one charge
    for (const later of [new Date("2026-10-09T18:07:00Z"), new Date("2026-10-10T08:07:00Z")]) {
      await chargeDue(w.env, later);
      expect(await nights(dana, regId, later)).toEqual([[NEXT_FRIDAY, 1200]]);
    }
  });

  it("a fee from the Sunday the clocks go back, saved at 00:30 BST (Saturday in UTC): the Friday before keeps the old, the Friday after has it", async () => {
    const dana = await w.signedIn("dana@example.com");
    const sunday = new Date("2026-10-24T23:30:00Z"); // 00:30 BST on Sunday 25 October
    await fees(
      dana,
      [
        { pence: 1000, from: "2026-01-01" },
        { pence: 1100, from: "2026-10-25" },
      ],
      sunday,
    );
    const regId = await memberId(dana, "Reg Player");
    for (const day of ["2026-10-23", "2026-10-30"]) await cameTo(dana, regId, day);
    const after = new Date("2026-10-31T09:07:00Z");
    await chargeDue(w.env, after);
    expect(await nights(dana, regId, after)).toEqual([
      ["2026-10-23", 1000],
      ["2026-10-30", 1100],
    ]);
  });

  // ADR 0007: "Overriding one session's fee is not built"; nothing in the API takes one yet
  it.todo("a night's own fee beats the training's on that night only (not built yet)");
});

describe("a fee changed back in time, over nights whose register has closed", () => {
  it("a night paid at the old fee is recalculated: lower is credit, higher is owed, one charge each", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fees(dana, [{ pence: 1200, from: "2026-01-01" }]);
    const reg = await memberId(dana, "Reg Player");
    const pat = await memberId(dana, "Pat Payer");
    await cameTo(dana, reg, FRIDAY_BEFORE);
    await cameTo(dana, pat, LAST_FRIDAY);
    await dana.call("POST", `/api/members/${reg}/payments`, { via: "transfer", pence: 1200 });
    await dana.call("POST", `/api/members/${pat}/payments`, { via: "transfer", pence: 1200 });

    // Tuesday: both registers closed. The fee was £9 from 25 September, and £14 from 2 October
    await fees(dana, [
      { pence: 1200, from: "2026-01-01" },
      { pence: 900, from: FRIDAY_BEFORE },
      { pence: 1400, from: LAST_FRIDAY },
    ]);
    expect(await nights(dana, reg)).toEqual([[FRIDAY_BEFORE, 900]]);
    expect(await creditOf(dana, reg)).toBe(300);
    expect(await nights(dana, pat)).toEqual([[LAST_FRIDAY, 1400]]);
    const patCharge = ((await boot(dana)).charges as Charge[]).find((c) => c.memberId === pat)!;
    expect(patCharge).toMatchObject({ pence: 1400, paidPence: 1200 });
  });

  it("the hourly run after it changes nothing more: no night charged twice", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fees(dana, [{ pence: 1200, from: "2026-01-01" }]);
    const reg = await memberId(dana, "Reg Player");
    await cameTo(dana, reg, LAST_FRIDAY);
    await fees(dana, [
      { pence: 1200, from: "2026-01-01" },
      { pence: 900, from: LAST_FRIDAY },
    ]);
    const later = new Date("2026-10-07T09:07:00Z");
    await chargeDue(w.env, later);
    await chargeDue(w.env, later);
    expect(await nights(dana, reg, later)).toEqual([[LAST_FRIDAY, 900]]);
  });
});

describe("a fee of nothing from a date", () => {
  it("makes its nights free, with no £0 charge owed, and leaves the nights before it charged", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fees(dana, [
      { pence: 1000, from: "2026-01-01" },
      { pence: 0, from: LAST_FRIDAY },
    ]);
    const reg = await memberId(dana, "Reg Player");
    await cameTo(dana, reg, FRIDAY_BEFORE);
    await cameTo(dana, reg, LAST_FRIDAY);
    expect(await nights(dana, reg)).toEqual([[FRIDAY_BEFORE, 1000]]);
    const overdue = ((await boot(dana)).charges as Charge[]).filter((c) => c.pence === 0);
    expect(overdue).toEqual([]);
  });
});

describe("a Quarterly Member across a fee change", () => {
  it("isn't charged for a night before the change or after it, and stays so when it's changed back in time", async () => {
    const dana = await w.signedIn("dana@example.com");
    await fees(dana, [
      { pence: 1000, from: "2026-01-01" },
      { pence: 1200, from: LAST_FRIDAY },
    ]);
    const reg = await memberId(dana, "Reg Player");
    await dana.call(
      "POST",
      `/api/members/${reg}/quarterly`,
      { quarterly: true },
      { now: new Date("2026-09-01T11:00Z") },
    );
    await cameTo(dana, reg, FRIDAY_BEFORE);
    await cameTo(dana, reg, LAST_FRIDAY);
    await fees(dana, [
      { pence: 1000, from: "2026-01-01" },
      { pence: 800, from: FRIDAY_BEFORE },
    ]);
    expect(await nights(dana, reg)).toEqual([]);
  });
});
