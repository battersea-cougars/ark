// A training over something already on (ADR 0122): an admin adding a training, or moving one's day or hours, onto a
// night the club already has something on (the Kumite, another training, a one-off) is asked, as the Kumite's editor
// asks, whether that's off. The save says what the admin was asked about, and the check is in the statements that
// write it (ADR 0121): something put on between the question and the answer refuses the save, and the app asks again.
// What the admin calls off goes through its own cancel. Driven through the real Worker handlers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { londonISO } from "@cougars/shared/london";
import { testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Ann Admin", position: "F", rating: 70, email: "ann@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];
// NOW is Tuesday 6 October 2026; Friday Training (the seed's) is 19:30 to 21:30 every Friday
const FRIDAY = "2026-10-16";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

type Browser = Awaited<ReturnType<typeof w.signedIn>>;
const boot = async (b: Browser) => (await b.call("GET", "/api/bootstrap")).body as Json;

/** One Friday night's juniors' session, 19:00 to 20:30: over Friday Training. */
const JUNIORS = {
  name: "Juniors",
  shortName: "Juniors",
  icon: "skate",
  tone: "green",
  repeatEvery: 1,
  weekdays: ["fri"],
  startsOn: FRIDAY,
  endsOn: FRIDAY,
  startTime: "19:00",
  endTime: "20:30",
  venue: "The Rink",
  capacity: 16,
  goalieCapacity: null,
  public: true,
  active: true,
};
type Training = typeof JUNIORS & { id?: number };

/** What the training editor asks before it saves: the nights this training adds or moves, and what's on then. */
const ask = async (b: Browser, t: Training) => {
  const q = new URLSearchParams({
    ...(t.id ? { series: String(t.id) } : {}),
    weekdays: t.weekdays.join(","),
    repeatEvery: String(t.repeatEvery),
    startsOn: t.startsOn,
    endsOn: t.endsOn ?? "",
    startTime: t.startTime,
    endTime: t.endTime,
  });
  const res = await b.call("GET", `/api/calendar/clashes?${q}`);
  expect(res.status).toBe(200);
  return res.body.clashes as Json[];
};
const keys = (clashes: Json[]) => clashes.map((c) => c.key);

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
const friday = async (b: Browser) => (await boot(b)).series.find((s: Json) => s.id === 1) as Json;
const nightOn = async (b: Browser, day: string, seriesId = 1) =>
  (await boot(b)).sessions.find((s: Json) => s.heldOn === day && s.seriesId === seriesId) as Json;

describe("a training over something already on", () => {
  it("a new training on a Friday night hears Friday Training is on then, and that the admin can cancel it", async () => {
    const dana = await w.signedIn("dana@example.com");
    const night = await nightOn(dana, FRIDAY);

    expect(await ask(dana, JUNIORS)).toEqual([
      expect.objectContaining({
        key: `session:${night.id}`,
        source: "session",
        id: night.id,
        seriesId: 1,
        title: "Friday Training",
        day: FRIDAY,
        startsAt: londonISO(FRIDAY, "19:30"),
        endsAt: londonISO(FRIDAY, "21:30"),
        canCancel: true,
      }),
    ]);
  });

  it("saved with the answer, Friday Training's night is cancelled by its own cancel: whoever's in hears it's off", async () => {
    const dana = await w.signedIn("dana@example.com");
    const reg = await w.signedIn("reg@example.com");
    await reg.call("PUT", "/api/auth/device", { token: "reg-phone", platform: "ios" });
    const night = await nightOn(dana, FRIDAY);
    await reg.call(
      "POST",
      `/api/sessions/${night.id}/answer`,
      { answer: "in" },
      { now: new Date("2026-10-12T12:00:00Z") },
    );

    const clashes = await ask(dana, JUNIORS);
    const saved = await dana.call("POST", "/api/series", { ...JUNIORS, clashes: keys(clashes) });
    expect(saved.status).toBe(201);
    expect((await dana.call("POST", `/api/sessions/${night.id}/cancelled`, { cancelled: true })).status).toBe(200);

    expect(w.pushes).toEqual([expect.objectContaining({ token: "reg-phone", title: "Fri 16 Oct is off" })]);
    expect(await nightOn(dana, FRIDAY, saved.body.id)).toMatchObject({ cancelledAt: null });
    // And asked again, the juniors' night isn't over itself, and Friday Training's is off
    expect(await ask(dana, { ...JUNIORS, id: saved.body.id, startTime: "18:45" })).toEqual([]);
  });

  it("keeping both: the training is saved over it, and nothing is cancelled", async () => {
    const dana = await w.signedIn("dana@example.com");
    const clashes = await ask(dana, JUNIORS);
    expect((await dana.call("POST", "/api/series", { ...JUNIORS, clashes: keys(clashes) })).status).toBe(201);

    expect(await nightOn(dana, FRIDAY)).toMatchObject({ cancelledAt: null });
    expect(w.pushes).toEqual([]);
  });

  it("moving a training onto the Kumite's night says the Kumite's on, not one to cancel here", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/tournaments", kumite())).status).toBe(201);
    const sunday = {
      ...JUNIORS,
      name: "Sunday Skills",
      shortName: "Sunday",
      weekdays: ["sun"],
      startsOn: "2026-10-11",
    };
    const made = await dana.call("POST", "/api/series", { ...sunday, endsOn: "2026-10-25", clashes: [] });
    expect(made.status).toBe(201);

    // To Friday the 16th, 18:30 to 19:30: before Friday Training starts, in the Kumite
    const moved = {
      ...sunday,
      id: made.body.id,
      weekdays: ["fri"],
      startsOn: FRIDAY,
      endsOn: FRIDAY,
      startTime: "18:30",
      endTime: "19:30",
    };
    expect((await ask(dana, moved)).map((c) => [c.source, c.title, c.canCancel])).toEqual([
      ["tournament", "Kumite", false],
    ]);
  });

  it("a save that doesn't move the day or hours isn't asked about, nor refused for what was already there", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/tournaments", kumite())).status).toBe(201);
    const ft = await friday(dana);

    expect(await ask(dana, { ...ft, weekdays: ft.weekdays })).toEqual([]);
    expect((await dana.call("PUT", "/api/series/1", { ...ft, name: "Friday Hockey", clashes: [] })).status).toBe(200);
    expect((await friday(dana)).name).toBe("Friday Hockey");
  });

  it("moving Friday Training's hours asks about the Kumite on its nights, never about its own nights", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/tournaments", kumite())).status).toBe(201);
    const ft = await friday(dana);

    // 19:30 to 21:30 already sat in the Kumite (asked when the Kumite was put on); 19:00 is a new time
    const clashes = await ask(dana, { ...ft, startTime: "19:00" });
    expect(clashes).toEqual([expect.objectContaining({ source: "tournament", title: "Kumite", day: FRIDAY })]);
  });

  it("the Kumite put on between the question and the answer refuses the save, and asked again it's there", async () => {
    const dana = await w.signedIn("dana@example.com");
    const ann = await w.signedIn("ann@example.com");
    const ft = await friday(dana);
    const moved = { ...ft, startTime: "18:30", endTime: "20:00" };
    expect(await ask(dana, moved)).toEqual([]);

    // Ann puts the Kumite on while Dana's deciding
    expect((await ann.call("POST", "/api/tournaments", kumite())).status).toBe(201);

    const refused = await dana.call("PUT", "/api/series/1", { ...moved, clashes: [] });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/on then/i);
    expect((await friday(dana)).startTime).toBe("19:30");

    const again = await ask(dana, moved);
    expect(again.map((c) => c.title)).toContain("Kumite");
    expect((await dana.call("PUT", "/api/series/1", { ...moved, clashes: keys(again) })).status).toBe(200);
    expect((await friday(dana)).startTime).toBe("18:30");
  });

  it("a one-off or another training put on between them refuses a new training too, which isn't made", async () => {
    const dana = await w.signedIn("dana@example.com");
    const ann = await w.signedIn("ann@example.com");
    const sunday = {
      ...JUNIORS,
      name: "Sunday Skills",
      weekdays: ["sun"],
      startsOn: "2026-10-18",
      endsOn: "2026-10-18",
    };
    expect(await ask(dana, sunday)).toEqual([]);

    const quiz = await ann.call("POST", "/api/club-events", {
      title: "Quiz night",
      startsAt: londonISO("2026-10-18", "20:00"),
      endsAt: londonISO("2026-10-18", "23:00"),
      venue: "The Fox",
      description: "",
      public: true,
      signup: false,
    });
    expect(quiz.status).toBe(201);
    expect((await dana.call("POST", "/api/series", { ...sunday, clashes: [] })).status).toBe(409);
    expect((await boot(dana)).series.map((s: Json) => s.name)).toEqual(["Friday Training"]);

    // Asked again, the quiz; and while she answers, Ann adds an early Sunday training too
    const again = await ask(dana, sunday);
    expect(again).toEqual([expect.objectContaining({ source: "club_event", title: "Quiz night", canCancel: true })]);
    const early = { ...sunday, name: "Sunday Early", shortName: "Early", startTime: "18:00", endTime: "19:30" };
    expect((await ann.call("POST", "/api/series", { ...early, clashes: [] })).status).toBe(201);
    expect((await dana.call("POST", "/api/series", { ...sunday, clashes: keys(again) })).status).toBe(409);

    const third = await ask(dana, sunday);
    expect(third.map((c) => c.title)).toEqual(["Sunday Early", "Quiz night"]);
    expect((await dana.call("POST", "/api/series", { ...sunday, clashes: keys(third) })).status).toBe(201);
  });

  it("a training saved without being asked (no answer sent) is saved as before", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/series", JUNIORS)).status).toBe(201);
  });
});
