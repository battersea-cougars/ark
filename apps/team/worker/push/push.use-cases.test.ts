// Notifications on a member's phone (ADR 0108): the store app registers the phone after sign-in, and the club tells
// them what's theirs to know: the night's teams are out, a place came up for them, a session's off, an announcement.
// Driven through the real handlers in the fake world (ADR 0031); with no Firebase, each notification is caught in the
// fake world's push outbox, one per phone, the way FCM would deliver it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { minutes, testWorld } from "../testing";
import { DRAIN_AT_ONCE, PUSH_TRIES, SEND_AT_ONCE } from "./push";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Alt Player", position: "F", rating: 55, email: "alt@example.com" },
];
// NOW is Tuesday 6 October 2026: the next Friday is the 9th
const NEXT_FRIDAY = "2026-10-09";

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const boot = async (b: Browser) => (await b.club()).body;
const memberId = async (b: Browser, name: string) =>
  (await boot(b)).members.find((m: { name: string }) => m.name === name).id as number;
const friday = async (b: Browser) =>
  (await boot(b)).sessions.find((s: { heldOn: string }) => s.heldOn === NEXT_FRIDAY) as { id: number };
/** A phone with the app, signed in as this member. */
async function phone(email: string, token = `token-${email}`) {
  const b = await w.signedIn(email);
  expect((await b.call("PUT", "/api/auth/device", { token, platform: "ios" })).status).toBe(200);
  return b;
}
const sentTo = () => w.pushes.map((p) => p.token);
const ANNOUNCEMENT = { title: "Pub after", body: "The Fox.", link: "", endsOn: "2026-10-24" };

describe("a member's phone", () => {
  it("registers for notifications after sign-in, and signing out forgets it", async () => {
    const reg = await phone("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", {
      title: "Pub after",
      body: "The Fox.",
      link: "",
      endsOn: "2026-10-24",
    });
    expect(sentTo()).toEqual(["token-reg@example.com"]);

    await reg.call("POST", "/api/auth/sign-out");
    w.pushes.length = 0;
    await dana.call("POST", "/api/announcements", {
      title: "Pub again",
      body: "The Fox.",
      link: "",
      endsOn: "2026-10-24",
    });
    expect(sentTo()).toEqual([]);
  });

  it("is checked: a token is a short string, a platform is ios or android", async () => {
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("PUT", "/api/auth/device", { token: "", platform: "ios" })).status).toBe(400);
    expect((await reg.call("PUT", "/api/auth/device", { token: "x".repeat(5000), platform: "ios" })).status).toBe(400);
    expect((await reg.call("PUT", "/api/auth/device", { token: "t", platform: "symbian" })).status).toBe(400);
  });

  it("moves to whoever signs in on it next", async () => {
    await phone("reg@example.com", "shared-phone");
    await phone("alt@example.com", "shared-phone");
    const dana = await w.signedIn("dana@example.com");
    const alt = await memberId(dana, "Alt Player");
    await dana.call("POST", "/api/announcements", {
      title: "Pub after",
      body: "The Fox.",
      link: "",
      endsOn: "2026-10-24",
    });
    expect(w.pushes).toEqual([expect.objectContaining({ token: "shared-phone", memberId: alt })]);
  });
});

describe("what the club tells them", () => {
  it("the night's teams are out: everyone on a team hears which, and nobody else", async () => {
    const reg = await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    const session = await friday(dana);
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    const regId = await memberId(dana, "Reg Player");

    await dana.call("POST", `/api/sessions/${session.id}/teams`, {
      teams: [{ name: "Black", players: [regId] }],
    });

    expect(w.pushes).toEqual([
      expect.objectContaining({
        token: "token-reg@example.com",
        title: "Teams are out",
        body: "Fri 9 Oct: you're on Black.",
        path: `/training/friday/${NEXT_FRIDAY}`,
      }),
    ]);
  });

  it("teams changed after they're out: only whoever changed team hears, not everyone again", async () => {
    const reg = await phone("reg@example.com");
    const alt = await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    const session = await friday(dana);
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await alt.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    const regId = await memberId(dana, "Reg Player");
    const altId = await memberId(dana, "Alt Player");
    const teams = (black: number[], white: number[]) =>
      dana.call("POST", `/api/sessions/${session.id}/teams`, {
        teams: [
          { name: "Black", players: black },
          { name: "White", players: white },
        ],
      });
    await teams([regId], [altId]);
    expect(sentTo().sort()).toEqual(["token-alt@example.com", "token-reg@example.com"]);
    w.pushes.length = 0;

    // Shuffled about, nobody's team changed: nothing to tell
    await teams([regId], [altId]);
    expect(w.pushes).toEqual([]);

    // Alt swaps to Black
    await teams([regId, altId], []);
    expect(w.pushes).toEqual([
      expect.objectContaining({
        token: "token-alt@example.com",
        title: "Team change",
        body: "Fri 9 Oct: you're now on Black.",
      }),
    ]);
  });

  it("a session's off: everyone signed up or waiting hears it", async () => {
    const reg = await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    const session = await friday(dana);
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });

    await dana.call("POST", `/api/sessions/${session.id}/cancelled`, { cancelled: true });

    expect(w.pushes).toEqual([
      expect.objectContaining({
        token: "token-reg@example.com",
        title: "Fri 9 Oct is off",
        path: `/training/friday/${NEXT_FRIDAY}`,
      }),
    ]);
    // Putting it back on isn't news to send
    w.pushes.length = 0;
    await dana.call("POST", `/api/sessions/${session.id}/cancelled`, { cancelled: false });
    expect(sentTo()).toEqual([]);
  });

  it("an announcement: everyone with the app hears it, the one who posted it too", async () => {
    await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await phone("dana@example.com");
    await dana.call("POST", "/api/announcements", {
      title: "No training on the 24th",
      body: "The hall's booked.",
      link: "",
      endsOn: "2026-10-24",
    });
    expect(sentTo().sort()).toEqual(["token-alt@example.com", "token-dana@example.com", "token-reg@example.com"]);
    expect(w.pushes[0]).toMatchObject({ title: "No training on the 24th", body: "The hall's booked.", path: "/" });
  });
});

// What each member hears is theirs to choose (#24): a switch per topic on the You page, every one on until they turn
// it off. The choice is the member's, whichever phone they're signed in on.
describe("what a member chooses to hear", () => {
  const prefs = async (b: Browser) => (await b.call("GET", "/api/me/notifications")).body;

  it("hears everything until they say otherwise", async () => {
    const reg = await w.signedIn("reg@example.com");
    const all = {
      teams: true,
      places: true,
      sessionOff: true,
      announcements: true,
      dues: true,
      draft: true,
      email: true,
      security: true,
      usage: true,
    };
    expect(await prefs(reg)).toEqual(all);
    expect((await boot(reg)).notifications).toEqual(all);
  });

  it("turns the night's teams off: doesn't hear teams are out, still hears announcements", async () => {
    const reg = await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    const session = await friday(dana);
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await w
      .signedIn("alt@example.com")
      .then((alt) => alt.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" }));
    const r = await reg.call("PUT", "/api/me/notifications", { teams: false });
    expect(r.status).toBe(200);
    expect(r.body.changed.notifications).toMatchObject({ teams: false, announcements: true });

    const [regId, altId] = [await memberId(dana, "Reg Player"), await memberId(dana, "Alt Player")];
    await dana.call("POST", `/api/sessions/${session.id}/teams`, {
      teams: [{ name: "Black", players: [regId, altId] }],
    });
    expect(sentTo()).toEqual(["token-alt@example.com"]);

    w.pushes.length = 0;
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(sentTo().sort()).toEqual(["token-alt@example.com", "token-reg@example.com"]);

    // On again, and they hear the teams the next time
    await reg.call("PUT", "/api/me/notifications", { teams: true });
    w.pushes.length = 0;
    await dana.call("POST", `/api/sessions/${session.id}/teams`, { teams: [{ name: "White", players: [regId] }] });
    expect(sentTo()).toEqual(["token-reg@example.com"]);
  });

  it("is checked: only the topics there are, each on or off", async () => {
    const reg = await w.signedIn("reg@example.com");
    const put = (b: unknown) => reg.call("PUT", "/api/me/notifications", b);
    expect((await put({})).status).toBe(400);
    expect((await put({ teams: "no" })).status).toBe(400);
    expect((await put({ gossip: false })).status).toBe(400);
    // The draft's open is sent to its captains (ADR 0060), so it's a topic to turn off
    expect((await put({ draft: false })).status).toBe(200);
    expect(await prefs(reg)).toMatchObject({ teams: true });
  });

  it("is only ever your own: nobody changes someone else's", async () => {
    const reg = await w.signedIn("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    const regId = await memberId(dana, "Reg Player");
    // Not even an admin: there's no route to anyone else's, and a member's id in the body is refused
    expect((await dana.call("PUT", `/api/members/${regId}/notifications`, { teams: false })).status).toBe(404);
    expect((await dana.call("PUT", "/api/me/notifications", { memberId: regId, teams: false })).status).toBe(400);
    expect(await prefs(reg)).toMatchObject({ teams: true });
    // Dana's own choice is hers alone
    await dana.call("PUT", "/api/me/notifications", { announcements: false });
    expect(await prefs(reg)).toMatchObject({ announcements: true });
    expect(await prefs(dana)).toMatchObject({ announcements: false });
  });

  it("goes when they delete their account", async () => {
    const reg = await w.signedIn("reg@example.com");
    await reg.call("PUT", "/api/me/notifications", { teams: false });
    expect((await reg.call("DELETE", "/api/me")).status).toBe(200);
    expect(w.db.raw.prepare("SELECT count(*) n FROM notification_prefs").get()).toEqual({ n: 0 });
  });
});

// #97: a training's list is one order, Quarterly Members first (ADR 0131). One signing up for a full Friday takes the
// place of the last one in paying as they go, who should know before they turn up.
describe("a place taken by a Quarterly Member", () => {
  async function fullFriday() {
    const dana = await w.signedIn("dana@example.com");
    const series = (await boot(dana)).series[0];
    await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 1 });
    const altId = await memberId(dana, "Alt Player");
    expect((await dana.call("POST", `/api/members/${altId}/quarterly`, { quarterly: true })).status).toBe(200);
    const session = await friday(dana);
    const reg = await phone("reg@example.com");
    const alt = await phone("alt@example.com");
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    expect(sentTo()).toEqual([]);
    return { reg, alt, session };
  }

  it("the one paying as they go, bumped to the waitlist, hears it; and hears when they're back in", async () => {
    const { alt, session } = await fullFriday();

    await alt.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    expect(w.pushes).toEqual([
      expect.objectContaining({
        token: "token-reg@example.com",
        title: "On the waitlist",
        body: "You're on the waitlist for Fri 9 Oct, first in line: a Quarterly Member took the last place.",
        path: `/training/friday/${NEXT_FRIDAY}`,
      }),
    ]);

    w.pushes.length = 0;
    await alt.call("POST", `/api/sessions/${session.id}/answer`, { answer: "out" });
    expect(w.pushes).toEqual([expect.objectContaining({ token: "token-reg@example.com", title: "You're in" })]);
  });

  it("isn't heard by one who turned places off", async () => {
    const { reg, alt, session } = await fullFriday();
    await reg.call("PUT", "/api/me/notifications", { places: false });
    await alt.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    expect(sentTo()).toEqual([]);
  });
});

describe("through Firebase", () => {
  it("sends each phone its notification, and forgets a phone Firebase says is gone", async () => {
    const fcm = await w.firebase();
    fcm.answers.set("token-alt@example.com", "gone");
    await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");

    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(fcm.asked.map((a) => a.token).sort()).toEqual(["token-alt@example.com", "token-reg@example.com"]);
    expect(fcm.asked[0]).toMatchObject({ title: "Pub after", body: "The Fox.", path: "/" });

    fcm.asked.length = 0;
    await dana.call("POST", "/api/announcements", { ...ANNOUNCEMENT, title: "Again" });
    expect(fcm.asked.map((a) => a.token)).toEqual(["token-reg@example.com"]);
  });

  it("a notification that can't be sent never fails the change", async () => {
    w.env.FIREBASE_SERVICE_ACCOUNT = "not json";
    await phone("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    captureLogs();
    const r = await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(r.status).toBe(201);
  });
});

// Workers Free allows 50 subrequests (fetches) an invocation, and FCM takes one request per phone: a club-wide send
// goes out SEND_AT_ONCE at a time, the first right after the change, the rest from the push outbox on the cron.
describe("a club-wide send, within the free plan", () => {
  const club = (size: number) => [
    ...ROSTER,
    ...Array.from({ length: size }, (_, i) => ({
      name: `Member ${i + 1}`,
      position: "F",
      rating: 50,
      email: `m${i + 1}@example.com`,
    })),
  ];
  /** A club of `phones` members, each with the app on a phone; Dana's is one of them. */
  async function clubWithPhones(phones: number) {
    w = testWorld(club(phones - ROSTER.length));
    const fcm = await w.firebase();
    const dana = await phone("dana@example.com");
    await phone("reg@example.com");
    await phone("alt@example.com");
    for (let i = 1; i <= phones - ROSTER.length; i++) await phone(`m${i}@example.com`);
    fcm.invocations.length = 0;
    return { dana, fcm };
  }
  const tokens = (fcm: { asked: { token: string }[] }) => fcm.asked.map((a) => a.token);
  const waiting = () =>
    (w.db.raw.prepare("SELECT count(*) n FROM push_outbox WHERE state IN ('queued', 'claimed')").get() as { n: number })
      .n;

  it("an announcement to 120 phones reaches each exactly once, never more than SEND_AT_ONCE in one invocation", async () => {
    const { dana, fcm } = await clubWithPhones(120);

    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(fcm.asked).toHaveLength(SEND_AT_ONCE);

    // The five-minute cron sends the rest, a (smaller) batch each run
    for (let run = 1; run <= 4; run++) await w.cron(minutes(5 * run));
    expect(fcm.asked).toHaveLength(120);
    expect(new Set(tokens(fcm)).size).toBe(120);
    expect(w.pushes.every((p) => p.title === "Pub after")).toBe(true);
    // Nothing left: the next runs send nothing
    await w.cron(minutes(25));
    await w.cron(minutes(60));
    expect(fcm.asked).toHaveLength(120);
    expect(waiting()).toBe(0);
    // One access token, the live hub and SEND_AT_ONCE sends at most, well under the 50
    expect(Math.max(...fcm.invocations)).toBeLessThanOrEqual(SEND_AT_ONCE + 2);
    expect(SEND_AT_ONCE + 2).toBeLessThan(50);
  });

  it("two drains at once never send a phone twice", async () => {
    const { dana, fcm } = await clubWithPhones(120);
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);

    await Promise.all([w.cron(minutes(5)), w.cron(minutes(5))]);
    expect(fcm.asked).toHaveLength(SEND_AT_ONCE + 2 * DRAIN_AT_ONCE);
    expect(new Set(tokens(fcm)).size).toBe(SEND_AT_ONCE + 2 * DRAIN_AT_ONCE);
  });

  it("a phone Firebase says is gone is forgotten, with what was still waiting for it", async () => {
    const fcm = await w.firebase();
    await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    // Firebase is down for the first announcement: it waits to be tried again
    fcm.down = true;
    await dana.call("POST", "/api/announcements", { ...ANNOUNCEMENT, title: "First" });
    fcm.down = false;
    // Alt's phone is gone by the second
    fcm.answers.set("token-alt@example.com", "gone");
    await dana.call("POST", "/api/announcements", { ...ANNOUNCEMENT, title: "Second" }, { now: minutes(1) });
    fcm.asked.length = 0;

    await w.cron(minutes(10));
    expect(fcm.asked).toEqual([expect.objectContaining({ token: "token-reg@example.com", title: "First" })]);
    expect(w.db.raw.prepare("SELECT count(*) n FROM push_devices WHERE token = 'token-alt@example.com'").get()).toEqual(
      { n: 0 },
    );
    expect(waiting()).toBe(0);
  });

  it("a phone signed out before its turn isn't sent what was waiting", async () => {
    const fcm = await w.firebase();
    const reg = await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    fcm.down = true;
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    fcm.down = false;
    await reg.call("POST", "/api/auth/sign-out");
    fcm.asked.length = 0;

    await w.cron(minutes(10));
    expect(tokens(fcm)).toEqual(["token-alt@example.com"]);
    expect(waiting()).toBe(0);
  });

  it("a send that fails is tried again later, less often each time, then given up and logged", async () => {
    const logs = captureLogs();
    const fcm = await w.firebase();
    fcm.answers.set("token-reg@example.com", "failed");
    await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    const triesAtReg = () => tokens(fcm).filter((t) => t === "token-reg@example.com").length;
    expect(triesAtReg()).toBe(1);

    // Every five minutes for two hours: tried again after 5, 10 and 20 minutes, then given up
    for (let m = 5; m <= 120; m += 5) await w.cron(minutes(m));
    expect(triesAtReg()).toBe(PUSH_TRIES);
    expect(tokens(fcm).filter((t) => t === "token-alt@example.com")).toHaveLength(1);
    expect(waiting()).toBe(0);
    expect(logs.messages()).toContain("push.gave_up");
  });

  it("a send Firebase refuses logs Firebase's reason, so a wrong Apple key shows in the log", async () => {
    const logs = captureLogs();
    const fcm = await w.firebase();
    // What Firebase says when the Apple push key it holds is wrong or missing (an upload in the wrong slot)
    fcm.answers.set("token-reg@example.com", "apns");
    await phone("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);

    const failed = logs.entries.find((e) => e.msg === "push.failed");
    expect(failed?.fields).toMatchObject({ failed: 1, of: 1, reasons: ["THIRD_PARTY_AUTH_ERROR"] });
  });

  it("costs the same round trips to the database for 3 phones as for 120, at once and on the cron", async () => {
    const tripsFor = async (job: () => Promise<unknown>) => {
      const before = w.db.roundTrips;
      await job();
      return w.db.roundTrips - before;
    };
    const small = await clubWithPhones(3);
    const smallSend = await tripsFor(() => small.dana.call("POST", "/api/announcements", ANNOUNCEMENT));
    const big = await clubWithPhones(120);
    const bigSend = await tripsFor(() => big.dana.call("POST", "/api/announcements", ANNOUNCEMENT));
    expect(bigSend).toBe(smallSend);

    // A drain with a batch to send, whatever is left behind it
    const drainWithMore = await tripsFor(() => w.cron(minutes(5)));
    const drainWithLast = await tripsFor(() => w.cron(minutes(10)));
    expect(drainWithMore).toBe(drainWithLast);
    expect(drainWithMore).toBeLessThanOrEqual(2);
  });

  it("costs the same round trips whether nobody or most of the club turned a topic off", async () => {
    const tripsFor = async (job: () => Promise<unknown>) => {
      const before = w.db.roundTrips;
      await job();
      return w.db.roundTrips - before;
    };
    const { dana } = await clubWithPhones(SEND_AT_ONCE);
    const everyone = await tripsFor(() => dana.call("POST", "/api/announcements", ANNOUNCEMENT));
    for (let i = 1; i <= SEND_AT_ONCE - 10; i++)
      await (await w.signedIn(`m${i}@example.com`)).call("PUT", "/api/me/notifications", { announcements: false });
    const before = w.pushes.length;
    const fewer = await tripsFor(() => dana.call("POST", "/api/announcements", { ...ANNOUNCEMENT, title: "Again" }));
    expect(fewer).toBe(everyone);
    expect(w.pushes.length - before).toBe(10);
  });

  it("without Firebase (your machine), every phone's notification is caught at once and nothing is left waiting", async () => {
    w = testWorld(club(117));
    const dana = await phone("dana@example.com");
    await phone("reg@example.com");
    await phone("alt@example.com");
    for (let i = 1; i <= 117; i++) await phone(`m${i}@example.com`);

    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(new Set(sentTo()).size).toBe(120);
    expect(sentTo()).toHaveLength(120);
    expect(waiting()).toBe(0);
  });
});
