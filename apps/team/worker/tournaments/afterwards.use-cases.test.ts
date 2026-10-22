// Where everyone goes afterwards (ADR 0074), driven through the real Worker handlers in the fake world (testing.ts).
//
// The story: the club always goes to The Anchor after a Kumite, for the celebration and awards. It's set once, on the
// series, so a new Kumite has it without anyone retyping it. One Kumite can go somewhere else, at its own time, or
// nowhere this time. A venue that doesn't exist is refused. The day's entry in the club's calendar says where.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterOf } from "@cougars/shared/places";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
/** The Kumite series, as the club's seed has it: afterwards, The Anchor (db/seed/club.sql). */
const KUMITE = 1;

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
  /** Where everyone goes after this one, as the app works it out from what it's sent (lib/tournament-front.ts). */
  const afterwards = async (id: number) => {
    const club = await sees();
    const t = club.tournaments.find((x: Json) => x.id === id);
    const type = club.tournamentTypes.find((x: Json) => x.id === t.typeId);
    return afterOf(
      t.afterMode,
      { venueId: t.afterVenueId, time: t.afterTime, note: t.afterNote },
      type && { venueId: type.afterVenueId, time: type.afterTime, note: type.afterNote },
      club.venues,
    );
  };
  return { call: b.call, sees, afterwards };
}

/** An admin schedules the next Kumite in a few questions: only what the quick form asks. */
async function nextKumite(dana: Awaited<ReturnType<typeof as>>, more: object = {}) {
  const res = await dana.call("POST", "/api/tournaments", {
    typeId: KUMITE,
    name: "The Cougars Kumite",
    heldOn: "2026-12-11",
    ...more,
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/** A venue an admin saves under Settings → Venues. */
async function venue(dana: Awaited<ReturnType<typeof as>>, name: string) {
  const res = await dana.call("POST", "/api/venues", { name, address: "", mapUrl: "", active: true });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/** The tournament as the editor saves it: everything it had, with these changes. */
async function save(dana: Awaited<ReturnType<typeof as>>, id: number, changes: object) {
  const t = (await dana.sees()).tournaments.find((x: Json) => x.id === id);
  return dana.call("PUT", `/api/tournaments/${id}`, { ...t, ...changes });
}

describe("afterwards", () => {
  it("a new Kumite goes to The Anchor afterwards, for the celebration and awards, without anyone saying so", async () => {
    const dana = await as("dana@example.com");
    const id = await nextKumite(dana);

    const reg = await as("reg@example.com");
    expect(await reg.afterwards(id)).toMatchObject({
      name: "The Anchor",
      mapUrl: "https://maps.app.goo.gl/GhKGiPB1vKnpV6HB7",
      time: null,
      note: "Celebration and awards",
    });
    // The day's entry in everyone's calendar says so too
    const day = (await reg.sees()).agenda.find((r: Json) => r.kind === "tournament" && r.sourceId === id);
    expect(day.description).toBe("Afterwards: The Anchor. Celebration and awards.");
  });

  it("a change to the series' afterwards reaches every Kumite on it", async () => {
    const dana = await as("dana@example.com");
    const id = await nextKumite(dana);
    const latch = await venue(dana, "The Latchmere");
    const series = (await dana.sees()).tournamentTypes.find((x: Json) => x.id === KUMITE);
    const res = await dana.call("PUT", `/api/tournament-types/${KUMITE}`, {
      ...series,
      afterVenueId: latch,
      afterTime: "21:45",
      afterNote: "Awards",
    });
    expect(res.status).toBe(200);

    expect(await (await as("reg@example.com")).afterwards(id)).toMatchObject({
      name: "The Latchmere",
      time: "21:45",
      note: "Awards",
    });
    const day = (await dana.sees()).agenda.find((r: Json) => r.kind === "tournament" && r.sourceId === id);
    expect(day.description).toBe("Afterwards: The Latchmere, from 9:45pm. Awards.");
  });

  it("one Kumite can go somewhere else afterwards, at its own time, and the next one's back at The Anchor", async () => {
    const dana = await as("dana@example.com");
    const id = await nextKumite(dana);
    const latch = await venue(dana, "The Latchmere");
    const res = await save(dana, id, {
      afterMode: "own",
      afterVenueId: latch,
      afterTime: "22:00",
      afterNote: "Christmas party",
    });
    expect(res.status).toBe(200);

    expect(await (await as("reg@example.com")).afterwards(id)).toMatchObject({
      name: "The Latchmere",
      time: "22:00",
      note: "Christmas party",
    });
    // A save that doesn't mention it (another screen's) leaves it as it was
    const {
      afterMode: _,
      afterVenueId: __,
      afterTime: ___,
      afterNote: ____,
      ...rest
    } = (await dana.sees()).tournaments.find((x: Json) => x.id === id);
    expect((await dana.call("PUT", `/api/tournaments/${id}`, { ...rest, capacity: 30 })).status).toBe(200);
    expect((await dana.afterwards(id))?.name).toBe("The Latchmere");

    const next = await nextKumite(dana, { heldOn: "2027-01-15" });
    expect((await dana.afterwards(next))?.name).toBe("The Anchor");
  });

  it("one Kumite can go nowhere afterwards this time, and back to the usual", async () => {
    const dana = await as("dana@example.com");
    const id = await nextKumite(dana);
    expect((await save(dana, id, { afterMode: "none" })).status).toBe(200);

    const reg = await as("reg@example.com");
    expect(await reg.afterwards(id)).toBeNull();
    const day = (await reg.sees()).agenda.find((r: Json) => r.kind === "tournament" && r.sourceId === id);
    expect(day.description).toBe("");

    expect((await save(dana, id, { afterMode: "usual" })).status).toBe(200);
    expect((await reg.afterwards(id))?.name).toBe("The Anchor");
  });

  it("a series can go nowhere afterwards", async () => {
    const dana = await as("dana@example.com");
    const id = await nextKumite(dana);
    const series = (await dana.sees()).tournamentTypes.find((x: Json) => x.id === KUMITE);
    const res = await dana.call("PUT", `/api/tournament-types/${KUMITE}`, { ...series, afterVenueId: null });
    expect(res.status).toBe(200);
    expect(await dana.afterwards(id)).toBeNull();
  });

  it("refuses a venue that doesn't exist, for a series or a tournament, and an own one with no venue", async () => {
    const dana = await as("dana@example.com");
    const id = await nextKumite(dana);
    const own = await save(dana, id, { afterMode: "own", afterVenueId: 999 });
    expect(own.status).toBe(400);
    expect(own.body.error).toMatch(/No such venue/);
    expect((await save(dana, id, { afterMode: "own", afterVenueId: null })).status).toBe(400);
    expect((await save(dana, id, { afterMode: "elsewhere" })).status).toBe(400);

    const series = (await dana.sees()).tournamentTypes.find((x: Json) => x.id === KUMITE);
    const type = await dana.call("PUT", `/api/tournament-types/${KUMITE}`, { ...series, afterVenueId: 999 });
    expect(type.status).toBe(400);
    // Nothing changed
    expect((await dana.afterwards(id))?.name).toBe("The Anchor");
  });
});
