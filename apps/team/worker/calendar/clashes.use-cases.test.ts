// Something over something else (ADR 0122): an admin putting a tournament, or a one-off, on a day and time when the
// club already has something on (the Kumite on a Friday night, over Friday Training) is asked whether that should be
// off. The app asks the Worker what clashes before it saves; what the admin chooses to cancel goes through the
// session's own cancel (members told, nobody charged), never a second one. Driven through the real Worker handlers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { londonISO } from "@cougars/shared/london";
import { NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
// NOW is Tuesday 6 October 2026; Friday Training (the seed's) is 19:30 to 21:30 every Friday
const FRIDAY = "2026-10-16";
// Past the 12 weeks of sessions made ahead (to 29 December): no session row yet
const FAR_FRIDAY = "2027-03-12";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Browser = Awaited<ReturnType<typeof w.signedIn>>;
const boot = async (b: Browser, now = NOW) => (await b.club({ now })).body as Json;
const sessionOn = async (b: Browser, day: string, now = NOW) =>
  (await boot(b, now)).sessions.find((s: Json) => s.heldOn === day && s.seriesId === 1) as Json;

/** London's wall clock on a day, as the app sends it. */
const at = londonISO;
const ask = (b: Browser, startsAt: string, endsAt: string, except?: string) =>
  b.call("GET", `/api/calendar/clashes?${new URLSearchParams({ startsAt, endsAt, ...(except ? { except } : {}) })}`);

/** The Kumite as an admin puts it on: a Friday, 18:00 to 23:00. */
const kumite = (day = FRIDAY) => ({
  name: "Kumite",
  location: "The Rink",
  heldOn: day,
  startTime: "18:00",
  endTime: "23:00",
  status: "planned",
  feePence: 0,
  kind: "teams",
  teams: [],
});

describe("scheduling over something already on", () => {
  it("the Kumite on a Friday night: the app hears Friday Training is on then, and that the admin can cancel it", async () => {
    const dana = await w.signedIn("dana@example.com");
    const night = await sessionOn(dana, FRIDAY);

    const res = await ask(dana, at(FRIDAY, "18:00"), at(FRIDAY, "23:00"));

    expect(res.status).toBe(200);
    expect(res.body.clashes).toEqual([
      expect.objectContaining({
        source: "session",
        id: night.id,
        seriesId: 1,
        title: "Friday Training",
        day: FRIDAY,
        startsAt: at(FRIDAY, "19:30"),
        endsAt: at(FRIDAY, "21:30"),
        canCancel: true,
        signedUp: 0,
      }),
    ]);
  });

  it("cancelling it is the session's own cancel: whoever signed up hears it's off, and it stays off as sessions are made", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await w.signedIn("reg@example.com");
    await reg.call("PUT", "/api/auth/device", { token: "reg-phone", platform: "ios" });
    const night = await sessionOn(dana, FRIDAY);
    await reg.call(
      "POST",
      `/api/sessions/${night.id}/answer`,
      { answer: "in" },
      { now: new Date("2026-10-12T12:00:00Z") },
    ); // the Monday: sign-up open (ADR 0030)
    const [clash] = (await ask(dana, at(FRIDAY, "18:00"), at(FRIDAY, "23:00"))).body.clashes;
    expect(clash.signedUp).toBe(1);

    // Saved, then what the admin chose: the Kumite, and Friday Training off
    const saved = await dana.call("POST", "/api/tournaments", kumite());
    expect(saved.status).toBe(201);
    expect((await dana.call("POST", `/api/sessions/${clash.id}/cancelled`, { cancelled: true })).status).toBe(200);

    expect(w.pushes).toEqual([expect.objectContaining({ token: "reg-phone", title: "Fri 16 Oct is off" })]);
    // A week on, the app makes the weeks ahead again: the night is still off, not made afresh
    const later = new Date("2026-10-13T11:00:00Z");
    const after = (await boot(dana, later)).sessions.filter((s: Json) => s.heldOn === FRIDAY);
    expect(after).toEqual([expect.objectContaining({ id: night.id, cancelledAt: expect.any(String) })]);
    // And editing the Kumite again, nothing clashes: the night's off, and the Kumite isn't over itself
    const self = `tournament:${saved.body.id}`;
    expect((await ask(dana, at(FRIDAY, "18:00"), at(FRIDAY, "23:00"), self)).body.clashes).toEqual([]);
  });

  it("keeping both: nothing is cancelled and nobody is told", async () => {
    const dana = await w.signedIn("dana@example.com");
    const night = await sessionOn(dana, FRIDAY);
    expect((await dana.call("POST", "/api/tournaments", kumite())).status).toBe(201);

    expect((await sessionOn(dana, FRIDAY)).cancelledAt).toBeNull();
    expect(w.pushes).toEqual([]);
    expect((await sessionOn(dana, FRIDAY)).id).toBe(night.id);
  });

  it("a Friday past the weeks made ahead still clashes, and cancelling makes that night and keeps it off", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect(await sessionOn(dana, FAR_FRIDAY)).toBeUndefined();

    const [clash] = (await ask(dana, at(FAR_FRIDAY, "18:00"), at(FAR_FRIDAY, "23:00"))).body.clashes;
    expect(clash).toMatchObject({ source: "session", id: null, seriesId: 1, day: FAR_FRIDAY, canCancel: true });

    // The app makes the night (the rule gives it), then cancels it the usual way
    const made = await dana.call("POST", "/api/series/1/sessions", { heldOn: FAR_FRIDAY });
    expect(made.status).toBe(200);
    expect((await dana.call("POST", `/api/sessions/${made.body.id}/cancelled`, { cancelled: true })).status).toBe(200);

    // Months on, when the weeks ahead reach it, it's the same night, still off
    const then = new Date("2027-01-05T11:00:00Z");
    expect((await boot(dana, then)).sessions.filter((s: Json) => s.heldOn === FAR_FRIDAY)).toEqual([
      expect.objectContaining({ id: made.body.id, cancelledAt: expect.any(String) }),
    ]);
    // The weeks before it were made as usual
    expect(await sessionOn(dana, "2027-01-08", then)).toMatchObject({ cancelledAt: null });
  });

  it("making a night twice is the same night; a day the training isn't on isn't one", async () => {
    const dana = await w.signedIn("dana@example.com");
    const first = await dana.call("POST", "/api/series/1/sessions", { heldOn: FAR_FRIDAY });
    const again = await dana.call("POST", "/api/series/1/sessions", { heldOn: FAR_FRIDAY });
    expect(again.body.id).toBe(first.body.id);

    expect((await dana.call("POST", "/api/series/1/sessions", { heldOn: "2027-03-11" })).status).toBe(400);
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", "/api/series/1/sessions", { heldOn: FAR_FRIDAY })).status).toBe(403);
  });

  it("a one-off over training asks too, and a one-off over the Kumite says it's on but isn't one to cancel here", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/tournaments", kumite())).status).toBe(201);

    const clashes = (await ask(dana, at(FRIDAY, "20:00"), at(FRIDAY, "23:30"))).body.clashes as Json[];

    expect(clashes.map((c) => [c.source, c.title, c.canCancel])).toEqual([
      ["tournament", "Kumite", false],
      ["session", "Friday Training", true],
    ]);
  });

  it("a one-off over another one-off clashes; editing it at its own time doesn't clash with itself", async () => {
    const dana = await w.signedIn("dana@example.com");
    const made = await dana.call("POST", "/api/club-events", {
      title: "Quiz night",
      startsAt: at("2026-10-14", "19:00"),
      endsAt: at("2026-10-14", "22:00"),
      venue: "The Fox",
      description: "",
      public: true,
      signup: false,
    });
    expect(made.status).toBe(201);
    const event = `club_event:${made.body.id}`;
    expect((await ask(dana, at("2026-10-14", "19:00"), at("2026-10-14", "22:00"), event)).body.clashes).toEqual([]);

    // Another one-off on the Wednesday is over the quiz, which can be called off
    expect((await ask(dana, at("2026-10-14", "21:00"), at("2026-10-14", "23:00"))).body.clashes).toEqual([
      expect.objectContaining({ source: "club_event", id: made.body.id, title: "Quiz night", canCancel: true }),
    ]);
  });

  it("on the same day is a clash, whatever the hours: the afternoon, or after training's over", async () => {
    const dana = await w.signedIn("dana@example.com");
    const friday = [expect.objectContaining({ source: "session", title: "Friday Training", day: FRIDAY })];
    expect((await ask(dana, at(FRIDAY, "12:00"), at(FRIDAY, "17:00"))).body.clashes).toEqual(friday);
    expect((await ask(dana, at(FRIDAY, "21:30"), at(FRIDAY, "23:00"))).body.clashes).toEqual(friday);
  });

  it("what isn't a clash: the day before or after, a night already off, a sign-up deadline or draft night", async () => {
    const dana = await w.signedIn("dana@example.com");
    // The Thursday evening and the Saturday
    expect((await ask(dana, at("2026-10-15", "19:00"), at("2026-10-15", "22:00"))).body.clashes).toEqual([]);
    expect((await ask(dana, at("2026-10-17", "10:00"), at("2026-10-17", "22:00"))).body.clashes).toEqual([]);
    // A deadline and a draft night (all day, no time) on the Thursday
    expect(
      (
        await dana.call("POST", "/api/tournaments", {
          ...kumite("2026-10-24"),
          kind: "draft",
          signupClosesOn: "2026-10-15",
          draftOn: "2026-10-15",
        })
      ).status,
    ).toBe(201);
    expect((await ask(dana, at("2026-10-15", "00:00"), at("2026-10-15", "23:59"))).body.clashes).toEqual([]);
    // A night already off
    const night = await sessionOn(dana, FRIDAY);
    await dana.call("POST", `/api/sessions/${night.id}/cancelled`, { cancelled: true });
    expect((await ask(dana, at(FRIDAY, "18:00"), at(FRIDAY, "23:00"))).body.clashes).toEqual([]);
  });

  it("a paused training doesn't clash, made or not", async () => {
    const dana = await w.signedIn("dana@example.com");
    const series = (await boot(dana)).series.find((s: Json) => s.id === 1);
    expect((await dana.call("PUT", "/api/series/1", { ...series, active: false })).status).toBe(200);

    expect((await ask(dana, at(FRIDAY, "18:00"), at(FRIDAY, "23:00"))).body.clashes).toEqual([]);
    expect((await ask(dana, at(FAR_FRIDAY, "18:00"), at(FAR_FRIDAY, "23:00"))).body.clashes).toEqual([]);
  });

  it("a member can see what's on then, but nothing is theirs to cancel", async () => {
    const reg = await w.signedIn("reg@example.com");
    expect((await ask(reg, at(FRIDAY, "18:00"), at(FRIDAY, "23:00"))).body.clashes).toEqual([
      expect.objectContaining({ title: "Friday Training", canCancel: false }),
    ]);
  });

  it("a time that isn't one, or an end before the start, is refused", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await ask(dana, "soon", at(FRIDAY, "23:00"))).status).toBe(400);
    expect((await ask(dana, at(FRIDAY, "23:00"), at(FRIDAY, "18:00"))).status).toBe(400);
  });
});
