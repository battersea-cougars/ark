// A night's register closes the next morning, at 06:00 London (decided 2026-10-23, #11; ADR 0030, ADR 0007): until
// then whoever takes the register ticks who came and the charges follow; from then it's the record. Every way of
// changing who was there is refused (the register, an admin putting someone in or taking them off, Let in, a reset,
// calling the night off, a member's attendance), and the hourly run charges from it as it stands. Driven through the
// real Worker handlers, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";
import { clubCharges } from "../dues/dues.testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Paul Payg", position: "F", rating: 55, email: "paul@example.com" },
  { name: "Walt Walkin", position: "F", rating: 50, email: "walt@example.com" },
  { name: "Nina Noshow", position: "D", rating: 52, email: "nina@example.com" },
];

// Friday 9 October 2026, 7:30 to 9:30pm BST; signed up the Tuesday before
const FRIDAY = "2026-10-09";
const TUESDAY = new Date("2026-10-06T11:00:00Z");
const ON_THE_NIGHT = new Date("2026-10-09T19:00:00Z");
/** Saturday 05:59 BST: still the night's evening, the register open */
const JUST_BEFORE = new Date("2026-10-10T04:59:00Z");
/** Saturday 06:00 BST: the register's closed */
const CLOSED = new Date("2026-10-10T05:00:00Z");
const REFUSED = "The register's closed: it closed at 6am the morning after.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** Friday at £8 a night, room for `capacity`: Reg and Nina signed up, the register taken on the night (Nina a
 * no-show, Walt walked in), as Dana runs it. */
async function friday({ capacity = 5, day = FRIDAY, signedUpAt = TUESDAY, night = ON_THE_NIGHT } = {}) {
  const dana = await w.signedIn("dana@example.com");
  const sees = async (now: Date) => (await dana.club({ now })).body as Json;
  const b = await sees(signedUpAt);
  const id = Object.fromEntries(b.members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
  const series = b.series[0];
  const put = await dana.call(
    "PUT",
    `/api/series/${series.id}`,
    { ...series, capacity, fees: [{ pence: 800, from: "2026-01-01" }] },
    { now: signedUpAt },
  );
  expect(put.status).toBe(200);
  const session = (await sees(signedUpAt)).sessions.find((s: Json) => s.heldOn === day);
  for (const email of ["reg@example.com", "nina@example.com"]) {
    const m = await w.signedIn(email);
    const said = await m.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" }, { now: signedUpAt });
    expect(said.status).toBe(200);
  }
  const register = (memberId: number, here: boolean, now: Date) =>
    dana.call("POST", `/api/sessions/${session.id}/register`, { memberId, here }, { now });
  expect((await register(id.Nina, false, night)).status).toBe(200);
  expect((await register(id.Walt, true, night)).status).toBe(200);
  const seen = async (now: Date) => (await sees(now)).sessions.find((s: Json) => s.id === session.id);
  /** Who's charged for the night, after the hourly run at `now` */
  const charged = async (now: Date) => {
    await w.scheduled("7 * * * *", now);
    return ((await clubCharges(dana, now)) as Json[])
      .filter((c) => c.kind === "session" && c.refId === session.id)
      .map((c) => [c.memberId, c.pence])
      .sort((a, b) => a[0] - b[0]);
  };
  return { dana, id, session, register, seen, charged };
}

describe("the register closes the morning after", () => {
  it("at 05:59 the next morning it can still be put right: Nina came after all", async () => {
    const f = await friday();
    expect((await f.register(f.id.Nina, true, JUST_BEFORE)).status).toBe(200);
    expect((await f.seen(JUST_BEFORE)).noShows).toEqual([]);
  });

  it("from 06:00 the register refuses a tick, in plain words, and who came stays as it was", async () => {
    const f = await friday();
    const res = await f.register(f.id.Nina, true, CLOSED);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(REFUSED);
    expect((await f.register(f.id.Walt, false, CLOSED)).status).toBe(409);
    expect((await f.register(f.id.Paul, true, CLOSED)).status).toBe(409);
    expect(await f.seen(CLOSED)).toMatchObject({ noShows: [f.id.Nina], walkIns: [f.id.Walt] });
    expect((await f.seen(CLOSED)).going.sort()).toEqual([f.id.Reg, f.id.Nina, f.id.Walt].sort());
  });

  it("an admin can't put someone in or take them off once it's closed, one at a time or as a batch", async () => {
    const f = await friday();
    const players = (body: unknown) =>
      f.dana.call("POST", `/api/sessions/${f.session.id}/players`, body, { now: CLOSED });
    expect((await players({ memberId: f.id.Paul, in: true })).status).toBe(409);
    expect((await players({ memberId: f.id.Reg, in: false })).status).toBe(409);
    expect((await players({ players: [{ memberId: f.id.Paul, in: true }] })).status).toBe(409);
    expect((await f.seen(CLOSED)).going).not.toContain(f.id.Paul);
    expect((await f.seen(CLOSED)).going).toContain(f.id.Reg);
  });

  it("nobody waiting is let in once it's closed", async () => {
    // Room for one: Reg's in, Nina waits (she's a no-show: the register marked her, waiting, as not here)
    const f = await friday({ capacity: 1 });
    expect((await f.seen(CLOSED)).waitlist).toContain(f.id.Nina);
    const res = await f.dana.call(
      "POST",
      `/api/sessions/${f.session.id}/let-in`,
      { memberId: f.id.Nina },
      { now: CLOSED },
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(REFUSED);
    expect((await f.seen(CLOSED)).waitlist).toContain(f.id.Nina);
  });

  it("a closed night can't be reset, called off, or put back on: its charges stand", async () => {
    const f = await friday();
    const before = await f.charged(CLOSED);
    const reset = await f.dana.call("POST", `/api/sessions/${f.session.id}/reset`, undefined, { now: CLOSED });
    expect(reset.status).toBe(409);
    const off = await f.dana.call(
      "POST",
      `/api/sessions/${f.session.id}/cancelled`,
      { cancelled: true },
      { now: CLOSED },
    );
    expect(off.status).toBe(409);
    expect(off.body.error).toBe(REFUSED);
    expect(await f.seen(CLOSED)).toMatchObject({ cancelledAt: null });
    expect(await f.charged(CLOSED)).toEqual(before);
  });

  it("a member's attendance can't change a closed night, and none of a batch with one in it is saved", async () => {
    const f = await friday();
    const later = (await f.dana.club({ now: CLOSED })).body.sessions.find(
      (s: Json) => s.seriesId === f.session.seriesId && s.heldOn > FRIDAY,
    );
    const res = await f.dana.call(
      "PUT",
      `/api/members/${f.id.Nina}/attendance`,
      {
        marks: [
          { sessionId: later.id, here: true },
          { sessionId: f.session.id, here: true },
        ],
      },
      { now: CLOSED },
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(REFUSED);
    expect((await f.seen(CLOSED)).noShows).toEqual([f.id.Nina]);
    const next = (await f.dana.club({ now: CLOSED })).body.sessions.find((s: Json) => s.id === later.id);
    expect(next.going).not.toContain(f.id.Nina);
  });
});

describe("what it charges", () => {
  it("the hourly run charges from the closed register, run after run, once each: Reg and Walt, not Nina", async () => {
    const f = await friday();
    const expected = [
      [f.id.Reg, 800],
      [f.id.Walt, 800],
    ].sort((a, b) => a[0] - b[0]);
    expect(await f.charged(CLOSED)).toEqual(expected);
    expect(await f.charged(new Date("2026-10-10T06:07:00Z"))).toEqual(expected);
    expect(await f.charged(new Date("2026-10-12T09:07:00Z"))).toEqual(expected);
  });
});

describe("the morning the clocks go back", () => {
  // Saturday 24 October 2026 is BST; the clocks go back at 2am Sunday, so 06:00 Sunday is 06:00 GMT
  it("a Saturday night's register closes at 06:00 GMT on Sunday, an hour later in UTC than the week before", async () => {
    const SATURDAY = "2026-10-24";
    const dana = await w.signedIn("dana@example.com");
    const b = (await dana.club({ now: TUESDAY })).body as Json;
    const series = b.series[0];
    expect(
      (
        await dana.call(
          "PUT",
          `/api/series/${series.id}`,
          { ...series, weekdays: ["sat"], fees: [{ pence: 800, from: "2026-01-01" }] },
          { now: TUESDAY },
        )
      ).status,
    ).toBe(200);
    const night = ((await dana.club({ now: TUESDAY })).body as Json).sessions.find((s: Json) => s.heldOn === SATURDAY);
    const reg = (await dana.club({ now: TUESDAY })).body.members.find((m: Json) => m.name === "Reg Player").id;
    const tick = (now: string) =>
      dana.call("POST", `/api/sessions/${night.id}/register`, { memberId: reg, here: true }, { now: new Date(now) });
    expect((await tick("2026-10-25T05:59:00Z")).status).toBe(200);
    expect((await tick("2026-10-25T06:00:00Z")).status).toBe(409);
  });
});
