// Dues reminders (ADR 0007): whoever records payments emails members what they owe, from Unpaid fees, after seeing
// who gets one and what it says, never more than one a week each. Nothing reminds anyone on its own: the hourly Cron
// Trigger sends none (a configurable schedule is #143); the five-minute one only sends what an admin's send left
// queued. Each goes through the one "tell a member" seam: an email, and a notification on their phone if they have the
// store app (ADR 0108). Driven through the real handlers in the fake world (ADR 0031): mail is caught in its outbox,
// phones in its push outbox, and the crons are run as Cloudflare runs them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { REMINDERS } from "./reminders";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Alt Player", position: "F", rating: 55, email: "alt@example.com" },
  { name: "Mo Newbie", position: "D", rating: 50, email: "mo@example.com" },
];
const BANK = { name: "Battersea Cougars", sortCode: "12-34-56", account: "12345678" };
// NOW is Tuesday 6 October 2026, 12:00 in London
const DAY = 86_400_000;
const later = (days: number, hours = 0) => new Date(NOW.getTime() + days * DAY + hours * 3_600_000);

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
let dana: Browser;
beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  dana = await w.signedIn("dana@example.com");
});

const boot = async (b: Browser, now = NOW) => (await b.call("GET", "/api/bootstrap", undefined, { now })).body;
const idOf = async (name: string) =>
  (await boot(dana)).members.find((m: { name: string }) => m.name === name).id as number;
/** They owe this, from that day (an adjustment: a charge on their ledger, dated). */
async function owes(name: string, pence: number, on: string, reason = "Kit") {
  const r = await dana.call("POST", `/api/members/${await idOf(name)}/adjustments`, { pence, reason, on });
  expect(r.status).toBe(201);
}
const bank = () => dana.call("PUT", "/api/settings/bank", BANK);
const preview = (b = dana, query = "", now = NOW) => b.call("GET", `/api/dues/reminders${query}`, undefined, { now });
const send = (memberIds?: number[], b = dana, now = NOW) =>
  b.call("POST", "/api/dues/reminders", memberIds ? { memberIds } : {}, { now });
/** Who the club's mail was for: the real recipients, as the subject names them outside production. */
const mailedFor = () => w.mails.map((m) => m.subject.match(/for ([^\]]+)\]/)?.[1] ?? m.to.join(", "));

describe("the club's bank details", () => {
  it("whoever sets fees fills them in, and every member sees them on their Dues page", async () => {
    expect((await boot(dana)).settings.bank).toBeNull();
    expect((await bank()).status).toBe(200);
    const reg = await w.signedIn("reg@example.com");
    expect((await boot(reg)).settings.bank).toEqual(BANK);
  });

  it("are checked: a sort code is six digits and an account eight", async () => {
    expect((await dana.call("PUT", "/api/settings/bank", { ...BANK, sortCode: "12-34" })).status).toBe(400);
    expect((await dana.call("PUT", "/api/settings/bank", { ...BANK, account: "1234" })).status).toBe(400);
    expect((await dana.call("PUT", "/api/settings/bank", { ...BANK, name: "" })).status).toBe(400);
    expect((await dana.call("PUT", "/api/settings/bank", { ...BANK, sortCode: "123456" })).status).toBe(200);
    expect((await boot(dana)).settings.bank.sortCode).toBe("12-34-56");
  });

  it("a member can't change them", async () => {
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("PUT", "/api/settings/bank", BANK)).status).toBe(403);
  });
});

describe("an admin emails members what they owe", () => {
  it("sees who'll get one and what it says before sending: everyone who owes, with what and how long", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-08-20", "Friday Training");
    await owes("Reg Player", 600, "2026-10-02", "Kit");
    await owes("Mo Newbie", 1200, "2026-10-02");
    const res = await preview();
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.people).toEqual([
      expect.objectContaining({ name: "Reg Player", pence: 1800, stage: 1, charges: 2, email: true, held: false }),
      expect.objectContaining({ name: "Mo Newbie", pence: 1200, stage: 0, charges: 1, email: true, held: false }),
    ]);
    // Nothing goes until they say so
    expect(w.mails).toEqual([]);
    // What Reg's says: each charge, the total, his reference and the bank details, in plain text
    const reg = await idOf("Reg Player");
    const letter = (await preview(dana, `?member=${reg}`)).body.letter;
    expect(letter.subject).toBe("What you owe the Cougars: £18.00");
    expect(letter.text).toContain("Hi Reg,");
    expect(letter.text).toMatch(/Thu 20 Aug\s+Friday Training\s+£12\.00/);
    expect(letter.text).toMatch(/Fri 2 Oct\s+Kit\s+£6\.00/);
    expect(letter.text).toMatch(/Total\s+£18\.00/);
    expect(letter.text).toContain("Sort code  12-34-56");
    expect(letter.text).toContain("Account    12345678");
    expect(letter.text).toMatch(/Reference\s+COUGARS REG P/);
  });

  it("sends them: each one who owes gets their own, and a member who owes nothing gets nothing", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-09-20");
    await owes("Mo Newbie", 800, "2026-10-02");
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ queued: 2, held: 0, noEmail: 0 });
    expect(mailedFor().sort()).toEqual(["mo@example.com", "reg@example.com"]);
    expect(w.mails.find((m) => m.subject.includes("reg@"))!.text).toContain("£12.00");
    expect(w.mails.find((m) => m.subject.includes("mo@"))!.text).toContain("£8.00");
    // And it's on the record, and Unpaid fees says when they were last reminded
    const audit = w.db.raw.prepare("SELECT action FROM audit_log WHERE action = 'dues.reminded'").all();
    expect(audit).toHaveLength(1);
    const reminded = (await boot(dana)).reminders as { memberId: number; at: string }[];
    expect(reminded.map((r) => r.memberId).sort()).toEqual([await idOf("Reg Player"), await idOf("Mo Newbie")].sort());
  });

  it("sends to one member, from their card", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-09-20");
    await owes("Mo Newbie", 800, "2026-10-02");
    expect((await send([await idOf("Mo Newbie")])).body).toMatchObject({ queued: 1 });
    expect(mailedFor()).toEqual(["mo@example.com"]);
  });

  it("someone with no email address is listed, and their email can be read, but nothing goes", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-09-20");
    w.db.raw.exec("UPDATE members SET email = NULL WHERE name = 'Reg Player'");
    const p = (await preview()).body;
    expect(p.people).toEqual([expect.objectContaining({ name: "Reg Player", email: false })]);
    expect(p.letter.text).toContain("Hi Reg,");
    expect((await send()).body).toMatchObject({ queued: 0, noEmail: 1 });
    expect(w.mails).toEqual([]);
  });

  it("someone who owes nothing gets nothing, even when asked for by name", async () => {
    await bank();
    expect((await send([await idOf("Alt Player")])).body).toMatchObject({ queued: 0 });
    expect(w.mails).toEqual([]);
  });

  it("a member with the store app hears it on their phone too", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-09-20");
    const regPhone = await w.signedIn("reg@example.com");
    expect((await regPhone.call("PUT", "/api/auth/device", { token: "reg-phone", platform: "ios" })).status).toBe(200);
    await send();
    expect(w.pushes).toEqual([expect.objectContaining({ token: "reg-phone", title: "What you owe", path: "/me/tab" })]);
    expect(w.pushes[0].body).toContain("£12.00");
  });

  it("needs the bank details first: the preview says so, and nothing is sent", async () => {
    await owes("Reg Player", 1200, "2026-09-20");
    expect((await preview()).body.ready).toBe(false);
    expect((await send()).status).toBe(409);
    expect(w.mails).toEqual([]);
  });

  it("someone who can only see Unpaid fees, or any member, can't send", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-09-20");
    w.db.raw.exec(`INSERT INTO roles (id, name, description, is_system) VALUES (9, 'Viewer', 'Sees dues', 0);
      INSERT INTO role_actions (role_id, action) VALUES (9, 'read:Dues');
      INSERT INTO member_roles (member_id, role_id) SELECT id, 9 FROM members WHERE email = 'alt@example.com';`);
    const alt = await w.signedIn("alt@example.com");
    expect((await preview(alt)).status).toBe(403);
    expect((await send(undefined, alt)).status).toBe(403);
    const reg = await w.signedIn("reg@example.com");
    expect((await send(undefined, reg)).status).toBe(403);
    expect(w.mails).toEqual([]);
  });
});

describe("at most one reminder a week", () => {
  it("a second send within the week holds back whoever already had one; a week on, it goes", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-09-20");
    await send();
    expect(w.mails).toHaveLength(1);
    const again = await send(undefined, dana, later(3));
    expect(again.body).toMatchObject({ queued: 0, held: 1 });
    expect((await preview(dana, "", later(3))).body.people[0]).toMatchObject({ held: true });
    expect(w.mails).toHaveLength(1);
    expect((await send(undefined, dana, later(7, 1))).body).toMatchObject({ queued: 1 });
    expect(w.mails).toHaveLength(2);
  });

  it("a double tap, or two admins at once, sends one", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-09-20");
    const ed = await w.signedIn("dana@example.com");
    const [one, two] = await Promise.all([send(), send(undefined, ed)]);
    expect(one.body.queued + two.body.queued).toBe(1);
    expect(one.body.held + two.body.held).toBe(1);
    expect(mailedFor()).toEqual(["reg@example.com"]);
  });
});

describe("nothing goes on its own", () => {
  it("the hourly cron reminds nobody, however old what they owe gets", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-09-22"); // 14 days old today
    await owes("Alt Player", 1200, "2026-08-01"); // over 60
    await owes("Mo Newbie", 1200, "2026-06-01"); // over 90
    for (let d = 0; d <= 100; d += 1) {
      await w.scheduled("7 * * * *", later(d));
      await w.scheduled("*/5 * * * *", later(d, 0.1));
    }
    expect(w.mails).toEqual([]);
    expect(w.db.raw.prepare("SELECT COUNT(*) n FROM dues_reminders").get()).toEqual({ n: 0 });
  });

  it("how firm the letter is still follows how long it's been: the admin's send reads the age", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-09-20"); // up to 30 days
    await owes("Mo Newbie", 1200, "2026-06-01"); // over 90
    await send();
    expect(w.mails.find((m) => m.subject.includes("reg@"))!.text).toContain("A friendly nudge");
    expect(w.mails.find((m) => m.subject.includes("mo@"))!.text).toContain("A firm reminder");
  });

  it(`a few at a time: the send takes ${REMINDERS.perRun}, the five-minute runs send the rest`, async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `Player ${String(i).padStart(2, "0")} Many`,
      position: "F",
      rating: 50,
      email: `p${i}@example.com`,
    }));
    w = testWorld([...ROSTER, ...many]);
    dana = await w.signedIn("dana@example.com");
    await bank();
    w.db.raw.exec(`INSERT INTO charges (member_id, reason, amount_pence, due_on, created_at)
      SELECT id, 'Kit', 1000, '2026-09-01', '2026-09-01' FROM members WHERE email LIKE 'p%@example.com'`);
    expect((await send()).body).toMatchObject({ queued: 40 });
    expect(w.mails).toHaveLength(REMINDERS.perRun);
    await w.scheduled("*/5 * * * *", later(0, 0.1));
    expect(w.mails).toHaveLength(REMINDERS.perRun * 2);
    await w.scheduled("*/5 * * * *", later(0, 0.2));
    await w.scheduled("*/5 * * * *", later(0, 0.3));
    expect(w.mails).toHaveLength(40);
    expect(new Set(mailedFor()).size).toBe(40);
  });
});

describe("when the email can't go", () => {
  it("a failed send doesn't count: the admin can send it again", async () => {
    await bank();
    await owes("Reg Player", 1200, "2026-09-20");
    // Gmail is set up but down
    Object.assign(w.env, { GMAIL_CLIENT_ID: "id", GMAIL_CLIENT_SECRET: "secret", GMAIL_REFRESH_TOKEN: "token" });
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    expect((await send()).body).toMatchObject({ queued: 1 });
    vi.unstubAllGlobals();
    expect(w.mails).toEqual([]);
    expect(w.db.raw.prepare("SELECT COUNT(*) n FROM dues_reminders").get()).toEqual({ n: 0 });
    // Back to logging mail (no Gmail): sent again an hour on, it goes
    Object.assign(w.env, {
      GMAIL_CLIENT_ID: undefined,
      GMAIL_CLIENT_SECRET: undefined,
      GMAIL_REFRESH_TOKEN: undefined,
    });
    expect((await send(undefined, dana, later(0, 1))).body).toMatchObject({ queued: 1 });
    expect(mailedFor()).toEqual(["reg@example.com"]);
  });
});

describe("outside production", () => {
  it("a member's reminder goes only to the safe address, naming them", async () => {
    w.env.SITE_ENV = "dev";
    w.env.MAIL_SAFE_TO = "safe@example.com";
    await bank();
    await owes("Reg Player", 1200, "2026-09-20");
    await send();
    expect(w.mails).toHaveLength(1);
    expect(w.mails[0].to).toEqual(["safe@example.com"]);
    expect(w.mails[0].subject).toBe("[dev, for reg@example.com] What you owe the Cougars: £12.00");
  });
});
