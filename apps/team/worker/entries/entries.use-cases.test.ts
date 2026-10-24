// Friday's sign-ups: Quarterly Members first. The whole list is in one order, Quarterly Members (ADR 0007) above
// everyone paying as they go, first come first served within each; the first places in that order are in, the rest
// wait. So a Quarterly Member signing up for a full Friday takes the place of the last one paying as they go, who
// waits at the top of their queue. Keepers aren't in it: they keep their sign-up place and a skater never takes a
// keeper's. The places are the skaters': keepers have their own, if the series sets any, else no limit.
// Tournaments and club events keep plain sign-up order. Driven through the real
// Worker handlers, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Paul Payg", position: "F", rating: 55, email: "paul@example.com" },
  { name: "Quinn Quarterly", position: "D", rating: 58, email: "quinn@example.com" },
  { name: "Quentin Quarterly", position: "F", rating: 52, email: "quentin@example.com" },
  { name: "Kim Keeper", position: "G", rating: 57, email: "kim@example.com" },
  { name: "Kip Keeper", position: "G", rating: 51, email: "kip@example.com" },
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
  const sees = async () => (await b.call("GET", "/api/bootstrap")).body as Json;
  return { call: b.call, sees };
}

/** Next Friday, room for two skaters (and `keepers` keepers; null: no limit), with Quinn and Quentin made Quarterly
 * Members by an admin. */
async function fullFriday(keepers: number | null = null) {
  const dana = await as("dana@example.com");
  const b = await dana.sees();
  const id = Object.fromEntries(b.members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
  const series = b.series[0];
  expect(
    (await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 2, goalieCapacity: keepers })).status,
  ).toBe(200);
  for (const m of [id.Quinn, id.Quentin])
    expect((await dana.call("POST", `/api/members/${m}/quarterly`, { quarterly: true })).status).toBe(200);
  const friday = (await dana.sees()).sessions.find((s: Json) => s.heldOn >= "2026-10-06");
  const signUp = async (email: string) => {
    const res = await (await as(email)).call("POST", `/api/sessions/${friday.id}/answer`, { answer: "in" });
    expect(res.status).toBe(200);
  };
  const out = async (email: string) => {
    const res = await (await as(email)).call("POST", `/api/sessions/${friday.id}/answer`, { answer: "out" });
    expect(res.status).toBe(200);
  };
  const seen = async (email = "reg@example.com") =>
    (await (await as(email)).sees()).sessions.find((s: Json) => s.id === friday.id);
  return { dana, id, friday, signUp, out, seen };
}

describe("Friday's sign-ups: Quarterly Members first", () => {
  it("a Quarterly Member who signs up goes above those paying as they go, and is marked", async () => {
    const { id, signUp, seen } = await fullFriday();
    await signUp("reg@example.com");
    await signUp("quinn@example.com"); // later, but Quarterly: above Reg
    // Everyone sees the same order, and which of them are Quarterly (the badge), not anyone else's plan
    expect(await seen()).toMatchObject({ going: [id.Quinn, id.Reg], waitlist: [], quarterly: [id.Quinn] });
  });

  it("a Quarterly Member signing up for a full Friday takes the place of the last one paying as they go", async () => {
    const { id, signUp, seen } = await fullFriday();
    await signUp("reg@example.com");
    await signUp("paul@example.com"); // the last place
    await signUp("quinn@example.com"); // Quarterly: in, and Paul, the last in paying as he goes, waits
    expect(await seen()).toMatchObject({ going: [id.Quinn, id.Reg], waitlist: [id.Paul], quarterly: [id.Quinn] });
    await signUp("quentin@example.com"); // Quarterly too: Reg waits now, ahead of Paul (he signed up first)
    expect(await seen()).toMatchObject({
      going: [id.Quinn, id.Quentin],
      waitlist: [id.Reg, id.Paul],
      quarterly: [id.Quinn, id.Quentin],
    });
  });

  it("when a place comes free, the first in that order moves up", async () => {
    const { id, signUp, seen, out } = await fullFriday();
    await signUp("reg@example.com");
    await signUp("paul@example.com");
    await signUp("quinn@example.com");
    await signUp("quentin@example.com");
    await out("quinn@example.com");
    expect(await seen()).toMatchObject({ going: [id.Quentin, id.Reg], waitlist: [id.Paul] });
  });

  it("a full Friday of Quarterly Members: the next one waits, still above those paying as they go", async () => {
    const { dana, id, signUp, seen } = await fullFriday();
    expect((await dana.call("POST", `/api/members/${id.Reg}/quarterly`, { quarterly: true })).status).toBe(200);
    await signUp("quinn@example.com");
    await signUp("quentin@example.com");
    await signUp("paul@example.com"); // waits
    await signUp("reg@example.com"); // Quarterly, nobody paying as they go is in to take a place from: waits, above Paul
    expect(await seen()).toMatchObject({ going: [id.Quinn, id.Quentin], waitlist: [id.Reg, id.Paul] });
  });

  it("keepers aren't in it: a Quarterly skater takes the place of a skater paying as they go, never a keeper's", async () => {
    const { id, signUp, seen } = await fullFriday();
    await signUp("reg@example.com");
    await signUp("kim@example.com"); // a keeper
    await signUp("paul@example.com"); // the last skater's place
    await signUp("quinn@example.com"); // Quarterly: Paul waits, not Kim
    expect(await seen()).toMatchObject({ going: [id.Quinn, id.Reg, id.Kim], waitlist: [id.Paul] });
  });

  it("a keeper signing up for a Friday full of skaters is in: the places are the skaters'", async () => {
    const { id, signUp, seen } = await fullFriday();
    await signUp("reg@example.com");
    await signUp("paul@example.com"); // the skaters' places are gone
    await signUp("kim@example.com");
    await signUp("kip@example.com");
    expect(await seen()).toMatchObject({ going: [id.Reg, id.Paul, id.Kim, id.Kip], waitlist: [] });
    await signUp("dana@example.com"); // a skater: waits
    expect(await seen()).toMatchObject({ waitlist: [id.Dana] });
  });

  it("a keeper saying they're out doesn't let a waiting skater in", async () => {
    const { id, signUp, out, seen } = await fullFriday();
    await signUp("reg@example.com");
    await signUp("kim@example.com");
    await signUp("paul@example.com");
    await signUp("dana@example.com"); // waits
    expect(await seen()).toMatchObject({ going: [id.Reg, id.Kim, id.Paul], waitlist: [id.Dana] });
    await out("kim@example.com");
    expect(await seen()).toMatchObject({ going: [id.Reg, id.Paul], waitlist: [id.Dana] });
  });

  it("keepers have places of their own when the series sets them: over them, a keeper waits", async () => {
    const { id, signUp, seen } = await fullFriday(1);
    await signUp("kim@example.com");
    await signUp("reg@example.com");
    await signUp("kip@example.com"); // the keeper's place is Kim's: Kip waits, though there's a skater's place
    await signUp("paul@example.com"); // the second skater's place
    expect(await seen()).toMatchObject({ going: [id.Kim, id.Reg, id.Paul], waitlist: [id.Kip] });
  });

  it("a skater leaving lets the first waiting skater in, not a keeper waiting ahead of them", async () => {
    const { id, signUp, out, seen } = await fullFriday(1);
    await signUp("kim@example.com");
    await signUp("reg@example.com");
    await signUp("paul@example.com");
    await signUp("kip@example.com"); // waits for a keeper's place
    await signUp("dana@example.com"); // waits for a skater's
    await out("reg@example.com");
    expect(await seen()).toMatchObject({ going: [id.Kim, id.Paul, id.Dana], waitlist: [id.Kip] });
    await out("kim@example.com"); // a keeper's place: Kip's
    expect(await seen()).toMatchObject({ going: [id.Paul, id.Kip, id.Dana], waitlist: [] });
  });

  it("whoever sees who's out sees which of them are Quarterly, so Out groups by plan; nobody else sees them", async () => {
    const { id, signUp, out, seen } = await fullFriday();
    await signUp("quinn@example.com");
    await signUp("reg@example.com");
    await out("quinn@example.com");
    await out("paul@example.com");
    expect(await seen("dana@example.com")).toMatchObject({ out: [id.Quinn, id.Paul], quarterly: [id.Quinn] });
    expect(await seen()).toMatchObject({ out: [], quarterly: [] });
  });

  it("a club event's waitlist stays first come, first served", async () => {
    const { dana, id } = await fullFriday();
    const event = await dana.call("POST", "/api/club-events", {
      title: "Curry night",
      startsAt: "2026-10-24T19:00:00.000Z",
      endsAt: "2026-10-24T22:00:00.000Z",
      venue: "",
      signup: true,
      capacity: 1,
    });
    const eventId = event.body.id ?? (await dana.sees()).clubEvents[0].id;
    for (const email of ["reg@example.com", "paul@example.com", "quinn@example.com"])
      await (await as(email)).call("POST", `/api/club-events/${eventId}/answer`, { answer: "in" });
    expect((await dana.sees()).clubEvents[0]).toMatchObject({ going: [id.Reg], waitlist: [id.Paul, id.Quinn] });
  });

  it("an admin makes room for one more at a club event: the first waiting is in, the next still waits (ADR 0131)", async () => {
    const { dana, id } = await fullFriday();
    const curry = {
      title: "Curry night",
      startsAt: "2026-10-24T19:00:00.000Z",
      endsAt: "2026-10-24T22:00:00.000Z",
      venue: "",
      signup: true,
      capacity: 1,
    };
    const event = await dana.call("POST", "/api/club-events", curry);
    const eventId = event.body.id ?? (await dana.sees()).clubEvents[0].id;
    for (const email of ["reg@example.com", "paul@example.com", "quinn@example.com"])
      await (await as(email)).call("POST", `/api/club-events/${eventId}/answer`, { answer: "in" });
    expect((await dana.call("PUT", `/api/club-events/${eventId}`, { ...curry, capacity: 2 })).status).toBe(200);
    expect((await dana.sees()).clubEvents[0]).toMatchObject({ going: [id.Reg, id.Paul], waitlist: [id.Quinn] });
  });
});
