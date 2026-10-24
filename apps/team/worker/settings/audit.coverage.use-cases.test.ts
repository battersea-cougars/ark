// Everything an admin, a team maker, a scorer or a treasurer does is on the record (ADR 0095, #80), not just roles,
// members and money: a venue, a training's fee, the register on the night. A member's own changes stay off it, and
// say why in the route table (api.security.test.ts). Driven through the real Worker handlers (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Browser = Awaited<ReturnType<typeof w.signedIn>>;
const record = async (dana: Browser) => (await dana.call("GET", "/api/audit")).body.entries as Json[];

describe("an admin's changes are on the record", () => {
  it("saving a venue, with what it was and what it is", async () => {
    const dana = await w.signedIn("dana@example.com");
    const r = await dana.call("POST", "/api/venues", { name: "Rink Two", address: "1 Park Rd", mapUrl: "" });
    expect(r.status).toBe(201);
    expect((await record(dana)).find((e) => e.action === "venue.added")).toMatchObject({
      detail: { from: null, to: expect.objectContaining({ name: "Rink Two" }) },
    });
  });

  it("a training's fee changing", async () => {
    const dana = await w.signedIn("dana@example.com");
    const series = (await dana.call("GET", "/api/bootstrap")).body.series[0];
    await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [{ pence: 800, from: "2026-01-01" }] });
    const e = (await record(dana)).find((x) => x.action === "training.updated");
    expect(JSON.stringify(e.detail.to)).toContain("800");
  });

  it("the register on the night: who was there, which makes the charges", async () => {
    const dana = await w.signedIn("dana@example.com");
    const b = (await dana.call("GET", "/api/bootstrap")).body;
    const reg = b.members.find((m: Json) => m.name === "Reg Player").id;
    const session = b.sessions.find((s: Json) => s.heldOn === "2026-10-02").id;
    // Past midnight, the night over, before its register closes at 6am (#11): a walk-in on the record
    await dana.call(
      "POST",
      `/api/sessions/${session}/register`,
      { memberId: reg, here: true },
      { now: new Date("2026-10-03T00:30:00Z") },
    );
    expect((await record(dana)).find((x) => x.action === "register.marked")).toMatchObject({
      detail: { from: [], to: [expect.objectContaining({ memberId: reg, walkIn: 1 })] },
    });
  });

  it("a member's own sign-up stays off it", async () => {
    const reg = await w.signedIn("reg@example.com");
    const session = (await reg.call("GET", "/api/bootstrap")).body.sessions.find(
      (s: Json) => s.heldOn >= "2026-10-06",
    ).id;
    await reg.call("POST", `/api/sessions/${session}/answer`, { answer: "in" });
    const dana = await w.signedIn("dana@example.com");
    expect((await record(dana)).map((e) => e.action)).not.toContain("signups.changed");
  });
});
