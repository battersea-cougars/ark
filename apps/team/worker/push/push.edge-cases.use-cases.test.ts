// Notifications on members' phones (ADR 0108) at their edges: a send of exactly a batch and one more, two phones of
// one member, a member made inactive or signed in on a phone that was signed out, a send that died half way, a night
// cancelled twice, a long or unusual announcement, and what's sent kept only a week. Driven through the real handlers
// and the cron in the fake world (ADR 0031); Firebase faked by testWorld's firebase().
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { minutes, NOW, testWorld } from "../testing";
import { DRAIN_AT_ONCE, SEND_AT_ONCE } from "./push";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Alt Player", position: "F", rating: 55, email: "alt@example.com" },
];
const NEXT_FRIDAY = "2026-10-09";
const ANNOUNCEMENT = { title: "Pub after", body: "The Fox.", link: "", endsOn: "2026-10-24" };
const DAY = 86_400_000;

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
async function phone(email: string, token = `token-${email}`) {
  const b = await w.signedIn(email);
  expect((await b.call("PUT", "/api/auth/device", { token, platform: "android" })).status).toBe(200);
  return b;
}
const waiting = () =>
  (w.db.raw.prepare("SELECT count(*) n FROM push_outbox WHERE state IN ('queued', 'claimed')").get() as { n: number })
    .n;
const rows = () => (w.db.raw.prepare("SELECT count(*) n FROM push_outbox").get() as { n: number }).n;

/** A club of `phones` members with the app (Dana's among them), Firebase on. */
async function clubWithPhones(phones: number) {
  w = testWorld([
    ...ROSTER,
    ...Array.from({ length: phones - ROSTER.length }, (_, i) => ({
      name: `Member ${i + 1}`,
      position: "F",
      rating: 50,
      email: `m${i + 1}@example.com`,
    })),
  ]);
  const fcm = await w.firebase();
  const dana = await phone("dana@example.com");
  await phone("reg@example.com");
  await phone("alt@example.com");
  for (let i = 1; i <= phones - ROSTER.length; i++) await phone(`m${i}@example.com`);
  return { dana, fcm };
}

describe("a club-wide send, at the edge of a batch", () => {
  it(`exactly ${SEND_AT_ONCE} phones all hear it at once, and the cron finds nothing left`, async () => {
    const { dana, fcm } = await clubWithPhones(SEND_AT_ONCE);
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(fcm.asked).toHaveLength(SEND_AT_ONCE);
    expect(waiting()).toBe(0);
    await w.cron(minutes(5));
    expect(fcm.asked).toHaveLength(SEND_AT_ONCE);
  });

  it(`one phone more than a batch waits for the next cron run, which sends it once`, async () => {
    const { dana, fcm } = await clubWithPhones(SEND_AT_ONCE + 1);
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(fcm.asked).toHaveLength(SEND_AT_ONCE);
    expect(waiting()).toBe(1);
    await w.cron(minutes(5));
    await w.cron(minutes(10));
    expect(fcm.asked).toHaveLength(SEND_AT_ONCE + 1);
    expect(new Set(fcm.asked.map((a) => a.token)).size).toBe(SEND_AT_ONCE + 1);
    expect(waiting()).toBe(0);
  });

  it(`a cron run sends exactly ${DRAIN_AT_ONCE}, and the run after it the one left over`, async () => {
    const { dana, fcm } = await clubWithPhones(SEND_AT_ONCE + DRAIN_AT_ONCE + 1);
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    await w.cron(minutes(5));
    expect(fcm.asked).toHaveLength(SEND_AT_ONCE + DRAIN_AT_ONCE);
    expect(waiting()).toBe(1);
    await w.cron(minutes(10));
    expect(fcm.asked).toHaveLength(SEND_AT_ONCE + DRAIN_AT_ONCE + 1);
  });
});

describe("whose phones hear it", () => {
  it("a member signed in on two phones hears it on both, once each", async () => {
    await phone("reg@example.com", "reg-phone");
    await phone("reg@example.com", "reg-tablet");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(w.pushes.map((p) => p.token).sort()).toEqual(["reg-phone", "reg-tablet"]);
  });

  it("the same phone registering again (the app starting up) is still one phone", async () => {
    const reg = await phone("reg@example.com", "reg-phone");
    expect((await reg.call("PUT", "/api/auth/device", { token: "reg-phone", platform: "android" })).status).toBe(200);
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(w.pushes.map((p) => p.token)).toEqual(["reg-phone"]);
  });

  it("a member an admin makes inactive hears nothing more, and nothing that was waiting for them", async () => {
    const fcm = await w.firebase();
    await phone("reg@example.com");
    await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    fcm.down = true;
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    fcm.down = false;
    const reg = (await boot(dana)).members.find((m: { name: string }) => m.name === "Reg Player");
    const made = await dana.call("PUT", `/api/members/${reg.id}`, {
      name: "Reg Player",
      position: "F",
      rating: 60,
      cougar: false,
      status: "inactive",
      roles: ["Member"],
    });
    expect(made.status).toBe(200);
    fcm.asked.length = 0;

    await w.cron(minutes(10));
    expect(fcm.asked.map((a) => a.token)).toEqual(["token-alt@example.com"]);
    await dana.call("POST", "/api/announcements", { ...ANNOUNCEMENT, title: "Again" }, { now: minutes(11) });
    expect(fcm.asked.map((a) => a.token)).toEqual(["token-alt@example.com", "token-alt@example.com"]);
  });

  it("nobody with the app: an announcement still posts, and nothing waits", async () => {
    const dana = await w.signedIn("dana@example.com");
    expect((await dana.call("POST", "/api/announcements", ANNOUNCEMENT)).status).toBe(201);
    expect(w.pushes).toEqual([]);
    expect(rows()).toBe(0);
  });

  it("a phone's registration needs a sign-in", async () => {
    const stranger = w.browser();
    const r = await stranger.call("PUT", "/api/auth/device", { token: "t", platform: "ios" });
    expect(r.status).toBe(401);
    expect(w.db.raw.prepare("SELECT count(*) n FROM push_devices").get()).toEqual({ n: 0 });
  });
});

describe("a send that died half way", () => {
  it("what it took is taken again once more than ten minutes have passed, not before, and sent once", async () => {
    const fcm = await w.firebase();
    await phone("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    fcm.down = true;
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    fcm.down = false;
    fcm.asked.length = 0;
    // A cron run takes it at 5 minutes and dies before it says what became of it (its claim is left behind)
    w.db.raw
      .prepare("UPDATE push_outbox SET state = 'claimed', claim = 'died', claimed_at = ?")
      .run(minutes(5).toISOString());

    await w.cron(minutes(15));
    expect(fcm.asked).toEqual([]);
    await w.cron(minutes(16));
    expect(fcm.asked.map((a) => a.token)).toEqual(["token-reg@example.com"]);
    await w.cron(minutes(25));
    expect(fcm.asked).toHaveLength(1);
  });

  it("a failed send isn't tried again before its wait is up", async () => {
    const fcm = await w.firebase();
    await phone("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    fcm.down = true;
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    fcm.down = false;
    fcm.asked.length = 0;
    await w.cron(minutes(4));
    expect(fcm.asked).toEqual([]);
    await w.cron(minutes(5));
    expect(fcm.asked).toHaveLength(1);
  });
});

describe("what's kept", () => {
  it("a sent notification is kept a week, then pruned by the cron", async () => {
    await phone("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", ANNOUNCEMENT);
    expect(rows()).toBe(1);
    await w.cron(new Date(NOW.getTime() + 7 * DAY - 60_000));
    expect(rows()).toBe(1);
    await w.cron(new Date(NOW.getTime() + 7 * DAY + 60_000));
    expect(rows()).toBe(0);
  });
});

describe("what a night being off tells", () => {
  async function night() {
    const reg = await phone("reg@example.com");
    const alt = await phone("alt@example.com");
    const dana = await w.signedIn("dana@example.com");
    const session = (await boot(dana)).sessions.find((s: { heldOn: string }) => s.heldOn === NEXT_FRIDAY);
    const cancel = (cancelled: boolean) => dana.call("POST", `/api/sessions/${session.id}/cancelled`, { cancelled });
    return { reg, alt, session, cancel };
  }

  it("cancelling a night that's already off doesn't tell everyone again", async () => {
    const { reg, session, cancel } = await night();
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await cancel(true);
    expect(w.pushes).toHaveLength(1);
    await cancel(true);
    expect(w.pushes).toHaveLength(1);
  });

  it("off, back on, and off again: whoever's in hears each time it goes off", async () => {
    const { reg, session, cancel } = await night();
    await reg.call("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
    await cancel(true);
    await cancel(false);
    await cancel(true);
    expect(w.pushes.map((p) => p.title)).toEqual(["Fri 9 Oct is off", "Fri 9 Oct is off"]);
  });
});

describe("an announcement's words on a phone", () => {
  it("keeps accents and emoji as they were typed", async () => {
    await phone("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", { ...ANNOUNCEMENT, title: "Zoë's 🏒 night", body: "Ça va? 🍻" });
    expect(w.pushes[0]).toMatchObject({ title: "Zoë's 🏒 night", body: "Ça va? 🍻" });
  });

  it("a long one is cut to the first 180 characters, the rest on Home", async () => {
    await phone("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", { ...ANNOUNCEMENT, body: "x".repeat(280) });
    expect(w.pushes[0].body).toBe("x".repeat(180));
  });
});

describe("a long announcement with an emoji where it's cut", () => {
  // #134: body.slice(0, 180) halved the emoji, and SQLite stored the half as invalid UTF-8
  it("an emoji where a long announcement is cut arrives whole or not at all, never as ��� (#134)", async () => {
    await phone("reg@example.com");
    const dana = await w.signedIn("dana@example.com");
    await dana.call("POST", "/api/announcements", { ...ANNOUNCEMENT, body: "x".repeat(179) + "🏒 and more" });
    const body = w.pushes[0].body as string;
    expect(body).not.toContain("\uFFFD");
    expect(["x".repeat(179), "x".repeat(179) + "🏒"]).toContain(body);
  });
});
