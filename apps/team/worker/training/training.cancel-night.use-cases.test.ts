// An admin calls off a training night from its own page (ADR 0065, ADR 0030): Friday Training's Manage has Cancel this
// night, which first says who'll hear it's off, then goes through the night's own cancel (`POST
// /api/sessions/:id/cancelled`, `manage:Training`), the same one the training editor and the clash sheet use. The
// page then shows that night struck through above the next one, and Manage puts it back on. The case: the Kumite on a
// Friday, and that Friday's training still open. Driven through the real Worker handlers; what the page shows is
// worked out from the bootstrap by the page's own rule (lib/night-off.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";
import { offWords, signedUp, trainingNights } from "../../src/lib/night-off";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Tess Teams", position: "F", rating: 60, email: "tess@example.com", roles: ["Session lead"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Wes Waiting", position: "F", rating: 50, email: "wes@example.com" },
  { name: "Olly Out", position: "D", rating: 55, email: "olly@example.com" },
];
// NOW is Tuesday 6 October 2026: Friday Training's next night is the 9th, the one after the 16th
const TODAY = "2026-10-06";
const KUMITE_FRIDAY = "2026-10-09";
const FRIDAY_AFTER = "2026-10-16";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Browser = Awaited<ReturnType<typeof w.signedIn>>;
const boot = async (b: Browser) => (await b.call("GET", "/api/bootstrap")).body as Json;

/** A member with the app on their phone, so they hear a night's off. */
async function phone(email: string) {
  const b = await w.signedIn(email);
  await b.call("PUT", "/api/auth/device", { token: `token-${email}`, platform: "ios" });
  return b;
}

/** Friday Training with room for one skater: Reg's in, Wes waits, Olly's said he's out. */
async function friday() {
  const dana = await w.signedIn("dana@example.com");
  const series = (await boot(dana)).series[0];
  expect((await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 1 })).status).toBe(200);
  const night = (await boot(dana)).sessions.find((s: Json) => s.heldOn === KUMITE_FRIDAY);
  for (const [email, answer] of [
    ["reg@example.com", "in"],
    ["wes@example.com", "in"],
    ["olly@example.com", "out"],
  ])
    expect((await (await phone(email)).call("POST", `/api/sessions/${night.id}/answer`, { answer })).status).toBe(200);

  /** Friday Training's page, as this person sees it: the night it's on, and what's off before it. */
  const page = async (b: Browser = dana) => trainingNights((await boot(b)).sessions as Json[], series.id, TODAY);
  const cancel = (b: Browser, id: number, cancelled: boolean) =>
    b.call("POST", `/api/sessions/${id}/cancelled`, { cancelled });
  return { dana, series, night, page, cancel };
}
const heard = () => w.pushes.map((p) => `${p.token.replace("token-", "").split("@")[0]}: ${p.title}`);

describe("an admin cancels a training night from its own page", () => {
  it("the Kumite's Friday: the page's night, the confirm saying who hears it, and the night off for everyone", async () => {
    const f = await friday();
    // The page is the 9th, and the confirm says the two in or waiting hear it (not Olly, who's out)
    const before = await f.page();
    expect(before.shown).toMatchObject({ id: f.night.id, heldOn: KUMITE_FRIDAY, cancelledAt: null });
    expect(offWords(signedUp(before.shown))).toBe("2 signed up hear it's off if you cancel it.");

    expect((await f.cancel(f.dana, f.night.id, true)).status).toBe(200);

    // Reg (in) and Wes (waiting) hear it on their phones; Olly doesn't
    expect(heard().sort()).toEqual(["reg: Fri 9 Oct is off", "wes: Fri 9 Oct is off"]);
    // Everyone's page: the 9th struck through above the next Friday, which is the one to sign up for
    const reg = await w.signedIn("reg@example.com");
    for (const b of [f.dana, reg]) {
      const after = await f.page(b);
      expect(after.off.map((s: Json) => s.heldOn)).toEqual([KUMITE_FRIDAY]);
      expect(after.off[0].cancelledAt).not.toBeNull();
      expect(after.shown.heldOn).toBe(FRIDAY_AFTER);
    }
  });

  it("It's back on: the night is the page again, with who was in and waiting, and nobody hears it twice", async () => {
    const f = await friday();
    await f.cancel(f.dana, f.night.id, true);
    w.pushes.length = 0;

    // Manage's It's back on, for the night the page shows struck through
    const [off] = (await f.page()).off;
    expect((await f.cancel(f.dana, off.id, false)).status).toBe(200);

    const page = await f.page();
    expect(page.off).toEqual([]);
    expect(page.shown).toMatchObject({ id: f.night.id, cancelledAt: null, going: [expect.any(Number)] });
    expect(page.shown.waitlist).toHaveLength(1);
    // Back on isn't news to send
    expect(heard()).toEqual([]);
  });

  it("a night nobody's signed up for: the confirm says so, and it goes off quietly", async () => {
    const f = await friday();
    const next = (await f.page()).shown;
    await f.cancel(f.dana, next.id, true);
    const empty = (await f.page()).shown;
    expect(empty.heldOn).toBe(FRIDAY_AFTER);
    expect(offWords(signedUp(empty))).toBe("Nobody's signed up yet.");
    w.pushes.length = 0;
    expect((await f.cancel(f.dana, empty.id, true)).status).toBe(200);
    expect(heard()).toEqual([]);
    // Both struck through, in order, above the one after
    expect((await f.page()).off.map((s: Json) => s.heldOn)).toEqual([KUMITE_FRIDAY, FRIDAY_AFTER]);
  });

  it("a session lead, who has Manage for the register, can't cancel the night: it's manage:Training", async () => {
    const f = await friday();
    const tess = await w.signedIn("tess@example.com");
    expect((await f.cancel(tess, f.night.id, true)).status).toBe(403);
    expect((await f.page()).shown).toMatchObject({ id: f.night.id, cancelledAt: null });
    expect(heard()).toEqual([]);
  });
});
