// How many Fridays someone has played (#177), on their player card: counted once, as each night's register closes at
// 06:00 the morning after, not every night ever played counted again on every open. Until it closes the night is
// still counted from who came, so a tick or an untick on the night (an attendance update) shows at once; from then
// the stored count is the record. Driven through the real Worker handlers, each person signed in as themselves.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Walt Walkin", position: "F", rating: 50, email: "walt@example.com" },
  { name: "Nina Noshow", position: "D", rating: 52, email: "nina@example.com" },
];

// Fridays 9 and 16 October 2026, each signed up for the Tuesday before
const TUESDAY = new Date("2026-10-06T11:00:00Z");
const TUESDAY_BEFORE = (day: string) => new Date(Date.parse(`${day}T11:00:00Z`) - 3 * 86_400_000);
const NIGHT = (day: string) => new Date(`${day}T19:00:00Z`);
/** Saturday 05:59 BST: the register still open */
const JUST_BEFORE = (day: string) => new Date(Date.parse(`${day}T04:59:00Z`) + 86_400_000);
/** Saturday 06:07 BST: closed, and the hourly run has been */
const AFTER = (day: string) => new Date(Date.parse(`${day}T05:07:00Z`) + 86_400_000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

async function club() {
  const dana = await w.signedIn("dana@example.com");
  const sees = async (now: Date) => (await dana.call("GET", "/api/bootstrap", undefined, { now })).body as Json;
  const b = await sees(TUESDAY);
  const id = Object.fromEntries(b.members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
  const sessionOn = (day: string) => b.sessions.find((s: Json) => s.heldOn === day).id as number;
  /** Reg and Nina sign up; on the night Nina's a no-show and Walt walks in. */
  async function night(day: string) {
    for (const email of ["reg@example.com", "nina@example.com"]) {
      const m = await w.signedIn(email);
      const said = await m.call(
        "POST",
        `/api/sessions/${sessionOn(day)}/answer`,
        { answer: "in" },
        { now: TUESDAY_BEFORE(day) },
      );
      expect(said.status).toBe(200);
    }
    expect((await register(day, id.Nina, false, NIGHT(day))).status).toBe(200);
    expect((await register(day, id.Walt, true, NIGHT(day))).status).toBe(200);
  }
  const register = (day: string, memberId: number, here: boolean, now: Date) =>
    dana.call("POST", `/api/sessions/${sessionOn(day)}/register`, { memberId, here }, { now });
  /** Each one's played, as the app shows it at `now`. */
  const played = async (now: Date) => {
    const members = (await sees(now)).members as Json[];
    return Object.fromEntries(members.map((m) => [m.name.split(" ")[0], m.played]));
  };
  /** What's stored: the nights counted as their registers closed. */
  const stored = () =>
    Object.fromEntries(
      (w.db.raw.prepare("SELECT name, played FROM members").all() as { name: string; played: number }[]).map((m) => [
        m.name.split(" ")[0],
        m.played,
      ]),
    );
  return { dana, id, night, register, played, stored, sessionOn };
}

describe("the Fridays someone played", () => {
  it("count the night they came from the next day, and keep it once its register has closed", async () => {
    const c = await club();
    await c.night("2026-10-09");
    // On the night: not played yet (it's today)
    expect(await c.played(NIGHT("2026-10-09"))).toMatchObject({ Reg: 0, Walt: 0, Nina: 0 });
    // Saturday 05:59: played, from who came; nothing stored yet
    expect(await c.played(JUST_BEFORE("2026-10-09"))).toMatchObject({ Reg: 1, Walt: 1, Nina: 0, Dana: 0 });
    expect(c.stored()).toMatchObject({ Reg: 0, Walt: 0 });
    // 06:00 it closes; the hourly run counts it, once, and the card says the same
    await c.dana.call("GET", "/api/bootstrap", undefined, { now: AFTER("2026-10-09") });
    await w.scheduled("7 * * * *", AFTER("2026-10-09"));
    await w.scheduled("7 * * * *", AFTER("2026-10-09"));
    expect(c.stored()).toMatchObject({ Reg: 1, Walt: 1, Nina: 0 });
    expect(await c.played(AFTER("2026-10-09"))).toMatchObject({ Reg: 1, Walt: 1, Nina: 0 });
  });

  it("an attendance update before the register closes is what's counted: Walt didn't come after all, Nina did", async () => {
    const c = await club();
    await c.night("2026-10-09");
    expect((await c.register("2026-10-09", c.id.Walt, false, JUST_BEFORE("2026-10-09"))).status).toBe(200);
    expect((await c.register("2026-10-09", c.id.Nina, true, JUST_BEFORE("2026-10-09"))).status).toBe(200);
    expect(await c.played(JUST_BEFORE("2026-10-09"))).toMatchObject({ Reg: 1, Walt: 0, Nina: 1 });
    await w.scheduled("7 * * * *", AFTER("2026-10-09"));
    // Closed: a tick now is refused, and the count stands
    expect((await c.register("2026-10-09", c.id.Walt, true, AFTER("2026-10-09"))).status).toBe(409);
    expect(c.stored()).toMatchObject({ Reg: 1, Walt: 0, Nina: 1 });
    expect(await c.played(AFTER("2026-10-09"))).toMatchObject({ Reg: 1, Walt: 0, Nina: 1 });
  });

  it("adds each Friday as it closes, and the open of the day after counts only the night not closed yet", async () => {
    const c = await club();
    await c.night("2026-10-09");
    await w.scheduled("7 * * * *", AFTER("2026-10-09"));
    await c.night("2026-10-16");
    // Saturday 05:59 after the second: one stored, one counted from who came
    expect(c.stored()).toMatchObject({ Reg: 1, Walt: 1 });
    expect(await c.played(JUST_BEFORE("2026-10-16"))).toMatchObject({ Reg: 2, Walt: 2, Nina: 0 });
    await w.scheduled("7 * * * *", AFTER("2026-10-16"));
    expect(c.stored()).toMatchObject({ Reg: 2, Walt: 2, Nina: 0 });
    expect(await c.played(AFTER("2026-10-16"))).toMatchObject({ Reg: 2, Walt: 2, Nina: 0 });
  });

  it("a night called off before its register closed isn't played", async () => {
    const c = await club();
    await c.night("2026-10-09");
    const off = await c.dana.call(
      "POST",
      `/api/sessions/${c.sessionOn("2026-10-09")}/cancelled`,
      { cancelled: true },
      { now: NIGHT("2026-10-09") },
    );
    expect(off.status).toBe(200);
    await w.scheduled("7 * * * *", AFTER("2026-10-09"));
    expect(await c.played(AFTER("2026-10-09"))).toMatchObject({ Reg: 0, Walt: 0 });
    expect(c.stored()).toMatchObject({ Reg: 0, Walt: 0 });
  });
});
