// A member's bank reference is what their standing order quotes, so once it's given it stays: a name edited later
// keeps it, and someone who has none yet gets one the next time they sign in. Driven through the real Worker handlers
// in the fake world (ADR 0031); the name rules themselves are packages/shared/payment-reference.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

const referenceOf = (email: string) =>
  (w.db.raw.prepare("SELECT payment_reference r FROM members WHERE email = ?").get(email) as { r: string | null }).r;

describe("a member's bank reference", () => {
  it("stays as it was when an admin changes their name: it's what their standing order quotes", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = (await dana.club()).body.members.find((m: Json) => m.name === "Reg Player");
    expect(referenceOf("reg@example.com")).toBe("COUGARS REG P");

    expect((await dana.call("PUT", `/api/members/${reg.id}`, { ...reg, name: "Reginald Smith" })).status).toBe(200);

    expect((await dana.club()).body.members.find((m: Json) => m.id === reg.id).name).toBe("Reginald Smith");
    expect(referenceOf("reg@example.com")).toBe("COUGARS REG P");
  });

  it("someone without one gets theirs the next time they sign in", async () => {
    w.db.raw.prepare("UPDATE members SET payment_reference = NULL WHERE email = 'reg@example.com'").run();

    await w.signedIn("reg@example.com");

    expect(referenceOf("reg@example.com")).toBe("COUGARS REG P");
  });
});
