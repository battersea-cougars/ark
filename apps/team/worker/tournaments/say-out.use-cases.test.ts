// Saying you can't make it, from the Kumite's page (ADR 0074): once you've answered, your answer is the header's badge,
// and its sheet's Can't make it says you're out, through the same answer the sign-up card uses.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
const KUMITE = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

describe("saying you're out of a Kumite you're in", () => {
  it("a member who's in says they can't make it, and they're out; while sign-up's open they can come back in", async () => {
    const dana = await w.signedIn("dana@example.com");
    const made = await dana.call("POST", "/api/tournaments", {
      typeId: KUMITE,
      name: "The Cougars Kumite",
      heldOn: "2026-12-11",
      status: "open",
    });
    expect(made.status).toBe(201);
    const id = made.body.id as number;

    const reg = await w.signedIn("reg@example.com");
    const sees = async () =>
      ((await reg.call("GET", "/api/bootstrap")).body as Json).tournaments.find((t: Json) => t.id === id);
    const me = ((await reg.call("GET", "/api/bootstrap")).body as Json).me as number;

    expect((await reg.call("POST", `/api/tournaments/${id}/answer`, { answer: "in" })).status).toBe(200);
    expect((await sees()).going).toContain(me);

    // The header's badge, You're in; its sheet's Can't make it
    expect((await reg.call("POST", `/api/tournaments/${id}/answer`, { answer: "out" })).status).toBe(200);
    const after = await sees();
    expect(after.going).not.toContain(me);
    expect(after.out).toContain(me);

    // Changed their mind, sign-up still open: I'm in
    expect((await reg.call("POST", `/api/tournaments/${id}/answer`, { answer: "in" })).status).toBe(200);
    expect((await sees()).going).toContain(me);
  });
});
