// Friday's sign-ups at their edges (ADR 0030, ADR 0007): the first and the last place, a limit changed with people
// waiting, answers that make no sense, nights that are over or called off, and who may do what (ADR 0024). Driven
// through the real Worker handlers, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { seeds } from "@cougars/shared/testing/d1-sqlite";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Tess Teams", position: "F", rating: 60, email: "tess@example.com", roles: ["Session lead"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Paul Payg", position: "F", rating: 55, email: "paul@example.com" },
  { name: "Walt Waiting", position: "F", rating: 50, email: "walt@example.com" },
  { name: "Nina New", position: "D", rating: 52, email: "nina@example.com" },
  { name: "Quinn Quarterly", position: "D", rating: 58, email: "quinn@example.com" },
  { name: "Kim Keeper", position: "G", rating: 57, email: "kim@example.com" },
];

// NOW is Tuesday 6 October 2026: last Friday was the 2nd, the next is the 9th
const LAST_FRIDAY = "2026-10-02";
const NEXT_FRIDAY = "2026-10-09";
/** The Saturday morning after a Friday */
const MORNING_AFTER = (friday: string) => new Date(Date.parse(`${friday}T08:00:00Z`) + 86_400_000);

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

/** Friday Training at £8 a night with room for `capacity` skaters (and `keepers` keepers), as Dana sets it. */
async function friday({ capacity = 2, keepers = null as number | null, day = NEXT_FRIDAY } = {}) {
  const dana = await as("dana@example.com");
  const b = await dana.sees();
  const id = Object.fromEntries(b.members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
  const series = b.series[0];
  const setLimits = async (skaters: number | null, goalies: number | null = keepers) =>
    dana.call("PUT", `/api/series/${series.id}`, {
      ...series,
      capacity: skaters,
      goalieCapacity: goalies,
      fees: [{ pence: 800, from: "2026-01-01" }],
    });
  expect((await setLimits(capacity)).status).toBe(200);
  const night = (await dana.sees()).sessions.find((s: Json) => s.heldOn === day);
  const people = new Map<string, Awaited<ReturnType<typeof as>>>();
  const person = async (first: string) => {
    if (!people.has(first)) people.set(first, await as(`${first.toLowerCase()}@example.com`));
    return people.get(first)!;
  };
  const say = async (first: string, answer: unknown, now = NOW) =>
    (await person(first)).call("POST", `/api/sessions/${night.id}/answer`, { answer }, { now });
  const seen = async (now = NOW) => (await dana.sees(now)).sessions.find((s: Json) => s.id === night.id);
  /** Who's charged for the night, the morning after it, once the hourly run has charged what's due */
  const charged = async () => {
    await w.scheduled("7 * * * *", MORNING_AFTER(day));
    return ((await dana.sees(MORNING_AFTER(day))).charges as Json[])
      .filter((c) => c.refId === night.id)
      .map((c) => c.memberId)
      .sort((a, b) => a - b);
  };
  return { dana, id, series, night, setLimits, say, seen, charged, person };
}

describe("the first and the last place", () => {
  it("room for one: the first to say in is in, the second waits, and the first going out lets them in", async () => {
    const f = await friday({ capacity: 1 });
    expect((await f.say("Reg", "in")).status).toBe(200);
    expect((await f.say("Paul", "in")).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg], waitlist: [f.id.Paul] });
    expect((await f.say("Reg", "out")).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Paul], waitlist: [], out: [f.id.Reg] });
  });

  it("the limit's last place is a place: two places, two in, and only the third waits", async () => {
    const f = await friday({ capacity: 2 });
    for (const p of ["Reg", "Paul", "Walt"]) expect((await f.say(p, "in")).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul], waitlist: [f.id.Walt] });
  });

  it("a training can't be set to no places at all: a limit of 0 is refused, and the old one stays", async () => {
    const f = await friday({ capacity: 2 });
    expect((await f.setLimits(0)).status).toBe(400);
    expect((await f.dana.sees()).series[0].capacity).toBe(2);
  });

  it("no places for keepers (0): a keeper who says in waits, and no skater's place goes to them", async () => {
    const f = await friday({ capacity: 2, keepers: 0 });
    expect((await f.say("Kim", "in")).status).toBe(200);
    expect((await f.say("Reg", "in")).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg], waitlist: [f.id.Kim] });
  });

  it("no limit at all: everyone who says in is in", async () => {
    const f = await friday({ capacity: null as unknown as number });
    for (const p of ["Reg", "Paul", "Walt", "Nina"]) await f.say(p, "in");
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul, f.id.Walt, f.id.Nina], waitlist: [] });
  });

  it("someone waiting who says out leaves the queue, and nobody else moves", async () => {
    const f = await friday({ capacity: 1 });
    for (const p of ["Reg", "Paul", "Walt"]) await f.say(p, "in");
    expect((await f.say("Paul", "out")).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg], waitlist: [f.id.Walt], out: [f.id.Paul] });
  });

  it("someone who says out, then in again, goes to the back of the queue", async () => {
    const f = await friday({ capacity: 1 });
    for (const p of ["Reg", "Paul"]) await f.say(p, "in");
    await f.say("Reg", "out"); // Paul's in
    expect((await f.say("Reg", "in")).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Paul], waitlist: [f.id.Reg] });
  });

  it("out twice: the second tap changes nothing, and nobody else moves up for it", async () => {
    const f = await friday({ capacity: 1 });
    for (const p of ["Reg", "Paul", "Walt"]) await f.say(p, "in");
    await f.say("Reg", "out"); // Paul's in, Walt waits
    expect((await f.say("Reg", "out")).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Paul], waitlist: [f.id.Walt] });
  });

  it("saying out without ever saying in puts them under Out and frees no place", async () => {
    const f = await friday({ capacity: 1 });
    for (const p of ["Reg", "Paul"]) await f.say(p, "in");
    expect((await f.say("Walt", "out")).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg], waitlist: [f.id.Paul], out: [f.id.Walt] });
  });
});

describe("a limit changed while people wait", () => {
  // Raising the limit moved nobody up: the waiting stayed waiting, and the next to say in took the new place ahead of
  // them (#127). A limit raised is a place coming free (ADR 0030)
  it(
    "an admin makes room for one more: the first waiting is in, not the next to sign up (#127)",
    async () => {
      const f = await friday({ capacity: 2 });
      for (const p of ["Reg", "Paul", "Walt"]) await f.say(p, "in");
      expect((await f.setLimits(3)).status).toBe(200);
      await f.say("Nina", "in");
      expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul, f.id.Walt], waitlist: [f.id.Nina] });
    },
  );

  it("an admin lowers the limit below who's in: nobody's taken off, and nobody moves up until it's under again", async () => {
    const f = await friday({ capacity: 3 });
    for (const p of ["Reg", "Paul", "Walt", "Nina"]) await f.say(p, "in");
    expect((await f.setLimits(1)).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg, f.id.Paul, f.id.Walt], waitlist: [f.id.Nina] });
    await f.say("Reg", "out");
    expect(await f.seen()).toMatchObject({ going: [f.id.Paul, f.id.Walt], waitlist: [f.id.Nina] });
  });
});

describe("answers that make no sense", () => {
  it("anything but in or out is refused, and nothing's written", async () => {
    const f = await friday();
    for (const answer of [undefined, "", "IN", "maybe", "waitlist", true, 1, null, ["in"], { answer: "in" }]) {
      const res = await f.say("Reg", answer);
      expect(res.status, JSON.stringify(answer)).toBe(400);
    }
    expect((await f.say("Reg", "in".repeat(10_000))).status).toBe(400);
    expect(w.db.raw.prepare("SELECT COUNT(*) n FROM attendance WHERE session_id = ?").get(f.night.id)).toEqual({
      n: 0,
    });
  });

  it("a body that isn't JSON is refused, not a server error", async () => {
    const f = await friday();
    const reg = await w.signedIn("reg@example.com");
    const res = await reg.open("POST", `/api/sessions/${f.night.id}/answer`, {}, undefined);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("a session that doesn't exist is a 404, and so is one whose id isn't a number", async () => {
    await friday();
    const reg = await as("reg@example.com");
    expect((await reg.call("POST", "/api/sessions/999999/answer", { answer: "in" })).status).toBe(404);
    expect((await reg.call("POST", "/api/sessions/abc/answer", { answer: "in" })).status).toBe(404);
    expect(w.db.raw.prepare("SELECT COUNT(*) n FROM attendance").get()).toEqual({ n: 0 });
  });

  it("a club event that doesn't exist, or a tournament that doesn't, is a 404 too", async () => {
    const reg = await as("reg@example.com");
    expect((await reg.call("POST", "/api/club-events/424242/answer", { answer: "in" })).status).toBe(404);
    expect((await reg.call("POST", "/api/tournaments/424242/answer", { answer: "in" })).status).toBe(404);
  });

  it("the Add player drawer's batch with one bad change saves none of them", async () => {
    const f = await friday({ capacity: 5 });
    const res = await f.dana.call("POST", `/api/sessions/${f.night.id}/players`, {
      players: [
        { memberId: f.id.Reg, in: true },
        { memberId: f.id.Paul, in: "yes" },
      ],
    });
    expect(res.status).toBe(400);
    expect((await f.seen()).going).toEqual([]);
  });

  it("an admin putting in a member id that can't be one is refused", async () => {
    const f = await friday({ capacity: 5 });
    for (const memberId of [0, -1, 1.5, "x"]) {
      const res = await f.dana.call("POST", `/api/sessions/${f.night.id}/players`, { memberId, in: true });
      expect(res.status, String(memberId)).toBe(400);
    }
    expect((await f.seen()).going).toEqual([]);
  });

  // The id goes straight into the insert, whose foreign key refuses it as a server error (known bug #130)
  it.fails(
    "an admin putting in a member who doesn't exist is told so, not a server error (known bug #130)",
    async () => {
      const f = await friday({ capacity: 5 });
      const res = await f.dana.call("POST", `/api/sessions/${f.night.id}/players`, { memberId: 987654, in: true });
      expect(res.status).toBe(404);
    },
  );

  it("an admin taking off someone who never signed up: nothing changes, and the reply says they're not on it", async () => {
    const f = await friday({ capacity: 1 });
    for (const p of ["Reg", "Paul"]) await f.say(p, "in");
    const res = await f.dana.call("POST", `/api/sessions/${f.night.id}/players`, { memberId: f.id.Walt, in: false });
    expect(res.status).toBe(200);
    expect(res.body.signup).toBeNull();
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg], waitlist: [f.id.Paul] });
  });

  it("an admin putting in someone already waiting leaves them waiting, in their place", async () => {
    const f = await friday({ capacity: 1 });
    for (const p of ["Reg", "Paul", "Walt"]) await f.say(p, "in");
    const res = await f.dana.call("POST", `/api/sessions/${f.night.id}/players`, { memberId: f.id.Walt, in: true });
    expect(res.body.signup).toBe("waitlist");
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg], waitlist: [f.id.Paul, f.id.Walt] });
  });
});

describe("a night that's called off", () => {
  it("nobody can say in or out of a cancelled Friday, nor be added to it, nor be let in", async () => {
    const f = await friday({ capacity: 1 });
    for (const p of ["Reg", "Paul"]) await f.say(p, "in");
    expect((await f.dana.call("POST", `/api/sessions/${f.night.id}/cancelled`, { cancelled: true })).status).toBe(200);
    expect((await f.say("Walt", "in")).status).toBe(409);
    expect((await f.say("Reg", "out")).status).toBe(409);
    const tess = await as("tess@example.com");
    expect(
      (await tess.call("POST", `/api/sessions/${f.night.id}/register`, { memberId: f.id.Walt, here: true })).status,
    ).toBe(409);
    expect((await tess.call("POST", `/api/sessions/${f.night.id}/let-in`, { memberId: f.id.Paul })).status).toBe(409);
    expect(
      (await f.dana.call("POST", `/api/sessions/${f.night.id}/players`, { memberId: f.id.Walt, in: true })).status,
    ).toBe(409);
    expect(await f.seen()).toMatchObject({ going: [f.id.Reg], waitlist: [f.id.Paul] });
  });

  it("a cancelled night charges nobody; put back on, those who were in are charged again", async () => {
    const f = await friday({ capacity: 5 });
    for (const p of ["Reg", "Paul"]) await f.say(p, "in");
    expect(await f.charged()).toEqual([f.id.Reg, f.id.Paul].sort((a, b) => a - b));
    // The rink called it off, put on the record the morning after
    const after = { now: MORNING_AFTER(NEXT_FRIDAY) };
    await f.dana.call("POST", `/api/sessions/${f.night.id}/cancelled`, { cancelled: true }, after);
    expect(await f.charged()).toEqual([]);
    await f.dana.call("POST", `/api/sessions/${f.night.id}/cancelled`, { cancelled: false }, after);
    expect(await f.charged()).toEqual([f.id.Reg, f.id.Paul].sort((a, b) => a - b));
  });

  it("cancelling a session that doesn't exist is a 404; cancelled must say true or false", async () => {
    const f = await friday();
    expect((await f.dana.call("POST", "/api/sessions/999999/cancelled", { cancelled: true })).status).toBe(404);
    expect((await f.dana.call("POST", `/api/sessions/${f.night.id}/cancelled`, { cancelled: "yes" })).status).toBe(400);
  });
});

describe("a night that's over", () => {
  // The register is the record of who came, and its charge stands (ADR 0007): after the night, a member's own Out
  // takes them off it and their unpaid charge goes (known bug #128)
  it.fails(
    "a member who came can't say they're out of last Friday afterwards: they're still in, and still charged (known bug #128)",
    async () => {
      const f = await friday({ capacity: 5, day: LAST_FRIDAY });
      // Signed up before the night (the Monday before), and came
      const monday = new Date("2026-09-28T12:00:00Z");
      expect((await f.say("Reg", "in", monday)).status).toBe(200);
      expect(await f.charged()).toEqual([f.id.Reg]);
      const res = await f.say("Reg", "out");
      expect(res.status).toBe(409);
      expect(await f.charged()).toEqual([f.id.Reg]);
    },
  );

  it.fails(
    "a member can't sign themselves up for last Friday after it: the register says who came (known bug #128)",
    async () => {
      const f = await friday({ capacity: 5, day: LAST_FRIDAY });
      expect((await f.say("Reg", "in")).status).toBe(409);
      expect((await f.seen()).going).toEqual([]);
    },
  );
});

describe("who may do what (ADR 0024)", () => {
  it("someone not signed in can't answer, add, register, let in, reset or cancel", async () => {
    const f = await friday();
    const stranger = w.browser();
    const tries: [string, unknown][] = [
      [`/api/sessions/${f.night.id}/answer`, { answer: "in" }],
      [`/api/sessions/${f.night.id}/players`, { memberId: f.id.Reg, in: true }],
      [`/api/sessions/${f.night.id}/register`, { memberId: f.id.Reg, here: true }],
      [`/api/sessions/${f.night.id}/let-in`, { memberId: f.id.Reg }],
      [`/api/sessions/${f.night.id}/reset`, {}],
      [`/api/sessions/${f.night.id}/cancelled`, { cancelled: true }],
    ];
    for (const [path, payload] of tries) expect((await stranger.call("POST", path, payload)).status, path).toBe(401);
    expect(w.db.raw.prepare("SELECT COUNT(*) n FROM attendance").get()).toEqual({ n: 0 });
  });

  it("a member can only answer for themselves: a memberId in their answer is ignored", async () => {
    const f = await friday();
    const reg = await f.person("Reg");
    const res = await reg.call("POST", `/api/sessions/${f.night.id}/answer`, { answer: "in", memberId: f.id.Paul });
    expect(res.status).toBe(200);
    expect((await f.seen()).going).toEqual([f.id.Reg]);
  });

  it("a member can't put someone else in or take them off, mark the register, let in, reset or cancel", async () => {
    const f = await friday({ capacity: 1 });
    for (const p of ["Paul", "Walt"]) await f.say(p, "in");
    const reg = await f.person("Reg");
    const tries: [string, unknown][] = [
      [`/api/sessions/${f.night.id}/players`, { memberId: f.id.Paul, in: false }],
      [`/api/sessions/${f.night.id}/register`, { memberId: f.id.Paul, here: false }],
      [`/api/sessions/${f.night.id}/let-in`, { memberId: f.id.Walt }],
      [`/api/sessions/${f.night.id}/reset`, {}],
      [`/api/sessions/${f.night.id}/cancelled`, { cancelled: true }],
    ];
    for (const [path, payload] of tries) expect((await reg.call("POST", path, payload)).status, path).toBe(403);
    expect(await f.seen()).toMatchObject({ going: [f.id.Paul], waitlist: [f.id.Walt], cancelledAt: null });
  });

  it("a session lead runs the register and lets people in, but can't take someone off or reset the night", async () => {
    const f = await friday({ capacity: 1 });
    for (const p of ["Paul", "Walt"]) await f.say(p, "in");
    const tess = await as("tess@example.com");
    expect(
      (await tess.call("POST", `/api/sessions/${f.night.id}/players`, { memberId: f.id.Paul, in: false })).status,
    ).toBe(403);
    expect((await tess.call("POST", `/api/sessions/${f.night.id}/reset`, {})).status).toBe(403);
    expect((await tess.call("POST", `/api/sessions/${f.night.id}/let-in`, { memberId: f.id.Walt })).status).toBe(200);
    expect(await f.seen()).toMatchObject({ going: [f.id.Paul, f.id.Walt], waitlist: [] });
  });
});

describe("Quarterly Members and walk-ins", () => {
  it("a Quarterly Member never takes a walk-in's place: the last one in paying as they go waits instead", async () => {
    const f = await friday({ capacity: 2 });
    expect((await f.dana.call("POST", `/api/members/${f.id.Quinn}/quarterly`, { quarterly: true })).status).toBe(200);
    await f.say("Reg", "in");
    // Walt walks in on the night (room for him): the last place
    const tess = await as("tess@example.com");
    const onTheNight = new Date(`${NEXT_FRIDAY}T18:45:00Z`);
    const walkIn = await tess.call(
      "POST",
      `/api/sessions/${f.night.id}/register`,
      { memberId: f.id.Walt, here: true },
      { now: onTheNight },
    );
    expect(walkIn.body.signup).toBe("in");
    await f.say("Quinn", "in", onTheNight);
    expect(await f.seen(onTheNight)).toMatchObject({ going: [f.id.Quinn, f.id.Walt], waitlist: [f.id.Reg] });
  });

  it("a Quarterly Member on a night full of Quarterly Members waits; the next PAYG to sign up waits behind them", async () => {
    const f = await friday({ capacity: 1 });
    await f.dana.call("POST", `/api/members/${f.id.Quinn}/quarterly`, { quarterly: true });
    await f.dana.call("POST", `/api/members/${f.id.Nina}/quarterly`, { quarterly: true });
    await f.say("Quinn", "in");
    await f.say("Reg", "in");
    await f.say("Nina", "in");
    expect(await f.seen()).toMatchObject({ going: [f.id.Quinn], waitlist: [f.id.Nina, f.id.Reg] });
  });
});

describe("at once (ADR 0121)", () => {
  it.each(seeds(5))(
    "a Quarterly Member signs up for a full night just as someone paying as they go says out: still two in, nobody twice (seed %i)",
    async (seed) => {
      const f = await friday({ capacity: 2 });
      await f.dana.call("POST", `/api/members/${f.id.Quinn}/quarterly`, { quarterly: true });
      for (const p of ["Reg", "Paul", "Walt"]) await f.say(p, "in");
      // Signed in before the taps, so only the taps interleave
      await f.person("Quinn");
      w.db.interleave(seed);
      const replies = await Promise.all([f.say("Quinn", "in"), f.say("Reg", "out")]);
      w.db.interleave(null);
      expect(replies.map((r) => r.status)).toEqual([200, 200]);
      const night = await f.seen();
      expect(night.going).toHaveLength(2);
      expect(night.going).toContain(f.id.Quinn);
      expect(night.going).not.toContain(f.id.Reg);
      expect(new Set([...night.going, ...night.waitlist]).size).toBe(night.going.length + night.waitlist.length);
      expect([...night.going, ...night.waitlist].sort()).toEqual([f.id.Quinn, f.id.Paul, f.id.Walt].sort());
    },
  );

  it.each(seeds(5))(
    "an admin takes someone off just as two others sign up for the place: one gets it, the first waiting (seed %i)",
    async (seed) => {
      const f = await friday({ capacity: 2 });
      for (const p of ["Reg", "Paul", "Walt"]) await f.say(p, "in");
      await f.person("Nina");
      await f.person("Quinn");
      w.db.interleave(seed);
      await Promise.all([
        f.dana.call("POST", `/api/sessions/${f.night.id}/players`, { memberId: f.id.Reg, in: false }),
        f.say("Nina", "in"),
        f.say("Quinn", "in"),
      ]);
      w.db.interleave(null);
      const night = await f.seen();
      expect(night.going).toHaveLength(2);
      expect(night.going).toEqual([f.id.Paul, f.id.Walt]);
      expect(night.waitlist.sort()).toEqual([f.id.Nina, f.id.Quinn].sort());
    },
  );
});
