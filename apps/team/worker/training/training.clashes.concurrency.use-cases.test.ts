// Two admins putting a training on the same evening at once (ADR 0122, ADR 0121): each asked first and heard nothing
// was on, and each saves saying so. The check is in the statements that write each one, so whichever writes second
// sees the first (its night, or its rule before its nights are made) and is refused, to be asked again; never two
// trainings over each other that nobody was asked about. The fake D1 interleaves the two requests a different way each
// seed. Driven through the real Worker handlers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Ann Admin", position: "F", rating: 70, email: "ann@example.com", roles: ["Admin"] },
];
const SEEDS = seeds(8, 114);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** A Sunday evening's training, every week from the 11th: nothing else is on Sundays. */
const sunday = (name: string, startTime: string, endTime: string) => ({
  name,
  shortName: name.split(" ")[1],
  icon: "skate",
  tone: "green",
  repeatEvery: 1,
  weekdays: ["sun"],
  startsOn: "2026-10-11",
  endsOn: null,
  startTime,
  endTime,
  venue: "The park",
  capacity: 16,
  goalieCapacity: null,
  public: true,
  active: true,
});

describe("two trainings put on the same evening at once", () => {
  it.each(SEEDS)("seed %i: one is saved, the other refused, never both unasked", async (seed) => {
    const dana = await w.signedIn("dana@example.com");
    const ann = await w.signedIn("ann@example.com");
    await dana.call("GET", "/api/bootstrap", undefined, { now: NOW });

    w.db.interleave(seed);
    const [a, b] = await Promise.all([
      dana.call("POST", "/api/series", { ...sunday("Sunday Skills", "18:00", "19:30"), clashes: [] }),
      ann.call("POST", "/api/series", { ...sunday("Sunday Scrimmage", "19:00", "20:30"), clashes: [] }),
    ]);
    w.db.interleave(null);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const series = ((await dana.call("GET", "/api/bootstrap")).body as Json).series.map((s: Json) => s.name);
    expect(series).toHaveLength(2);
  });
});
