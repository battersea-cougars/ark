// Someone adding a player to a training keeps to its places (ADR 0131): the register's Add player, before the night or
// on it, and an admin putting someone in. If there's room they're in; if it's full they wait, as if they'd signed up
// (a Quarterly Member taking the last place of someone paying as they go), and only the team maker's Let in puts them
// over the limit (ADR 0076). Only who's in is charged (ADR 0007). A night that's over is a record of who came, and
// the register still says so. Driven through the real Worker handlers, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Tess Teams", position: "F", rating: 60, email: "tess@example.com", roles: ["Session lead"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Paul Payg", position: "F", rating: 55, email: "paul@example.com" },
  { name: "Walt Walkin", position: "F", rating: 50, email: "walt@example.com" },
  { name: "Quinn Quarterly", position: "D", rating: 58, email: "quinn@example.com" },
  { name: "Kim Keeper", position: "G", rating: 57, email: "kim@example.com" },
];

// NOW is Tuesday 6 October 2026: last Friday was the 2nd, the next is the 9th
const LAST_FRIDAY = "2026-10-02";
const NEXT_FRIDAY = "2026-10-09";
const on = (day: string) => new Date(`${day}T20:00:00Z`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

async function as(email: string) {
  const b = await w.signedIn(email);
  const sees = async (now = NOW) => (await b.call("GET", "/api/bootstrap", undefined, { now })).body as Json;
  return { call: b.call, sees };
}

/** Friday Training at £8 a night with room for two, Quinn a Quarterly Member; Reg and Paul signed up for `day`. */
async function fullFriday(day = NEXT_FRIDAY) {
  const dana = await as("dana@example.com");
  const tess = await as("tess@example.com");
  const b = await dana.sees();
  const id = Object.fromEntries(b.members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
  const series = b.series[0];
  const put = await dana.call("PUT", `/api/series/${series.id}`, {
    ...series,
    capacity: 2,
    fees: [{ pence: 800, from: "2026-01-01" }],
  });
  expect(put.status).toBe(200);
  expect((await dana.call("POST", `/api/members/${id.Quinn}/quarterly`, { quarterly: true })).status).toBe(200);
  const friday = (await dana.sees()).sessions.find((s: Json) => s.heldOn === day);
  // Signed up the Monday before (a night that's over takes no answers, #128)
  const before = { now: new Date(Date.parse(`${day}T12:00:00Z`) - 4 * 86_400_000) };
  for (const email of ["reg@example.com", "paul@example.com"]) {
    const res = await (await as(email)).call("POST", `/api/sessions/${friday.id}/answer`, { answer: "in" }, before);
    expect(res.status).toBe(200);
  }
  /** The register's Add player (or a tick), on the night unless said */
  const register = async (memberId: number, here = true, now = on(NEXT_FRIDAY)) =>
    tess.call("POST", `/api/sessions/${friday.id}/register`, { memberId, here }, { now });
  /** An admin puts someone in from the session's page */
  const putIn = async (memberId: number) =>
    dana.call("POST", `/api/sessions/${friday.id}/players`, { memberId, in: true });
  const letIn = async (memberId: number) => tess.call("POST", `/api/sessions/${friday.id}/let-in`, { memberId });
  const seen = async () => (await dana.sees()).sessions.find((s: Json) => s.id === friday.id);
  /** Who's charged for the night, the morning after */
  const charged = async () =>
    ((await dana.sees(new Date(`${day}T23:30:00Z`))).charges as Json[])
      .filter((c) => c.refId === friday.id)
      .map((c) => c.memberId)
      .sort((a, b) => a - b);
  return { dana, id, friday, register, putIn, letIn, seen, charged };
}

describe("adding a player keeps to the places", () => {
  it("a keeper added to a Friday full of skaters is in: the places are the skaters'", async () => {
    const f = await fullFriday();
    expect((await f.putIn(f.id.Kim)).status).toBe(200);
    expect((await f.register(f.id.Walt)).status).toBe(200); // a skater: waits
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul, f.id.Kim], waitlist: [f.id.Walt] });
  });

  it("the register's walk-in keeper on a full night is in, and taking them off lets no skater in", async () => {
    const f = await fullFriday();
    expect((await f.register(f.id.Walt)).status).toBe(200); // waits
    expect((await f.register(f.id.Kim)).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul, f.id.Kim], waitlist: [f.id.Walt] });
    expect((await f.register(f.id.Kim, false)).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul], waitlist: [f.id.Walt] });
  });

  it("the register adds someone to a Friday with room: they're in, as a walk-in, and the reply says so", async () => {
    const f = await fullFriday();
    const dana = await as("dana@example.com");
    expect(
      (await dana.call("POST", `/api/sessions/${f.friday.id}/players`, { memberId: f.id.Reg, in: false })).status,
    ).toBe(200);
    const res = await f.register(f.id.Walt);
    expect(res.status).toBe(200);
    expect(res.body.signup).toBe("in");
    expect(await f.seen()).toMatchObject({ going: [f.id.Paul, f.id.Walt], waitlist: [], walkIns: [f.id.Walt] });
  });

  it("the register adds someone to a full Friday: they wait, and the reply says so", async () => {
    const f = await fullFriday();
    const res = await f.register(f.id.Walt);
    expect(res.status).toBe(200);
    expect(res.body.signup).toBe("waitlist");
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul], waitlist: [f.id.Walt] });
  });

  it("before the night too: adding to a full Friday days ahead puts them on the waiting list", async () => {
    const f = await fullFriday();
    expect((await f.register(f.id.Walt, true, NOW)).body.signup).toBe("waitlist");
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul], waitlist: [f.id.Walt] });
  });

  it("the team maker lets them in, over the limit, and only then are they charged", async () => {
    const f = await fullFriday();
    await f.register(f.id.Walt);
    expect(await f.charged()).toEqual([f.id.Reg, f.id.Paul].sort((a, b) => a - b));

    expect((await f.letIn(f.id.Walt)).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul, f.id.Walt], waitlist: [] });
    expect(await f.charged()).toEqual([f.id.Reg, f.id.Paul, f.id.Walt].sort((a, b) => a - b));
  });

  it("someone added to the waiting list by mistake comes off again with a second tap", async () => {
    const f = await fullFriday();
    await f.register(f.id.Walt);
    const res = await f.register(f.id.Walt, false);
    expect(res.status).toBe(200);
    expect(res.body.signup).toBeNull();
    const after = await f.seen();
    expect(after.waitlist).toEqual([]);
    expect(after.out).toEqual([]);
  });

  it("when a place comes free, someone the register put on the waiting list moves up like anyone waiting", async () => {
    const f = await fullFriday();
    await f.register(f.id.Walt);
    const paul = await as("paul@example.com");
    expect((await paul.call("POST", `/api/sessions/${f.friday.id}/answer`, { answer: "out" })).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Walt], waitlist: [] });
    expect(await f.charged()).toEqual([f.id.Reg, f.id.Walt].sort((a, b) => a - b));
  });

  it("someone already waiting who's ticked on the register keeps their place in the queue", async () => {
    const f = await fullFriday();
    const walt = await as("walt@example.com");
    expect((await walt.call("POST", `/api/sessions/${f.friday.id}/answer`, { answer: "in" })).status).toBe(200);
    const tess = await as("tess@example.com");
    expect((await tess.call("POST", `/api/sessions/${f.friday.id}/answer`, { answer: "in" })).status).toBe(200);
    expect((await f.register(f.id.Walt)).body.signup).toBe("waitlist");
    expect((await f.seen()).waitlist).toEqual([f.id.Walt, f.id.Tess]);
  });

  it("an admin putting someone in a full Friday puts them on the waiting list; with room, in", async () => {
    const f = await fullFriday();
    const res = await f.putIn(f.id.Walt);
    expect(res.status).toBe(200);
    expect(res.body.signup).toBe("waitlist");
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul], waitlist: [f.id.Walt] });

    const paul = await as("paul@example.com");
    await paul.call("POST", `/api/sessions/${f.friday.id}/answer`, { answer: "out" }); // Walt moves up
    await (await as("reg@example.com")).call("POST", `/api/sessions/${f.friday.id}/answer`, { answer: "out" });
    expect((await f.putIn(f.id.Kim)).body.signup).toBe("in");
    expect(await f.seen()).toMatchObject({ going: [f.id.Walt, f.id.Kim], waitlist: [] });
  });

  it("a Quarterly Member added to a full Friday takes the place of the last one in paying as they go", async () => {
    const f = await fullFriday();
    expect((await f.register(f.id.Quinn)).body.signup).toBe("in");
    expect(await f.seen()).toMatchObject({ going: [f.id.Quinn, f.id.Reg], waitlist: [f.id.Paul] });
    expect(await f.charged()).not.toContain(f.id.Paul);
  });

  it("a night that's over is a record: ticking someone who came to a full one still says they came", async () => {
    const f = await fullFriday(LAST_FRIDAY);
    expect((await f.register(f.id.Walt, true, NOW)).body.signup).toBe("in");
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul, f.id.Walt], walkIns: [f.id.Walt] });
    expect(await f.charged()).toContain(f.id.Walt);
  });
});
