// Taking back your Out (ADR 0131): a member who said Out taps it again and they've not answered, as if they never
// had. Before a night's sign-up opens that's the one thing they can do there, and it puts them back among those told
// when it opens (ADR 0108). It goes by the rules of answering: not once a tournament's started (tournaments/started.ts),
// not once a night's over. It only ever takes back their own Out (one guarded statement, ADR 0121): an In is taken
// back by saying Out, as ever. Driven through the real handlers and the cron in the fake world (ADR 0031).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Paul Payg", position: "F", rating: 55, email: "paul@example.com" },
];

// NOW is Tuesday 6 October 2026; Friday the 16th's sign-up opens on Monday the 12th
const FRIDAY_AFTER = "2026-10-16";
/** Monday 12 October, five past midnight in London */
const MONDAY_MIDNIGHT = new Date("2026-10-11T23:05:00Z");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(() => vi.restoreAllMocks());

/** A phone with the app, signed in as this member. */
async function phone(email: string) {
  const b = await w.signedIn(email);
  expect((await b.call("PUT", "/api/auth/device", { token: `token-${email}`, platform: "ios" })).status).toBe(200);
}

/** Friday Training, its nights opening on the Monday before, as Dana saves it. */
async function friday() {
  const dana = await w.signedIn("dana@example.com");
  const b = (await dana.club()).body as Json;
  const id = Object.fromEntries(b.members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
  const series = b.series[0];
  expect((await dana.call("PUT", `/api/series/${series.id}`, { ...series, signupOpensDays: 4 })).status).toBe(200);
  const night = (day: string) => b.sessions.find((s: Json) => s.heldOn === day).id as number;
  const say = async (email: string, day: string, answer: "in" | "out" | "clear", now = NOW) =>
    (await w.signedIn(email)).call("POST", `/api/sessions/${night(day)}/answer`, { answer }, { now });
  /** Someone's answer for a night, as stored: null, none. */
  const entry = (name: string, day: string) =>
    (
      w.db.raw
        .prepare("SELECT signup FROM attendance WHERE session_id = ? AND member_id = ?")
        .get(night(day), id[name]) as { signup: string } | undefined
    )?.signup ?? null;
  return { dana, id, night, say, entry };
}

describe("taking back your Out for a night whose sign-up isn't open yet", () => {
  it("Reg says Out, then takes it back: he's not answered, and he hears Monday's sign-up's open", async () => {
    await phone("reg@example.com");
    const f = await friday();
    expect((await f.say("reg@example.com", FRIDAY_AFTER, "out")).status).toBe(200);
    expect(f.entry("Reg", FRIDAY_AFTER)).toBe("out");

    expect((await f.say("reg@example.com", FRIDAY_AFTER, "clear")).status).toBe(200);
    expect(f.entry("Reg", FRIDAY_AFTER)).toBeNull();

    await w.scheduled("*/5 * * * *", MONDAY_MIDNIGHT);
    expect(w.pushes.filter((p) => p.body.includes("16 October")).map((p) => p.memberId)).toEqual([f.id.Reg]);
  });

  it("takes back only his own Out: Paul's stays", async () => {
    const f = await friday();
    expect((await f.say("paul@example.com", FRIDAY_AFTER, "out")).status).toBe(200);
    expect((await f.say("reg@example.com", FRIDAY_AFTER, "out")).status).toBe(200);
    expect((await f.say("reg@example.com", FRIDAY_AFTER, "clear")).status).toBe(200);
    expect(f.entry("Paul", FRIDAY_AFTER)).toBe("out");
    expect(f.entry("Reg", FRIDAY_AFTER)).toBeNull();
  });

  it("never takes back an In: one an admin put in stays in (saying Out is how you leave)", async () => {
    const f = await friday();
    const put = await f.dana.call("POST", `/api/sessions/${f.night(FRIDAY_AFTER)}/players`, {
      memberId: f.id.Paul,
      in: true,
    });
    expect(put.status).toBe(200);
    expect((await f.say("paul@example.com", FRIDAY_AFTER, "clear")).status).toBe(200);
    expect(f.entry("Paul", FRIDAY_AFTER)).toBe("in");
  });

  it("a double tap, or two phones at once, takes it back once and both are fine", async () => {
    const f = await friday();
    expect((await f.say("reg@example.com", FRIDAY_AFTER, "out")).status).toBe(200);
    const both = await Promise.all([
      f.say("reg@example.com", FRIDAY_AFTER, "clear"),
      f.say("reg@example.com", FRIDAY_AFTER, "clear"),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(f.entry("Reg", FRIDAY_AFTER)).toBeNull();
    // And once more, with nothing to take back
    expect((await f.say("reg@example.com", FRIDAY_AFTER, "clear")).status).toBe(200);
  });

  it("a night that's over is the register's: taking back an Out is refused", async () => {
    const f = await friday();
    expect((await f.say("reg@example.com", FRIDAY_AFTER, "out")).status).toBe(200);
    const after = new Date("2026-10-17T10:00:00Z");
    const res = await f.say("reg@example.com", FRIDAY_AFTER, "clear", after);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("That night's over: the register says who came.");
    expect(f.entry("Reg", FRIDAY_AFTER)).toBe("out");
  });

  it('only "clear" takes it back: anything else is refused, and his Out stays', async () => {
    const f = await friday();
    expect((await f.say("reg@example.com", FRIDAY_AFTER, "out")).status).toBe(200);
    const reg = await w.signedIn("reg@example.com");
    for (const answer of [null, "CLEAR", "none", ""]) {
      const res = await reg.call("POST", `/api/sessions/${f.night(FRIDAY_AFTER)}/answer`, { answer });
      expect(res.status, JSON.stringify(answer)).toBe(400);
    }
    expect(f.entry("Reg", FRIDAY_AFTER)).toBe("out");
  });
});

describe("taking back your Out for a tournament", () => {
  /** The Autumn Cup on Saturday 10 October, sign-up open. */
  async function cup() {
    const dana = await w.signedIn("dana@example.com");
    const made = await dana.call("POST", "/api/tournaments", {
      name: "Autumn Cup",
      heldOn: "2026-10-10",
      startTime: "11:00",
      endTime: "17:00",
      status: "open",
      feePence: 0,
    });
    expect(made.status).toBe(201);
    const id = made.body.id as number;
    const b = (await dana.club()).body as Json;
    const regId = b.members.find((m: Json) => m.name === "Reg Player").id as number;
    const say = async (answer: "in" | "out" | "clear") =>
      (await w.signedIn("reg@example.com")).call("POST", `/api/tournaments/${id}/answer`, { answer });
    const entry = () =>
      (
        w.db.raw
          .prepare("SELECT signup FROM tournament_entries WHERE tournament_id = ? AND member_id = ?")
          .get(id, regId) as { signup: string } | undefined
      )?.signup ?? null;
    const t = async () => ((await dana.club()).body as Json).tournaments.find((x: Json) => x.id === id);
    return { dana, id, say, entry, t };
  }

  it("while it's to come, Reg's Out comes back to not answered", async () => {
    const c = await cup();
    expect((await c.say("out")).status).toBe(200);
    expect((await c.say("clear")).status).toBe(200);
    expect(c.entry()).toBeNull();
  });

  it("once it's started, it's refused, and his Out stays", async () => {
    const c = await cup();
    expect((await c.say("out")).status).toBe(200);
    expect((await c.dana.call("PUT", `/api/tournaments/${c.id}`, { ...(await c.t()), status: "live" })).status).toBe(
      200,
    );
    const res = await c.say("clear");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("It's started: ask an admin to change it.");
    expect(c.entry()).toBe("out");
  });
});
