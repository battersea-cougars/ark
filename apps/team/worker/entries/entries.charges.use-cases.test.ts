// Signing up, and what people owe (ADR 0007): a night or a tournament is charged from its day, so a sign-up days
// before can't change what anyone owes, and the club's charges aren't worked out again for it. They were, after every
// tap: with a year of nights behind the club that read about 50,000 rows a tap, a Friday's sign-ups more than D1's free
// day (docs/reviews/free-tier-2026-11-02.md). On the day itself a sign-up is charged at once, as before. Driven
// through the real Worker handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { chargesOf } from "../dues/dues.testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
// NOW is Tuesday 6 October 2026; the next Friday is the 9th
const NEXT_FRIDAY = "2026-10-09";
const FRIDAY_MORNING = new Date("2026-10-09T09:00:00Z");

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** Friday Training at £8 a night; the next Friday's session and Reg's id. */
async function eightPoundFridays(dana: Browser) {
  const club = (await dana.club()).body;
  const series = club.series[0];
  expect(
    (await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [{ pence: 800, from: "2026-01-01" }] }))
      .status,
  ).toBe(200);
  const after = (await dana.club()).body;
  return {
    session: after.sessions.find((s: { heldOn: string }) => s.heldOn === NEXT_FRIDAY).id as number,
    reg: after.members.find((m: { name: string }) => m.name === "Reg Player").id as number,
  };
}

/** The statements D1 runs while `act` does, as written. */
async function statementsOf(act: () => Promise<unknown>) {
  const sent: string[] = [];
  const raw = w.db.raw;
  const prepare = raw.prepare.bind(raw);
  const spy = vi.spyOn(raw, "prepare").mockImplementation(((sql: string) => {
    sent.push(sql);
    return prepare(sql);
  }) as typeof raw.prepare);
  await act();
  spy.mockRestore();
  return sent;
}
const workOutCharges = (sql: string[]) => sql.filter((s) => /INSERT INTO charges/.test(s));

describe("a sign-up and the club's charges", () => {
  it("in on Tuesday for Friday: nobody's charges are worked out again, and nothing's owed yet", async () => {
    const dana = await w.signedIn("dana@example.com");
    const { session, reg: regId } = await eightPoundFridays(dana);
    const reg = await w.signedIn("reg@example.com");
    const sql = await statementsOf(async () =>
      expect((await reg.call("POST", `/api/sessions/${session}/answer`, { answer: "in" }, { now: NOW })).status).toBe(
        200,
      ),
    );
    expect(workOutCharges(sql)).toEqual([]);
    expect(await chargesOf(dana, regId)).toEqual([]);
  });

  it("in on Friday morning: charged that night's fee at once, as before", async () => {
    const dana = await w.signedIn("dana@example.com");
    const { session, reg: regId } = await eightPoundFridays(dana);
    const reg = await w.signedIn("reg@example.com");
    const sql = await statementsOf(async () =>
      expect(
        (await reg.call("POST", `/api/sessions/${session}/answer`, { answer: "in" }, { now: FRIDAY_MORNING })).status,
      ).toBe(200),
    );
    expect(workOutCharges(sql).length).toBeGreaterThan(0);
    expect(await chargesOf(dana, regId, FRIDAY_MORNING)).toEqual([
      expect.objectContaining({ refId: session, pence: 800 }),
    ]);
    // And out again that morning: the charge goes with the answer
    expect(
      (await reg.call("POST", `/api/sessions/${session}/answer`, { answer: "out" }, { now: FRIDAY_MORNING })).status,
    ).toBe(200);
    expect(await chargesOf(dana, regId, FRIDAY_MORNING)).toEqual([]);
  });
});
