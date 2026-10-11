// Notifications on a member's phone (ADR 0108): the store app registers the phone after sign-in, and the club tells
// them what's theirs to know: the night's teams are out, a place came up for them, a session's off, an announcement.
// Driven through the real handlers in the fake world (ADR 0031); with no Firebase, each notification is caught in the
// fake world's push outbox, one per phone, the way FCM would deliver it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testWorld } from "../testing";

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

const boot = async (b: Browser) => (await b.call("GET", "/api/bootstrap")).body;
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
        path: "/training/friday",
      }),
    ]);
  });

  it("a place comes up on a full night: whoever moves up off the waitlist hears they're in", async () => {
    const dana = await w.signedIn("dana@example.com");
    const series = (await boot(dana)).series[0];
    await dana.call("PUT", `/api/series/${series.id}`, { ...series, capacity: 1 });
    const session = await friday(dana);
    const reg = await phone("reg@example.com");
    const alt = await phone("alt@example.com");
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await alt.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    expect(sentTo()).toEqual([]);

    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "out" });

    expect(w.pushes).toEqual([
      expect.objectContaining({ token: "token-alt@example.com", title: "You're in", path: "/training/friday" }),
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
      expect.objectContaining({ token: "token-reg@example.com", title: "Fri 9 Oct is off", path: "/training/friday" }),
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

  it("costs the request one round trip to read the phones, however many there are", async () => {
    await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    const before = w.db.roundTrips;
    await dana.call("POST", "/api/announcements", {
      title: "Pub after",
      body: "The Fox.",
      link: "",
      endsOn: "2026-10-24",
    });
    const withPhones = w.db.roundTrips - before;

    w = testWorld(ROSTER);
    const alone = await w.signedIn("dana@example.com");
    const start = w.db.roundTrips;
    await alone.call("POST", "/api/announcements", {
      title: "Pub after",
      body: "The Fox.",
      link: "",
      endsOn: "2026-10-24",
    });
    expect(withPhones).toBe(w.db.roundTrips - start);
  });
});

describe("through Firebase", () => {
  it("sends each phone its notification, and forgets a phone Firebase says is gone", async () => {
    const { privateKey } = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = btoa(
      String.fromCharCode(...new Uint8Array((await crypto.subtle.exportKey("pkcs8", privateKey)) as ArrayBuffer)),
    );
    w.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: "cougars-test",
      client_email: "push@cougars-test.iam.gserviceaccount.com",
      private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`,
    });
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url === "https://oauth2.googleapis.com/token")
          return Response.json({ access_token: "access", expires_in: 3600 });
        const body = JSON.parse(String(init.body));
        sent.push({ url, body });
        if (body.message.token === "token-alt@example.com")
          return Response.json(
            { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } },
            { status: 404 },
          );
        return Response.json({ name: "projects/cougars-test/messages/1" });
      }),
    );
    await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");

    await dana.call("POST", "/api/announcements", {
      title: "Pub after",
      body: "The Fox.",
      link: "",
      endsOn: "2026-10-24",
    });
    expect(sent.map((s) => s.url)).toEqual([
      "https://fcm.googleapis.com/v1/projects/cougars-test/messages:send",
      "https://fcm.googleapis.com/v1/projects/cougars-test/messages:send",
    ]);
    expect(sent[0].body.message).toMatchObject({
      notification: { title: "Pub after", body: "The Fox." },
      data: { path: "/" },
    });

    sent.length = 0;
    await dana.call("POST", "/api/announcements", {
      title: "Again",
      body: "Still the Fox.",
      link: "",
      endsOn: "2026-10-24",
    });
    expect(sent.map((s) => (s.body.message as { token: string }).token)).toEqual(["token-reg@example.com"]);
  });

  it("a notification that can't be sent never fails the change", async () => {
    w.env.FIREBASE_SERVICE_ACCOUNT = "not json";
    await phone("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await dana.call("POST", "/api/announcements", {
      title: "Pub",
      body: "The Fox.",
      link: "",
      endsOn: "2026-10-24",
    });
    expect(r.status).toBe(201);
  });
});
