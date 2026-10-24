// Once a quarter the club asks its members whether they want to be Quarterly Members or pay as they go for the next
// quarter (ADR 0007). A member chooses next quarter's plan on their Dues page, and can change their mind until it
// starts; this quarter's is fixed. The server checks the date, whatever the app showed: one left open past the
// quarter's start can't change it. Driven through the real handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chargeDue } from "./dues";
import { testWorld } from "../testing";
import { clubCharges } from "./dues.testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

// NOW is Tuesday 6 October 2026, in Q4; next quarter is 2027-Q1, from 1 January
const on = (day: string) => new Date(`${day}T11:00:00Z`);
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
const mine = async (b: Browser, now?: Date) => {
  const body = (await b.club(now ? { now } : {})).body;
  return body.members.find((m: { id: number }) => m.id === body.me) as { quarterly: boolean; quarterlyNext: boolean };
};
const choose = (b: Browser, quarter: string, quarterly: boolean, now?: Date) =>
  b.call("PUT", "/api/me/plan", { quarter, quarterly }, now ? { now } : {});
const quartersCharged = async (dana: Browser, now: Date) =>
  (await clubCharges(dana, now)).filter((c) => c.kind === "quarter").map((c) => c.quarter);

describe("a member chooses next quarter's plan", () => {
  it("pay as you go now, Quarterly from next quarter: this quarter stays as it is", async () => {
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/subscription-fees", { pence: 9000, from: "2026-01-01" });
    const reg = await w.signedIn("reg@example.com");

    expect((await choose(reg, "2027-Q1", true)).status).toBe(200);
    expect(await mine(reg)).toMatchObject({ quarterly: false, quarterlyNext: true });

    await chargeDue(w.env, on("2026-10-06"));
    expect(await quartersCharged(dana, on("2026-10-06"))).toEqual([]);
    await chargeDue(w.env, on("2027-01-01"));
    expect(await quartersCharged(dana, on("2027-01-01"))).toEqual(["2027-Q1"]);
  });

  it("a Quarterly Member goes back to pay as you go from next quarter; this quarter's still covered", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await w.signedIn("reg@example.com");
    const regId = (await reg.club()).body.me;
    await dana.call("POST", `/api/members/${regId}/quarterly`, { quarterly: true }, { now: on("2026-10-01") });

    expect((await choose(reg, "2027-Q1", false)).status).toBe(200);
    expect(await mine(reg)).toMatchObject({ quarterly: true, quarterlyNext: false });
    expect(await mine(reg, on("2026-12-31"))).toMatchObject({ quarterly: true });
    expect(await mine(reg, on("2027-01-01"))).toMatchObject({ quarterly: false });
  });

  it("they can change their mind until the quarter starts", async () => {
    const reg = await w.signedIn("reg@example.com");
    await choose(reg, "2027-Q1", true);
    await choose(reg, "2027-Q1", false);
    expect(await mine(reg)).toMatchObject({ quarterly: false, quarterlyNext: false });
    await choose(reg, "2027-Q1", true, on("2026-12-31"));
    expect(await mine(reg, on("2026-12-31"))).toMatchObject({ quarterlyNext: true });
  });

  it("this quarter is fixed, and only next quarter is open", async () => {
    const reg = await w.signedIn("reg@example.com");
    expect(await choose(reg, "2026-Q4", true)).toMatchObject({
      status: 409,
      body: { error: "2026-Q4 has started: its plan is fixed. Ask an admin if it's wrong." },
    });
    expect((await choose(reg, "2027-Q2", true)).status).toBe(409);
    expect((await choose(reg, "Q1", true)).status).toBe(400);
  });

  it("an app left open past the quarter's start can't change it: the server goes by today's date", async () => {
    const reg = await w.signedIn("reg@example.com");
    // The page still offers 2027-Q1, but it's 1 January now
    expect((await choose(reg, "2027-Q1", true, on("2027-01-01"))).status).toBe(409);
    expect(await mine(reg, on("2027-01-01"))).toMatchObject({ quarterly: false });
  });

  it("the choice is on the record", async () => {
    const reg = await w.signedIn("reg@example.com");
    await choose(reg, "2027-Q1", true);
    const dana = await w.signedIn("dana@example.com");
    const { entries } = (await dana.call("GET", "/api/audit")).body as { entries: { action: string }[] };
    expect(entries.map((e) => e.action)).toContain("member.plan");
  });
});
