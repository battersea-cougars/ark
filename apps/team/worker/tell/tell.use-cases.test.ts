// Telling a member what's theirs to know (tell.ts): the email, then their phone. A member whose email didn't go isn't
// told on their phone either, so they hear it once, when it's tried again; and with Firebase on, the phones wait for
// the next push drain, since the emails took the invocation's requests. Driven through an admin's send of dues
// reminders, the one feature that tells, in the fake world (ADR 0031): Gmail is its outbox, which a test can make refuse one address.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outbox } from "@cougars/shared/email";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { minutes, NOW, testWorld } from "../testing";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Alt Player", position: "F", rating: 55, email: "alt@example.com" },
];
const BANK = { name: "Battersea Cougars", sortCode: "12-34-56", account: "12345678" };

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
let dana: Browser;
beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  dana = await w.signedIn("dana@example.com");
  expect((await dana.call("PUT", "/api/settings/bank", BANK)).status).toBe(200);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const idOf = async (name: string) =>
  (await dana.club()).body.members.find((m: { name: string }) => m.name === name).id as number;
async function owes(name: string, pence: number) {
  const r = await dana.call("POST", `/api/members/${await idOf(name)}/adjustments`, {
    pence,
    reason: "Kit",
    on: "2026-09-20",
  });
  expect(r.status).toBe(201);
}
async function phone(email: string) {
  const b = await w.signedIn(email);
  expect((await b.call("PUT", "/api/auth/device", { token: `phone-${email}`, platform: "ios" })).status).toBe(200);
}
/** Gmail refuses mail for this address (as the fake world's outbox catches it); everyone else's goes. */
function refuse(address: string) {
  const deliver = outbox.capture!;
  outbox.capture = (m) => {
    if (m.subject.includes(address) || m.to.includes(address)) throw new Error("Gmail said no");
    deliver(m);
  };
  return () => void (outbox.capture = deliver);
}
/** Dana sends reminders from Unpaid fees. */
const send = async (now = NOW) =>
  expect((await dana.call("POST", "/api/dues/reminders", {}, { now })).status).toBe(200);
const mailedFor = () => w.mails.map((m) => m.subject.match(/for ([^\]]+)\]/)?.[1] ?? m.to.join(", "));

describe("telling members what they owe", () => {
  it("a member whose email fails isn't told on their phone either; everyone else is, both ways", async () => {
    const logs = captureLogs();
    await owes("Reg Player", 1200);
    await owes("Alt Player", 800);
    await phone("reg@example.com");
    await phone("alt@example.com");
    const accept = refuse("reg@example.com");

    await send();
    expect(mailedFor()).toEqual(["alt@example.com"]);
    expect(w.pushes.map((p) => p.token)).toEqual(["phone-alt@example.com"]);
    expect(logs.messages()).toContain("tell.email_failed");

    // Gmail takes it again: the next send tells Reg, once, both ways, and Alt nothing more
    accept();
    await send(minutes(60));
    expect(mailedFor()).toEqual(["alt@example.com", "reg@example.com"]);
    expect(w.pushes.map((p) => p.token)).toEqual(["phone-alt@example.com", "phone-reg@example.com"]);
  });

  it("everyone's email failing tells nobody, and nothing waits for their phones", async () => {
    captureLogs();
    await owes("Reg Player", 1200);
    await phone("reg@example.com");
    refuse("reg@example.com");
    await send();
    expect(w.pushes).toEqual([]);
    expect(w.db.raw.prepare("SELECT count(*) n FROM push_outbox").get()).toEqual({ n: 0 });
  });

  it("with Firebase on, the email goes now and the phone hears it with the next push drain", async () => {
    const fcm = await w.firebase();
    await owes("Reg Player", 1200);
    await phone("reg@example.com");

    await send();
    expect(mailedFor()).toEqual(["reg@example.com"]);
    expect(fcm.asked).toEqual([]);
    await w.cron(minutes(5));
    expect(fcm.asked).toEqual([expect.objectContaining({ token: "phone-reg@example.com", title: "What you owe" })]);
  });

  it("a member who turned off what they owe on their phone still gets the email", async () => {
    await owes("Reg Player", 1200);
    await phone("reg@example.com");
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("PUT", "/api/me/notifications", { dues: false })).status).toBe(200);

    await send();
    expect(mailedFor()).toEqual(["reg@example.com"]);
    expect(w.pushes).toEqual([]);
  });
});
