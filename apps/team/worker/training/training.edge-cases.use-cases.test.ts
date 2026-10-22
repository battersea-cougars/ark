// A training's schedule and its nights at their edges (ADR 0030, ADR 0076): what an admin may set, a rule changed
// with people signed up, the night's teams, and the register either side of London midnight, in summer time and after
// the clocks go back (25 October 2026). Driven through the real Worker handlers, each person signed in as themselves
// (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Tess Teams", position: "F", rating: 60, email: "tess@example.com", roles: ["Session lead"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Paul Payg", position: "F", rating: 55, email: "paul@example.com" },
  { name: "Walt Walkin", position: "F", rating: 50, email: "walt@example.com" },
];

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

/** The Monday before a Friday, at noon: Friday Training's sign-up for it is open (ADR 0030) */
const opens = (friday: string) => ({ now: new Date(Date.parse(`${friday}T12:00:00Z`) - 4 * 86_400_000) });

const SUNDAYS = {
  name: "Sunday Skills",
  shortName: "Sunday",
  icon: "skate",
  tone: "green",
  repeatEvery: 1,
  weekdays: ["sun"],
  startsOn: "2026-10-11",
  endsOn: null,
  startTime: "10:00",
  endTime: "11:30",
  venue: "The park",
  capacity: 16,
  goalieCapacity: null,
  public: false,
  active: true,
};

async function admin() {
  const dana = await as("dana@example.com");
  const b = await dana.sees();
  const id = Object.fromEntries(b.members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
  return { ...dana, id, friday: b.series[0] as Json };
}

describe("what an admin may set for a training", () => {
  it.each([
    ["no name", { name: "" }],
    ["a name past 60 letters", { name: "x".repeat(61) }],
    ["no short name", { shortName: "" }],
    ["a short name past 12 letters", { shortName: "x".repeat(13) }],
    ["a weekday that isn't one", { weekdays: ["fri", "funday"] }],
    ["weekdays that aren't a list", { weekdays: "sun" }],
    ["every 0 weeks", { repeatEvery: 0 }],
    ["every 9 weeks", { repeatEvery: 9 }],
    ["every half a week", { repeatEvery: 0.5 }],
    ["a last session before the first", { endsOn: "2026-10-10" }],
    ["a first session that isn't a date", { startsOn: "11/10/2026" }],
    ["a time that isn't HH:MM", { startTime: "10am" }],
    ["room for nobody", { capacity: 0 }],
    ["room for 501", { capacity: 501 }],
    ["minus one keepers' places", { goalieCapacity: -1 }],
    ["an icon that isn't one", { icon: "rocket" }],
    ["public as a word", { public: "yes" }],
  ])("refuses a training with %s, saying why, and makes no sessions", async (_, change) => {
    const dana = await admin();
    const res = await dana.call("POST", "/api/series", { ...SUNDAYS, ...change });
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
    expect((await dana.sees()).series).toHaveLength(1);
  });

  // An impossible date passed the YYYY-MM-DD check; making its sessions then threw, the training was already saved,
  // and every member's app failed to open from then on, since opening it makes each training's sessions (#129)
  it("a first session in month 13 is refused, and the app still opens for everyone (#129)", async () => {
    const dana = await admin();
    expect((await dana.call("POST", "/api/series", { ...SUNDAYS, startsOn: "2026-13-01" })).status).toBe(400);
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("GET", "/api/bootstrap")).status).toBe(200);
  });

  it("a training already saved with an impossible first session is skipped, and the app still opens for everyone (#129)", async () => {
    const dana = await admin();
    expect((await dana.call("POST", "/api/series", SUNDAYS)).status).toBe(201);
    // As from before dates were checked, or a row changed by hand
    w.db.raw.prepare("UPDATE training_series SET starts_on = '2026-13-01' WHERE slug = 'sunday'").run();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("GET", "/api/bootstrap", undefined, { now: new Date("2027-02-01T12:00:00Z") })).status).toBe(
      200,
    );
  });

  it("30 February, 25:99 and a training that ends before it starts are refused (#129)", async () => {
    const dana = await admin();
    for (const change of [
      { startsOn: "2026-02-30" },
      { startTime: "25:99" },
      { startTime: "21:00", endTime: "19:00" },
      { name: "   " },
    ])
      expect((await dana.call("POST", "/api/series", { ...SUNDAYS, ...change })).status, JSON.stringify(change)).toBe(
        400,
      );
  });

  it("a training of one session (first and last the same day) has just that session", async () => {
    const dana = await admin();
    const res = await dana.call("POST", "/api/series", { ...SUNDAYS, endsOn: SUNDAYS.startsOn });
    expect(res.status).toBe(201);
    const made = (await dana.sees()).sessions.filter((s: Json) => s.seriesId === res.body.id);
    expect(made.map((s: Json) => s.heldOn)).toEqual(["2026-10-11"]);
  });

  it("a training that ended last month makes no sessions", async () => {
    const dana = await admin();
    const res = await dana.call("POST", "/api/series", { ...SUNDAYS, startsOn: "2026-08-02", endsOn: "2026-09-27" });
    expect(res.status).toBe(201);
    expect((await dana.sees()).sessions.filter((s: Json) => s.seriesId === res.body.id)).toEqual([]);
  });

  it("an inactive training makes no sessions", async () => {
    const dana = await admin();
    const res = await dana.call("POST", "/api/series", { ...SUNDAYS, active: false });
    expect(res.status).toBe(201);
    expect((await dana.sees()).sessions.filter((s: Json) => s.seriesId === res.body.id)).toEqual([]);
  });

  it("two trainings with the same short name get different addresses; one named in emoji still gets one", async () => {
    const dana = await admin();
    const one = await dana.call("POST", "/api/series", SUNDAYS);
    const two = await dana.call("POST", "/api/series", { ...SUNDAYS, name: "Sunday Skills 2" });
    const emoji = await dana.call("POST", "/api/series", { ...SUNDAYS, name: "🏒 Hockey", shortName: "🏒🥅" });
    expect([one.status, two.status, emoji.status]).toEqual([201, 201, 201]);
    expect(one.body.slug).toBe("sunday");
    expect(two.body.slug).toBe("sunday-2");
    expect(emoji.body.slug).toMatch(/^[a-z0-9-]+$/);
    expect((await dana.sees()).series.find((s: Json) => s.id === emoji.body.id).name).toBe("🏒 Hockey");
  });

  it("a member can't add or change a training, or look further ahead", async () => {
    const dana = await admin();
    const reg = await as("reg@example.com");
    expect((await reg.call("POST", "/api/series", SUNDAYS)).status).toBe(403);
    expect((await reg.call("PUT", `/api/series/${dana.friday.id}`, { ...dana.friday, capacity: 1 })).status).toBe(403);
    expect((await reg.call("POST", `/api/series/${dana.friday.id}/more`, {})).status).toBe(403);
    expect((await dana.sees()).series[0].capacity).toBe(dana.friday.capacity);
  });

  it("changing a training that doesn't exist, without its fees, or looking further ahead in one, is a 404", async () => {
    const dana = await admin();
    const { fees: _, ...noFees } = dana.friday;
    expect((await dana.call("PUT", "/api/series/999", noFees)).status).toBe(404);
    expect((await dana.call("POST", "/api/series/999/more", {})).status).toBe(404);
  });

  // The fees were saved before the training was looked up, so a missing one failed on its foreign key (#130)
  it("saving fees for a training that doesn't exist is a 404, not a server error (#130)", async () => {
    const dana = await admin();
    expect((await dana.call("PUT", "/api/series/999", { ...dana.friday })).status).toBe(404);
  });

  // The fees were written before the rest of the training was checked (and a new training before its fees were), so
  // a refused save had already changed what members are charged (#131)
  it("a save refused for a bad field changes nothing: not the training, and not its fee (#131)", async () => {
    const dana = await admin();
    const fees = dana.friday.fees;
    const res = await dana.call("PUT", `/api/series/${dana.friday.id}`, {
      ...dana.friday,
      weekdays: [],
      fees: [{ pence: 1, from: "2026-01-01" }],
    });
    expect(res.status).toBe(400);
    expect((await dana.sees()).series[0].fees).toEqual(fees);
  });

  it("a new training refused for its fees isn't made at all (#131)", async () => {
    const dana = await admin();
    const res = await dana.call("POST", "/api/series", { ...SUNDAYS, fees: [{ pence: -5, from: "2026-01-01" }] });
    expect(res.status).toBe(400);
    expect((await dana.sees()).series).toHaveLength(1);
  });
});

describe("a rule changed with people signed up", () => {
  it("an admin stops a training: the nights nobody answered go, the one Reg said in for stays, with him in it", async () => {
    const dana = await admin();
    const fridays = (await dana.sees()).sessions.filter((s: Json) => s.heldOn >= "2026-10-06");
    const answered = fridays[2];
    const reg = await as("reg@example.com");
    // On its Monday, once its sign-up's open (ADR 0030)
    expect(
      (await reg.call("POST", `/api/sessions/${answered.id}/answer`, { answer: "in" }, opens(answered.heldOn))).status,
    ).toBe(200);
    expect((await dana.call("PUT", `/api/series/${dana.friday.id}`, { ...dana.friday, active: false })).status).toBe(
      200,
    );
    const left = (await dana.sees()).sessions.filter((s: Json) => s.heldOn >= "2026-10-06");
    expect(left.map((s: Json) => s.id)).toEqual([answered.id]);
    expect(left[0].going).toEqual([dana.id.Reg]);
  });

  it("an admin moves the last session earlier: the Fridays after it go, unless someone said out of one", async () => {
    const dana = await admin();
    const fridays = (await dana.sees()).sessions.filter((s: Json) => s.heldOn >= "2026-10-06");
    // Paul says out of the fourth Friday: an answer is an answer
    const paul = await as("paul@example.com");
    await paul.call("POST", `/api/sessions/${fridays[3].id}/answer`, { answer: "out" });
    const res = await dana.call("PUT", `/api/series/${dana.friday.id}`, { ...dana.friday, endsOn: fridays[1].heldOn });
    expect(res.status).toBe(200);
    const left = (await dana.sees()).sessions.filter((s: Json) => s.heldOn >= "2026-10-06").map((s: Json) => s.heldOn);
    expect(left).toEqual([fridays[0].heldOn, fridays[1].heldOn, fridays[3].heldOn]);
  });

  it("past nights stay whatever the new rule: they're the record of who came", async () => {
    const dana = await admin();
    const before = (await dana.sees()).sessions.filter((s: Json) => s.heldOn < "2026-10-06").length;
    await dana.call("PUT", `/api/series/${dana.friday.id}`, { ...dana.friday, weekdays: ["thu"] });
    expect((await dana.sees()).sessions.filter((s: Json) => s.heldOn < "2026-10-06")).toHaveLength(before);
  });
});

describe("the night's teams", () => {
  async function night() {
    const dana = await admin();
    const s = (await dana.sees()).sessions.find((x: Json) => x.heldOn === "2026-10-09");
    for (const e of ["reg@example.com", "paul@example.com"])
      await (await as(e)).call("POST", `/api/sessions/${s.id}/answer`, { answer: "in" });
    const tess = await as("tess@example.com");
    const publish = (teams: unknown) => tess.call("POST", `/api/sessions/${s.id}/teams`, { teams });
    const seen = async () => (await dana.sees()).sessions.find((x: Json) => x.id === s.id);
    return { dana, tess, s, publish, seen, id: dana.id };
  }

  it.each([
    ["no teams", []],
    ["nine teams", Array.from({ length: 9 }, (_, i) => ({ name: `T${i}`, players: [] }))],
    ["a team with no name", [{ name: "  ", players: [] }]],
    ["a name past 30 letters", [{ name: "x".repeat(31), players: [] }]],
    ["players that aren't ids", [{ name: "Black", players: ["Reg"] }]],
    ["teams that aren't a list", { name: "Black", players: [] }],
  ])("publishing %s is refused, and the teams that were up stay", async (_, teams) => {
    const n = await night();
    expect((await n.publish([{ name: "Black", players: [n.id.Reg, n.id.Paul] }])).status).toBe(200);
    expect((await n.publish(teams)).status).toBe(400);
    expect((await n.seen()).teams).toEqual([{ name: "Black", players: [n.id.Reg, n.id.Paul] }]);
  });

  it("a player id that isn't a member is left off the team, not a server error", async () => {
    const n = await night();
    const res = await n.publish([{ name: "Black", players: [n.id.Reg, 987654] }]);
    expect(res.status).toBe(200);
    expect((await n.seen()).teams).toEqual([{ name: "Black", players: [n.id.Reg] }]);
  });

  it("publishing for a session that doesn't exist is a 404", async () => {
    const n = await night();
    const res = await n.tess.call("POST", "/api/sessions/999999/teams", { teams: [{ name: "Black", players: [] }] });
    expect(res.status).toBe(404);
  });

  it("an admin taking a player off the night takes them off their team too, and the first waiting moves up", async () => {
    const n = await night();
    await n.dana.call("PUT", `/api/series/${n.dana.friday.id}`, { ...n.dana.friday, capacity: 2 });
    await (await as("walt@example.com")).call("POST", `/api/sessions/${n.s.id}/answer`, { answer: "in" });
    await n.publish([
      { name: "Black", players: [n.id.Reg] },
      { name: "White", players: [n.id.Paul] },
    ]);
    const res = await n.dana.call("POST", `/api/sessions/${n.s.id}/players`, { memberId: n.id.Reg, in: false });
    expect(res.status).toBe(200);
    expect(await n.seen()).toMatchObject({
      going: [n.id.Paul, n.id.Walt],
      waitlist: [],
      teams: [
        { name: "Black", players: [] },
        { name: "White", players: [n.id.Paul] },
      ],
    });
  });

  it("resetting a session that doesn't exist is a 404", async () => {
    const n = await night();
    expect((await n.dana.call("POST", "/api/sessions/999999/reset", {})).status).toBe(404);
  });
});

describe("the register either side of London midnight", () => {
  /** Friday `day` full (room for two, Reg and Paul in); Tess adds Walt at `now` (a UTC instant). */
  async function addWalt(day: string, now: Date) {
    const dana = await admin();
    await dana.call("PUT", `/api/series/${dana.friday.id}`, { ...dana.friday, capacity: 2 });
    const s = (await dana.sees()).sessions.find((x: Json) => x.heldOn === day);
    expect(s).toBeTruthy();
    for (const e of ["reg@example.com", "paul@example.com"])
      await (await as(e)).call("POST", `/api/sessions/${s.id}/answer`, { answer: "in" }, opens(day));
    const tess = await as("tess@example.com");
    const res = await tess.call(
      "POST",
      `/api/sessions/${s.id}/register`,
      { memberId: dana.id.Walt, here: true },
      { now },
    );
    expect(res.status).toBe(200);
    return res.body.signup;
  }

  // Summer time: London is UTC+1, so 22:59 UTC is 23:59 on the Friday and 23:01 UTC is past midnight
  it("in summer time, at 23:59 on the Friday the night's still on: a walk-in on a full night waits", async () => {
    expect(await addWalt("2026-10-09", new Date("2026-10-09T22:59:00Z"))).toBe("waitlist");
  });

  it("in summer time, a minute past midnight the night's over: ticking a walk-in records that he came", async () => {
    expect(await addWalt("2026-10-09", new Date("2026-10-09T23:01:00Z"))).toBe("in");
  });

  // After the clocks go back on 25 October, London is UTC: 23:30 UTC is still the Friday
  it("after the clocks go back, at 23:30 UTC it's still Friday in London: a walk-in on a full night waits", async () => {
    expect(await addWalt("2026-10-30", new Date("2026-10-30T23:30:00Z"))).toBe("waitlist");
  });

  it("after the clocks go back, at midnight UTC the night's over: ticking a walk-in records that he came", async () => {
    expect(await addWalt("2026-10-30", new Date("2026-10-31T00:00:00Z"))).toBe("in");
  });

  it("the register needs who and here-or-not, and a session that exists", async () => {
    const dana = await admin();
    const s = (await dana.sees()).sessions.find((x: Json) => x.heldOn === "2026-10-09");
    const tess = await as("tess@example.com");
    expect((await tess.call("POST", `/api/sessions/${s.id}/register`, { memberId: dana.id.Walt })).status).toBe(400);
    expect((await tess.call("POST", `/api/sessions/${s.id}/register`, { here: true })).status).toBe(400);
    expect(
      (await tess.call("POST", `/api/sessions/${s.id}/register`, { memberId: dana.id.Walt, here: "yes" })).status,
    ).toBe(400);
    expect(
      (await tess.call("POST", "/api/sessions/999999/register", { memberId: dana.id.Walt, here: true })).status,
    ).toBe(404);
  });
});
