// Notifications in a browser (ADR 0108, #24): a member on Android's Chrome or Firefox, a desktop, or an iPhone with the
// app on its Home Screen turns them on, and hears what the store app's phone hears, without the store. The browser's
// subscription is a device like a phone (push_devices, platform "web"): the same topics, the same outbox, signing out
// forgets it. Driven through the real handlers in the fake world (ADR 0031), with a fake push service that opens each
// message with the browser's own key and checks our VAPID signature (testing.ts webPush()).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { minutes, testWorld } from "../testing";
import { SEND_AT_ONCE } from "./push";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Alt Player", position: "F", rating: 55, email: "alt@example.com" },
];
// NOW is Tuesday 6 October 2026: the next Friday is the 9th
const NEXT_FRIDAY = "2026-10-09";
const ANNOUNCEMENT = { title: "Pub after", body: "The Fox.", link: "", endsOn: "2026-10-24" };

let w: ReturnType<typeof testWorld>;
let push: ReturnType<typeof w.webPush>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  push = w.webPush();
});
afterEach(() => {
  // Every send carried our signature, for its own push service, and opened with the browser's key
  expect(push.refused).toEqual([]);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const boot = async (b: Browser) => (await b.call("GET", "/api/bootstrap")).body;
const memberId = async (b: Browser, name: string) =>
  (await boot(b)).members.find((m: { name: string }) => m.name === name).id as number;
const friday = async (b: Browser) =>
  (await boot(b)).sessions.find((s: { heldOn: string }) => s.heldOn === NEXT_FRIDAY) as { id: number };
const devices = () => w.db.raw.prepare("SELECT token, platform FROM push_devices ORDER BY token").all();

/** Whose browser each subscription is, to read who heard what. */
const owner = new Map<string, string>();
/** A browser signed in as this member, notifications turned on: its subscription, given to the club. */
async function browser(email: string, service?: Parameters<typeof push.subscription>[0]) {
  const b = await w.signedIn(email);
  const subscription = push.subscription(service);
  owner.set(subscription.endpoint, email);
  expect((await b.call("PUT", "/api/auth/device", { platform: "web", subscription })).status).toBe(200);
  return Object.assign(b, { subscription });
}
/** A phone with the store app, signed in as this member. */
async function phone(email: string) {
  const b = await w.signedIn(email);
  owner.set(`token-${email}`, email);
  expect((await b.call("PUT", "/api/auth/device", { token: `token-${email}`, platform: "android" })).status).toBe(200);
  return b;
}
const heard = () => w.pushes.map((p) => owner.get(p.token)).sort();

describe("a member's browser", () => {
  it("turns notifications on, and hears an announcement: its words, where it goes, sealed for that browser", async () => {
    const reg = await browser("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);

    expect(push.asked).toEqual([
      {
        endpoint: reg.subscription.endpoint,
        title: "Pub after",
        body: "The Fox.",
        path: "/",
        // The same notice again replaces itself on the screen, never shows twice
        tag: "/ Pub after",
      },
    ]);
    expect(w.pushes).toEqual([
      expect.objectContaining({ token: reg.subscription.endpoint, memberId: await memberId(dana, "Reg Player") }),
    ]);
  });

  it("works on every browser's push service: Chrome's, Firefox's, Safari's on an iPhone's Home Screen, Edge's", async () => {
    await browser("reg@example.com", "google");
    await browser("reg@example.com", "mozilla");
    await browser("alt@example.com", "apple");
    await browser("alt@example.com", "windows");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(heard()).toEqual(["alt@example.com", "alt@example.com", "reg@example.com", "reg@example.com"]);
  });

  it("is checked: only a browser's push service, never an address of someone's choosing, and the browser's keys", async () => {
    const reg = await w.signedIn("reg@example.com");
    const { keys } = push.subscription();
    const put = (subscription: unknown) => reg.call("PUT", "/api/auth/device", { platform: "web", subscription });
    for (const endpoint of [
      "https://team.test/api/members",
      "https://169.254.169.254/latest/meta-data/",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/fcm/send/abc",
      "https://fcm.googleapis.com:444/fcm/send/abc",
      "https://user@web.push.apple.com/abc",
      `https://fcm.googleapis.com/${"x".repeat(5000)}`,
      "",
    ]) {
      const r = await put({ endpoint, keys });
      expect(r.status, endpoint).toBe(400);
      expect(r.body.error).toMatch(/push service/);
    }
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect((await put({ endpoint })).status).toBe(400);
    expect((await put({ endpoint, keys: { p256dh: keys.auth, auth: keys.auth } })).status).toBe(400);
    expect((await put({ endpoint, keys: { p256dh: keys.p256dh, auth: "" } })).status).toBe(400);
    expect((await put("subscription")).status).toBe(400);
    expect(devices()).toEqual([]);
    // Not even signed in
    const stranger = w.browser();
    const r = await stranger.call("PUT", "/api/auth/device", { platform: "web", subscription: push.subscription() });
    expect(r.status).toBe(401);
  });

  it("is forgotten when they sign out, so it hears nothing more", async () => {
    const reg = await browser("reg@example.com");
    expect(devices()).toEqual([{ token: reg.subscription.endpoint, platform: "web" }]);
    await reg.call("POST", "/api/auth/sign-out");
    expect(devices()).toEqual([]);

    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(push.asked).toEqual([]);
  });

  it("is forgotten when its switch is turned off on that device, and only by its own sign-in", async () => {
    const reg = await browser("reg@example.com");
    const alt = await w.signedIn("alt@example.com");
    const token = reg.subscription.endpoint;
    expect((await alt.call("DELETE", "/api/auth/device", { token })).status).toBe(200);
    expect(devices()).toHaveLength(1);

    expect((await reg.call("DELETE", "/api/auth/device", { token })).status).toBe(200);
    expect(devices()).toEqual([]);
    expect((await reg.call("DELETE", "/api/auth/device", {})).status).toBe(400);
  });

  it("moves to whoever signs in on it next, keys and all", async () => {
    const reg = await browser("reg@example.com");
    const alt = await w.signedIn("alt@example.com");
    await alt.call("PUT", "/api/auth/device", { platform: "web", subscription: reg.subscription });
    owner.set(reg.subscription.endpoint, "alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(w.pushes).toEqual([expect.objectContaining({ memberId: await memberId(dana, "Alt Player") })]);
  });
});

// The same news as the store app's phone (push.use-cases.test.ts): a browser is just another device
describe("what the club tells a browser, as it tells a phone", () => {
  it("the night's teams are out: each player hears which team, on a browser or a phone", async () => {
    const reg = await browser("reg@example.com");
    const alt = await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    const session = await friday(dana);
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await alt.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    const [regId, altId] = [await memberId(dana, "Reg Player"), await memberId(dana, "Alt Player")];

    await dana.call("POST", `/api/sessions/${session.id}/teams`, {
      teams: [
        { name: "Black", players: [regId] },
        { name: "White", players: [altId] },
      ],
    });

    expect(w.pushes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          token: reg.subscription.endpoint,
          title: "Teams are out",
          body: "Fri 9 Oct: you're on Black.",
          path: "/training/friday",
        }),
        expect.objectContaining({ token: "token-alt@example.com", body: "Fri 9 Oct: you're on White." }),
      ]),
    );
    expect(w.pushes).toHaveLength(2);
  });

  it("a place comes up on a full night: whoever moves up off the waitlist hears they're in", async () => {
    const dana = await w.signedIn("dana@example.com");
    const series = (await boot(dana)).series[0];
    await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 1 });
    const session = await friday(dana);
    const reg = await browser("reg@example.com");
    const alt = await browser("alt@example.com");
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await alt.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    expect(w.pushes).toEqual([]);

    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "out" });
    expect(w.pushes).toEqual([
      expect.objectContaining({ token: alt.subscription.endpoint, title: "You're in", path: "/training/friday" }),
    ]);
  });

  it("a session's off: everyone signed up hears it", async () => {
    const reg = await browser("reg@example.com");
    await browser("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    const session = await friday(dana);
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });

    await dana.call("POST", `/api/sessions/${session.id}/cancelled`, { cancelled: true });
    expect(w.pushes).toEqual([
      expect.objectContaining({
        token: reg.subscription.endpoint,
        title: "Fri 9 Oct is off",
        path: "/training/friday",
      }),
    ]);
  });

  it("an announcement: every browser and every phone hears it", async () => {
    await browser("reg@example.com");
    await phone("alt@example.com");
    const dana = await browser("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(heard()).toEqual(["alt@example.com", "dana@example.com", "reg@example.com"]);
  });

  it("a topic turned off is off in the browser too: teams off, announcements still heard", async () => {
    const reg = await browser("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    const session = await friday(dana);
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await reg.call("PUT", "/api/me/notifications", { teams: false });

    await dana.call("POST", `/api/sessions/${session.id}/teams`, {
      teams: [{ name: "Black", players: [await memberId(dana, "Reg Player")] }],
    });
    expect(w.pushes).toEqual([]);
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(heard()).toEqual(["reg@example.com"]);
  });
});

describe("through the push service", () => {
  const waiting = () =>
    (w.db.raw.prepare("SELECT count(*) n FROM push_outbox WHERE sent_at IS NULL").get() as { n: number }).n;

  it("a browser the push service says is gone (410) is forgotten, with what was still waiting for it", async () => {
    const reg = await browser("reg@example.com");
    const alt = await browser("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    // The push service is down for the first: it waits to be tried again
    push.down = true;
    await dana.call("POST", "/api/announcements", { ...ANNOUNCEMENT, title: "First" });
    push.down = false;
    // Alt unsubscribed (cleared the site's data, say) by the second
    push.answers.set(alt.subscription.endpoint, "gone");
    await dana.call("POST", "/api/announcements", { ...ANNOUNCEMENT, title: "Second" }, { now: minutes(1) });
    expect(devices()).toEqual([{ token: reg.subscription.endpoint, platform: "web" }]);
    push.asked.length = 0;

    await w.cron(minutes(10));
    expect(push.asked).toEqual([expect.objectContaining({ endpoint: reg.subscription.endpoint, title: "First" })]);
    expect(waiting()).toBe(0);
  });

  it("a send the push service turns away is tried again later, and logged with what it said", async () => {
    const logs = captureLogs();
    const reg = await browser("reg@example.com");
    push.answers.set(reg.subscription.endpoint, "failed");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    const failed = logs.entries.find((e) => e.msg === "push.failed");
    expect(failed?.fields).toMatchObject({ failed: 1, of: 1, reasons: ["fcm.googleapis.com 503 busy"] });
    expect(w.pushes).toEqual([]);

    push.answers.delete(reg.subscription.endpoint);
    await w.cron(minutes(5));
    expect(heard()).toEqual(["reg@example.com"]);
    expect(waiting()).toBe(0);
  });

  it("without the VAPID key (your machine), a browser's notification is caught at once, and never fails the change", async () => {
    w.env.VAPID_PRIVATE_KEY = undefined;
    await browser("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/announcements", ANNOUNCEMENT)).status).toBe(201);
    expect(heard()).toEqual(["reg@example.com"]);
    expect(push.asked).toEqual([]);
  });
});

// Workers Free allows 50 subrequests an invocation: a browser's notification is one fetch, like a phone's, so a
// club-wide send of both still goes out SEND_AT_ONCE at a time, the rest from the outbox on the cron
describe("a club-wide send to browsers and phones, within the free plan", () => {
  it("reaches each of 120 devices, half browsers, exactly once, never more than SEND_AT_ONCE + 2 in one invocation", async () => {
    const club = [
      ...ROSTER,
      ...Array.from({ length: 117 }, (_, i) => ({
        name: `Member ${i + 1}`,
        position: "F",
        rating: 50,
        email: `m${i + 1}@example.com`,
      })),
    ];
    w = testWorld(club);
    push = w.webPush();
    const fcm = await w.firebase();
    const emails = club.map((m) => m.email);
    let dana: Browser | null = null;
    for (const [i, email] of emails.entries()) {
      const b = i % 2 ? await browser(email) : await phone(email);
      dana ??= b;
    }
    fcm.invocations.length = 0;

    await dana!.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(push.asked.length + fcm.asked.length).toBe(SEND_AT_ONCE);
    for (let run = 1; run <= 4; run++) await w.cron(minutes(5 * run));

    expect(push.asked).toHaveLength(60);
    expect(fcm.asked).toHaveLength(60);
    expect(new Set(w.pushes.map((p) => p.token)).size).toBe(120);
    expect(w.pushes).toHaveLength(120);
    // One Google access token, the live hub, and SEND_AT_ONCE sends at most: under the 50
    expect(Math.max(...fcm.invocations)).toBeLessThanOrEqual(SEND_AT_ONCE + 2);
  });
});
