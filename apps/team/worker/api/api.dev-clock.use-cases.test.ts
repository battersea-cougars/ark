// The club's clock moved for a request (api.dev-clock.ts, ADR 0124): on your own machine or dev a journey says what
// time it is, and the API reckons what's open by it; production never reads the header; who's signed in stays on the
// real clock.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { DEV_NOW_HEADER } from "./api.dev-clock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Mia Member", position: "F", rating: 60, email: "mia@example.com" },
];
/** Friday 16 October 2026: its sign-up opens on the Monday (the 12th), London midnight. NOW is Tuesday the 6th. */
const FRIDAY = "2026-10-16";
const MONDAY_MORNING = "2026-10-12T08:00:00Z";

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

async function fridayFor(email: string) {
  const mia = await w.signedIn(email);
  const boot = (await mia.call("GET", "/api/bootstrap")).body as Json;
  const night = boot.sessions.find((s: Json) => s.heldOn === FRIDAY);
  const answer = (at?: string) =>
    mia.call(
      "POST",
      `/api/sessions/${night.id}/answer`,
      { answer: "in" },
      { now: NOW, headers: at ? { [DEV_NOW_HEADER]: at } : {} },
    );
  return { answer };
}

describe("a journey moving the club's clock", () => {
  it("on your own machine, a night not open yet takes her In at the time the request says", async () => {
    const { answer } = await fridayFor("mia@example.com");
    expect((await answer()).status).toBe(409);
    expect((await answer(MONDAY_MORNING)).status).toBe(200);
  });

  it("in production the header is ignored: the real clock, so it's still refused", async () => {
    const { answer } = await fridayFor("mia@example.com");
    w.env.SITE_ENV = "production";
    const res = await answer(MONDAY_MORNING);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Sign-up opens/);
  });

  it("a time that isn't one is the real clock's", async () => {
    const { answer } = await fridayFor("mia@example.com");
    expect((await answer("next Monday")).status).toBe(409);
  });

  it("on dev, only an admin (manage:all) moves the clock: a member saying the time is on the real one", async () => {
    w.env.SITE_ENV = "dev";
    const mia = await fridayFor("mia@example.com");
    expect((await mia.answer(MONDAY_MORNING)).status).toBe(409);
    const dana = await fridayFor("dana@example.com");
    expect((await dana.answer(MONDAY_MORNING)).status).toBe(200);
  });

  it("only a whole ISO time in UTC moves it: a loose one ('1', a year past 9999, no zone) is the real clock's", async () => {
    const { answer } = await fridayFor("mia@example.com");
    for (const loose of ["1", "+275760-09-13T00:00:00Z", "2026-10-12T08:00:00", "2026-10-12"])
      expect((await answer(loose)).status).toBe(409);
  });

  it("who's signed in keeps the real clock: a year on, her session still counts", async () => {
    const { answer } = await fridayFor("mia@example.com");
    // A year and a day after NOW is past any session's lifetime: moved, it would be signed out
    const res = await answer("2027-10-07T08:00:00Z");
    expect(res.status).not.toBe(401);
  });
});
