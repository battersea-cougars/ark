// Next quarter's plan, a few days before it starts (ADR 0007, #187): everyone who'll be Quarterly next quarter is told
// its fee is due, what it is and when it's charged, and that they can still switch to pay as you go on their Dues page
// until the day before. Five days before by default, a club setting on Settings → Membership; from 10:00 London, by
// the hourly Cron Trigger. A notification for anyone with the app, an email for anyone without; once per member per
// quarter, claimed before it's sent, and on the record. Driven through the real handlers in the fake world (ADR 0031):
// mail in its outbox, phones in the push outbox, the crons run as Cloudflare runs them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { outbox } from "@cougars/shared/email";
import { londonISO } from "@cougars/shared/london";
import { testWorld } from "../testing";
import { clubCharges } from "./dues.testing";
import { PLAN_REMINDERS } from "./plan-reminders";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Quin Quarterly", position: "F", rating: 64, email: "quin@example.com" },
  { name: "Reg Runner", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Pat Payg", position: "D", rating: 55, email: "pat@example.com" },
  { name: "Kit Keeper", position: "G", rating: 70, email: "kit@example.com" },
  { name: "Mo Newbie", position: "D", rating: 50, email: "mo@example.com" },
];

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
let dana: Browser;
beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  dana = await w.signedIn("dana@example.com");
});

/** A London wall-clock moment: "2026-12-27T10:07". */
const at = (wall: string) => new Date(londonISO(...(wall.split("T") as [string, string])));
/** The hourly Cron Trigger at a London moment. */
const hourly = (wall: string) => w.scheduled("7 * * * *", at(wall));

const idOf = async (name: string) =>
  ((await dana.club()).body.members as { id: number; name: string }[]).find((m) => m.name === name)!.id;
/** Quarterly next quarter (2027-Q1, from Fri 1 Jan), as they choose it on their Dues page in October. */
async function choosesQuarterly(email: string, quarterly = true, now = at("2026-10-06T12:00")) {
  const b = await w.signedIn(email);
  expect((await b.call("PUT", "/api/me/plan", { quarter: "2027-Q1", quarterly }, { now })).status).toBe(200);
  return b;
}
/** Their phone with the store app, signed in as them. */
async function hasTheApp(email: string) {
  const b = await w.signedIn(email);
  expect((await b.call("PUT", "/api/auth/device", { token: `${email}-phone`, platform: "ios" })).status).toBe(200);
  return b;
}
/** Who the club's mail was for: the real recipients, as the subject names them outside production. */
const mailedFor = () => w.mails.map((m) => m.subject.match(/for ([^\]]+)\]/)?.[1] ?? m.to.join(", "));
const pushedTo = () => w.pushes.map((p) => p.token);

const TITLE = "Next quarter's fee is due";
const BODY =
  "Your Quarterly membership for 2027-Q1 (£90) is charged on Fri 1 Jan. Want to pay as you go instead? " +
  "Change it on your Dues page by Thu 31 Dec.";

describe("who's told, five days before the quarter", () => {
  it("someone who chose Quarterly for next quarter hears it on their phone, and tapping it opens their plan", async () => {
    await choosesQuarterly("quin@example.com");
    await hasTheApp("quin@example.com");
    await hourly("2026-12-27T10:07");
    expect(w.pushes).toEqual([
      expect.objectContaining({ token: "quin@example.com-phone", title: TITLE, body: BODY, path: "/me/tab?plan=next" }),
    ]);
    // With the app, the notification is enough: no email as well
    expect(w.mails).toEqual([]);
  });

  it("someone without the app gets an email instead, saying the same", async () => {
    await choosesQuarterly("quin@example.com");
    await hourly("2026-12-27T10:07");
    expect(mailedFor()).toEqual(["quin@example.com"]);
    expect(w.mails[0].subject).toContain("Next quarter's fee is due: £90 on Fri 1 Jan");
    expect(w.mails[0].text).toContain("Hi Quin,");
    expect(w.mails[0].text).toContain(BODY);
  });

  it("a Quarterly Member whose subscription runs on into next quarter is told too", async () => {
    await dana.call("POST", `/api/members/${await idOf("Reg Runner")}/quarterly`, { quarterly: true });
    await hourly("2026-12-27T10:07");
    expect(mailedFor()).toEqual(["reg@example.com"]);
  });

  it("nobody paying as they go next quarter is told: not by choice, not by never choosing", async () => {
    // Pat was Quarterly this quarter and chose pay as you go for the next
    await dana.call("POST", `/api/members/${await idOf("Pat Payg")}/quarterly`, { quarterly: true });
    await choosesQuarterly("pat@example.com", false);
    await hourly("2026-12-27T10:07");
    expect(w.mails).toEqual([]);
    expect(w.pushes).toEqual([]);
  });

  it("a keeper isn't told: the Keeper plan is never charged, whatever subscription is on record", async () => {
    // A subscription from before they were a keeper stays, and charges nothing (ADR 0007)
    w.db.raw.exec(`INSERT INTO subscriptions (member_id, starts_on, created_at)
      SELECT id, '2026-07-01', '2026-07-01' FROM members WHERE email = 'kit@example.com'`);
    await hourly("2026-12-27T10:07");
    expect(w.mails).toEqual([]);
  });

  it("a member who joined mid-quarter and went Quarterly then is told for the next", async () => {
    await dana.call(
      "POST",
      `/api/members/${await idOf("Mo Newbie")}/quarterly`,
      { quarterly: true },
      { now: at("2026-11-20T19:30") },
    );
    await hourly("2026-12-27T10:07");
    expect(mailedFor()).toEqual(["mo@example.com"]);
  });

  it("everyone due is told in the one run, by whichever way reaches them", async () => {
    await choosesQuarterly("quin@example.com");
    await hasTheApp("quin@example.com");
    await dana.call("POST", `/api/members/${await idOf("Reg Runner")}/quarterly`, { quarterly: true });
    await hourly("2026-12-27T10:07");
    expect(pushedTo()).toEqual(["quin@example.com-phone"]);
    expect(mailedFor()).toEqual(["reg@example.com"]);
  });
});

describe("the day and the hour, in London", () => {
  beforeEach(async () => {
    await choosesQuarterly("quin@example.com");
  });

  it("not before the day: the day before it, nothing", async () => {
    await hourly("2026-12-26T12:07");
    expect(w.mails).toEqual([]);
  });

  it("not overnight: on the day, from 10:00", async () => {
    await hourly("2026-12-27T07:07");
    await hourly("2026-12-27T09:07");
    expect(w.mails).toEqual([]);
    await hourly("2026-12-27T10:07");
    expect(mailedFor()).toEqual(["quin@example.com"]);
  });

  it("not in the evening: the last run is at 19:07, and a day missed is made up the next morning", async () => {
    await hourly("2026-12-27T20:07");
    await hourly("2026-12-28T08:07");
    expect(w.mails).toEqual([]);
    await hourly("2026-12-28T10:07");
    expect(mailedFor()).toEqual(["quin@example.com"]);
  });

  it("not once the quarter has started: by then it's charged", async () => {
    await hourly("2027-01-01T10:07");
    expect(w.mails).toEqual([]);
  });

  it("the lead time is the club's: Settings → Membership, from one day before to thirty", async () => {
    expect((await dana.club()).body.settings.planReminderDays).toBe(5);
    expect((await dana.call("PUT", "/api/settings/plan-reminder", { days: 10 })).status).toBe(200);
    expect((await dana.club()).body.settings.planReminderDays).toBe(10);
    await hourly("2026-12-21T10:07");
    expect(w.mails).toEqual([]);
    await hourly("2026-12-22T10:07");
    expect(mailedFor()).toEqual(["quin@example.com"]);
    expect(w.mails[0].text).toContain("by Thu 31 Dec");
  });

  it("the lead time is checked, set only by whoever sets fees, and on the record", async () => {
    expect((await dana.call("PUT", "/api/settings/plan-reminder", { days: 0 })).status).toBe(400);
    expect((await dana.call("PUT", "/api/settings/plan-reminder", { days: 31 })).status).toBe(400);
    expect((await dana.call("PUT", "/api/settings/plan-reminder", { days: 2.5 })).status).toBe(400);
    const pat = await w.signedIn("pat@example.com");
    expect((await pat.call("PUT", "/api/settings/plan-reminder", { days: 3 })).status).toBe(403);
    await dana.call("PUT", "/api/settings/plan-reminder", { days: 3 });
    const { entries } = (await dana.call("GET", "/api/audit")).body as {
      entries: { action: string; detail: object }[];
    };
    expect(entries.find((e) => e.action === "settings.plan_reminder")).toMatchObject({
      detail: { from: { days: 5 }, to: { days: 3 } },
    });
  });
});

describe("the clock change", () => {
  it("on the morning the clocks go forward, 10:00 is BST's: the 09:07 UTC run, not the 08:07", async () => {
    // 2027-Q2 starts Thu 1 Apr; four days before is Sun 28 Mar, when the clocks go forward at 01:00 UTC
    await dana.call("PUT", "/api/settings/plan-reminder", { days: 4 });
    await dana.call("POST", `/api/members/${await idOf("Reg Runner")}/quarterly`, { quarterly: true });
    await w.scheduled("7 * * * *", new Date("2027-03-28T08:07:00Z"));
    expect(w.mails).toEqual([]);
    await w.scheduled("7 * * * *", new Date("2027-03-28T09:07:00Z"));
    expect(mailedFor()).toEqual(["reg@example.com"]);
    expect(w.mails[0].text).toContain("for 2027-Q2 (£90) is charged on Thu 1 Apr");
    expect(w.mails[0].text).toContain("by Wed 31 Mar");
  });
});

describe("once per member per quarter", () => {
  beforeEach(async () => {
    await choosesQuarterly("quin@example.com");
    await hasTheApp("quin@example.com");
    await dana.call("POST", `/api/members/${await idOf("Reg Runner")}/quarterly`, { quarterly: true });
  });

  it("the next hours' runs and the next days' tell nobody again", async () => {
    await hourly("2026-12-27T10:07");
    await hourly("2026-12-27T11:07");
    await hourly("2026-12-29T12:07");
    expect(pushedTo()).toEqual(["quin@example.com-phone"]);
    expect(mailedFor()).toEqual(["reg@example.com"]);
  });

  it("two runs at once tell each member once: it's claimed before it's sent", async () => {
    await Promise.all([hourly("2026-12-27T10:07"), hourly("2026-12-27T10:07")]);
    expect(pushedTo()).toEqual(["quin@example.com-phone"]);
    expect(mailedFor()).toEqual(["reg@example.com"]);
  });

  it("an email that fails is let go of: the next hour tries again, and tells them once", async () => {
    // Gmail refuses Reg's mail (as the fake world's outbox catches it); everyone else's goes
    const deliver = outbox.capture!;
    outbox.capture = (m) => {
      if (m.subject.includes("reg@example.com")) throw new Error("Gmail said no");
      deliver(m);
    };
    await hourly("2026-12-27T10:07");
    expect(mailedFor()).toEqual([]);
    outbox.capture = deliver;
    await hourly("2026-12-27T11:07");
    await hourly("2026-12-27T12:07");
    expect(mailedFor()).toEqual(["reg@example.com"]);
  });

  it("next quarter is told again, once", async () => {
    await hourly("2026-12-27T10:07");
    await hourly("2027-03-27T10:07");
    await hourly("2027-03-27T11:07");
    expect(pushedTo()).toEqual(["quin@example.com-phone", "quin@example.com-phone"]);
    expect(w.pushes[1].body).toContain("2027-Q2");
  });

  it("is on the record: who was told, for which quarter, how and when; and on the audit log", async () => {
    await hourly("2026-12-27T10:07");
    const told = w.db.raw
      .prepare(
        `SELECT m.name, r.quarter, r.via, r.told_at toldAt FROM plan_reminders r JOIN members m ON m.id = r.member_id
         ORDER BY m.name`,
      )
      .all();
    expect(told).toEqual([
      { name: "Quin Quarterly", quarter: "2027-Q1", via: "push", toldAt: at("2026-12-27T10:07").toISOString() },
      { name: "Reg Runner", quarter: "2027-Q1", via: "email", toldAt: at("2026-12-27T10:07").toISOString() },
    ]);
    const { entries } = (await dana.call("GET", "/api/audit")).body as {
      entries: { action: string; by: unknown; about: string; detail: object }[];
    };
    expect(entries.filter((e) => e.action === "dues.plan_reminded")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          by: null,
          about: "Quin Quarterly",
          detail: expect.objectContaining({ via: "push" }),
        }),
        expect.objectContaining({ by: null, about: "Reg Runner", detail: expect.objectContaining({ via: "email" }) }),
      ]),
    );
  });
});

describe("a club's worth at once", () => {
  it("emails go ten a run, within a run's requests; the next hours' runs send the rest, and phones all at once", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      name: `Quarterly ${i + 1}`,
      position: "F",
      rating: 50,
      email: `q${i + 1}@example.com`,
    }));
    w = testWorld([...ROSTER, ...many]);
    w.db.raw.exec(`INSERT INTO subscriptions (member_id, starts_on, created_at)
      SELECT id, '2026-10-01', '2026-10-01' FROM members WHERE email LIKE 'q%@example.com' AND email <> 'quin@example.com'`);
    await hasTheApp("quin@example.com");
    await choosesQuarterly("quin@example.com");
    await hourly("2026-12-27T10:07");
    expect([w.mails.length, w.pushes.length]).toEqual([PLAN_REMINDERS.emailsPerRun, 1]);
    await hourly("2026-12-27T11:07");
    await hourly("2026-12-27T12:07");
    await hourly("2026-12-27T13:07");
    expect(new Set(mailedFor()).size).toBe(25);
    expect(w.mails).toHaveLength(25);
  });
});

describe("what it says", () => {
  beforeEach(async () => {
    await choosesQuarterly("quin@example.com");
    await hasTheApp("quin@example.com");
  });

  it("the amount is the quarterly rate in force on the quarter's first day, not today's", async () => {
    await dana.call("POST", "/api/subscription-fees", { pence: 9500, from: "2027-01-01" });
    await hourly("2026-12-27T10:07");
    expect(w.pushes[0].body).toContain("for 2027-Q1 (£95) is charged on Fri 1 Jan");
  });

  it("the change-by day is the day before the quarter starts, the last day the Dues page takes a change", async () => {
    await hourly("2026-12-27T10:07");
    expect(w.pushes[0].body).toContain("by Thu 31 Dec.");
    const quin = await w.signedIn("quin@example.com");
    const plan = (now: string) =>
      quin.call("PUT", "/api/me/plan", { quarter: "2027-Q1", quarterly: false }, { now: at(now) });
    expect((await plan("2026-12-31T23:30")).status).toBe(200);
    expect((await plan("2027-01-01T00:30")).status).toBe(409);
  });

  it("with no quarterly rate in force on the day, nobody's charged, so nobody's told", async () => {
    w.db.raw.exec("DELETE FROM subscription_fees");
    await hourly("2026-12-27T10:07");
    expect(w.pushes).toEqual([]);
  });

  it("a member who turned Dues notifications off isn't sent it", async () => {
    const quin = await w.signedIn("quin@example.com");
    expect((await quin.call("PUT", "/api/me/notifications", { dues: false })).status).toBe(200);
    await hourly("2026-12-27T10:07");
    expect(w.pushes).toEqual([]);
    expect(w.mails).toEqual([]);
  });
});

describe("switching after the reminder", () => {
  it("a member who switches to pay as you go after it isn't charged for the quarter", async () => {
    const quin = await choosesQuarterly("quin@example.com");
    await hasTheApp("quin@example.com");
    await hourly("2026-12-27T10:07");
    expect(w.pushes).toHaveLength(1);
    const r = await quin.call(
      "PUT",
      "/api/me/plan",
      { quarter: "2027-Q1", quarterly: false },
      { now: at("2026-12-29T18:00") },
    );
    expect(r.status).toBe(200);
    await hourly("2027-01-01T10:07");
    const quarters = (await clubCharges(dana, at("2027-01-01T12:00"))).filter((c) => c.kind === "quarter");
    expect(quarters).toEqual([]);
  });

  it("one who stays Quarterly is charged the amount it said, on the day it said", async () => {
    await choosesQuarterly("quin@example.com");
    await hourly("2026-12-27T10:07");
    await hourly("2027-01-01T00:07");
    const quarters = (await clubCharges(dana, at("2027-01-01T12:00"))).filter((c) => c.kind === "quarter");
    expect(quarters).toEqual([expect.objectContaining({ quarter: "2027-Q1", pence: 9000, dueOn: "2027-01-01" })]);
  });
});
