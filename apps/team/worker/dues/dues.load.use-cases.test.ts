// Keeping under the free plan's 10 ms of CPU a request (ADR 0059): every round trip to D1 costs the Worker CPU time,
// so a tap costs a few, however many members, quarters and Fridays the club's dues cover. Driven through the real
// handlers in the fake world (ADR 0031), which counts the round trips.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chargeDue } from "./dues";
import { onTheNight, testWorld } from "../testing";
import { chargesOf } from "./dues.testing";

// NOW is Tuesday 6 October 2026: the next Friday is the 9th
const NEXT_FRIDAY = "2026-10-09";
// Five coming Fridays: a past one's register closes the morning after (#11), so a save of many is of nights ahead
const FRIDAYS = ["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06"];
const LAST_FRIDAY = "2026-10-02";

const club = (size: number) => [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  ...Array.from({ length: size }, (_, i) => ({
    name: `Quarterly ${i + 1}`,
    position: "F",
    rating: 50,
    email: `q${i + 1}@example.com`,
  })),
];

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

type Browser = Awaited<ReturnType<typeof w.signedIn>>;
const boot = async (b: Browser) => (await b.call("GET", "/api/bootstrap")).body;
const memberId = async (b: Browser, name: string) =>
  (await boot(b)).members.find((m: { name: string }) => m.name === name).id as number;
/** A session coming up, as anyone sees it. */
const sessionOn = async (b: Browser, day: string) =>
  (await boot(b)).sessions.find((s: { heldOn: string }) => s.heldOn === day).id as number;
/** A past Friday, from a member's attendance (an admin's view, which goes back to January). */
const fridayOn = async (admin: Browser, day: string) =>
  (await admin.call("GET", `/api/members/${await memberId(admin, "Reg Player")}/attendance`)).body.find(
    (s: { heldOn: string }) => s.heldOn === day,
  ).sessionId as number;

/** Round trips to the club's database a request costs. */
async function tripsFor(request: () => Promise<{ status: number }>) {
  const before = w.db.roundTrips;
  expect((await request()).status).toBe(200);
  return w.db.roundTrips - before;
}

/** A club where `size` members have paid quarterly since the start of last year. */
async function clubWithQuarterly(size: number) {
  w = testWorld(club(size));
  const dana = await w.signedIn("dana@example.com");
  await dana.call("POST", "/api/subscription-fees", { pence: 6000, from: "2025-01-01" });
  for (let i = 1; i <= size; i++)
    await dana.call(
      "POST",
      `/api/members/${await memberId(dana, `Quarterly ${i}`)}/quarterly`,
      { quarterly: true },
      { now: new Date("2025-01-10T11:00:00Z") },
    );
  return { dana, reg: await w.signedIn("reg@example.com") };
}

describe("a tap costs a few round trips, however big the club's dues get", () => {
  it("signing up for Friday costs the same with twenty Quarterly Members, seven quarters in, as with one", async () => {
    const small = await clubWithQuarterly(1);
    const one = await tripsFor(async () =>
      small.reg.call("POST", `/api/sessions/${await sessionOn(small.reg, NEXT_FRIDAY)}/answer`, { answer: "in" }),
    );
    const big = await clubWithQuarterly(20);
    const twenty = await tripsFor(async () =>
      big.reg.call("POST", `/api/sessions/${await sessionOn(big.reg, NEXT_FRIDAY)}/answer`, { answer: "in" }),
    );
    expect(twenty).toBe(one);
    // Signing in, the answer, charges, and the club back: none of it grows with the club
    expect(one).toBeLessThanOrEqual(20);
  }, 30_000); // counts round trips, not time: seven quarters of charges take a while to set up on a busy machine

  it("an admin records five coming Fridays of someone's attendance in one save: one request, each Friday charged on its day", async () => {
    const { dana } = await clubWithQuarterly(1);
    const reg = await memberId(dana, "Reg Player");
    const marks = await Promise.all(
      FRIDAYS.map(async (day) => ({ sessionId: await sessionOn(dana, day), here: true })),
    );

    const trips = await tripsFor(() => dana.call("PUT", `/api/members/${reg}/attendance`, { marks }));

    for (const m of marks)
      expect(
        await w.db
          .prepare("SELECT signup, attended FROM attendance WHERE session_id = ? AND member_id = ?")
          .bind(m.sessionId, reg)
          .first(),
      ).toMatchObject({ signup: "in", attended: 1 });
    // Each charged on its day, by the hourly run
    await chargeDue(w.env, onTheNight(FRIDAYS[4]));
    const charged = await w.db
      .prepare("SELECT due_on dueOn FROM charges WHERE member_id = ? AND session_id IS NOT NULL ORDER BY due_on")
      .bind(reg)
      .all<{ dueOn: string }>();
    expect(charged.results.map((c) => c.dueOn)).toEqual(FRIDAYS);
    // As few as one Friday's
    const one = await tripsFor(() =>
      dana.call("PUT", `/api/members/${reg}/attendance`, { marks: [{ sessionId: marks[0].sessionId, here: false }] }),
    );
    expect(trips).toBe(one);
  });

  it("the same save takes Fridays back: a sign-up becomes a no-show, a walk-in comes off", async () => {
    const { dana, reg: regBrowser } = await clubWithQuarterly(1);
    const reg = await memberId(dana, "Reg Player");
    const signedUp = await sessionOn(dana, NEXT_FRIDAY);
    await regBrowser.call("POST", `/api/sessions/${signedUp}/answer`, { answer: "in" });
    const walkIn = await sessionOn(dana, FRIDAYS[1]);
    await dana.call("PUT", `/api/members/${reg}/attendance`, { marks: [{ sessionId: walkIn, here: true }] });

    const r = await dana.call("PUT", `/api/members/${reg}/attendance`, {
      marks: [
        { sessionId: signedUp, here: false },
        { sessionId: walkIn, here: false },
      ],
    });
    expect(r.status).toBe(200);

    const row = async (id: number) =>
      await w.db
        .prepare("SELECT signup, attended FROM attendance WHERE session_id = ? AND member_id = ?")
        .bind(id, reg)
        .first();
    expect(await row(signedUp)).toMatchObject({ signup: "in", attended: 0 });
    expect(await row(walkIn)).toBeNull();
    expect(await chargesOf(dana, reg)).toEqual([]);
  });

  it("only whoever keeps the register can, and a mark needs a session and here or not", async () => {
    const { dana, reg: regBrowser } = await clubWithQuarterly(1);
    const reg = await memberId(dana, "Reg Player");
    const session = await fridayOn(dana, LAST_FRIDAY);
    const put = (b: Browser, marks: unknown) => b.call("PUT", `/api/members/${reg}/attendance`, { marks });
    expect((await put(regBrowser, [{ sessionId: session, here: true }])).status).toBe(403);
    expect((await put(dana, [{ sessionId: session, here: "yes" }])).status).toBe(400);
    expect((await put(dana, "nope")).status).toBe(400);
    expect((await put(dana, [{ sessionId: 99999, here: true }])).status).toBe(404);
  });
});
