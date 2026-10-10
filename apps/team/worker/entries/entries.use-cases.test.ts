// Friday's waitlist: Quarterly Members go first. Signing up for a full Friday puts you on the waitlist; a Quarterly
// Member (ADR 0007) goes ahead of everyone paying as they go, and among each, first come first served. When a place
// comes free the first on that list moves up. Tournaments and club events keep plain sign-up order. Driven through
// the real Worker handlers, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Paul Payg", position: "F", rating: 55, email: "paul@example.com" },
  { name: "Quinn Quarterly", position: "D", rating: 58, email: "quinn@example.com" },
  { name: "Quentin Quarterly", position: "F", rating: 52, email: "quentin@example.com" },
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

/** Next Friday, room for one, with Quinn and Quentin made Quarterly Members by an admin. */
async function fullFriday() {
  const dana = await as("dana@example.com");
  const b = await dana.sees();
  const id = Object.fromEntries(b.members.map((m: Json) => [m.name.split(" ")[0], m.id])) as Record<string, number>;
  const series = b.series[0];
  expect((await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 1 })).status).toBe(200);
  for (const m of [id.Quinn, id.Quentin])
    expect((await dana.call("POST", `/api/members/${m}/quarterly`, { quarterly: true })).status).toBe(200);
  const friday = (await dana.sees()).sessions.find((s: Json) => s.heldOn >= "2026-10-06");
  const signUp = async (email: string) => {
    const res = await (await as(email)).call("POST", `/api/sessions/${friday.id}/answer`, { answer: "in" });
    expect(res.status).toBe(200);
  };
  const seen = async (email = "reg@example.com") =>
    (await (await as(email)).sees()).sessions.find((s: Json) => s.id === friday.id);
  return { dana, id, friday, signUp, seen };
}

describe("Friday's waitlist: Quarterly Members first", () => {
  it("a Quarterly Member who signs up for a full Friday goes ahead of those paying as they go, and is marked", async () => {
    const { id, signUp, seen } = await fullFriday();
    await signUp("reg@example.com"); // the one place
    await signUp("paul@example.com"); // waiting
    await signUp("quinn@example.com"); // waiting, but Quarterly: ahead of Paul
    await signUp("quentin@example.com"); // Quarterly too, after Quinn
    // Everyone sees the same order, and which of them are Quarterly (the badge), not anyone else's plan
    expect(await seen()).toMatchObject({
      going: [id.Reg],
      waitlist: [id.Quinn, id.Quentin, id.Paul],
      quarterly: [id.Quinn, id.Quentin],
    });
  });

  it("when a place comes free, the Quarterly Member moves up, not the one who signed up first", async () => {
    const { id, signUp, seen } = await fullFriday();
    await signUp("reg@example.com");
    await signUp("paul@example.com");
    await signUp("quinn@example.com");
    expect(
      (await (await as("reg@example.com")).call("POST", `/api/sessions/${(await seen()).id}/answer`, { answer: "out" }))
        .status,
    ).toBe(200);
    expect(await seen()).toMatchObject({ going: [id.Quinn], waitlist: [id.Paul], quarterly: [] });
  });

  it("someone who's in stays in: a Quarterly Member signing up late waits, first in the queue", async () => {
    const { id, signUp, seen } = await fullFriday();
    await signUp("paul@example.com");
    await signUp("quinn@example.com");
    expect(await seen()).toMatchObject({ going: [id.Paul], waitlist: [id.Quinn] });
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
});
