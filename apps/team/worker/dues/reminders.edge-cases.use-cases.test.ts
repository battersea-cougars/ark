// Dues reminders at the edges (ADR 0007): who never gets one (credit, a member who's left, paid since it was queued),
// what a long list of charges reads like, the exact ages and hours a reminder starts and stops, in GMT and BST, and
// what an admin's send refuses. Driven through the real handlers in the fake world (ADR 0031): mail is caught in its
// outbox, and the cron is called as `scheduled` calls it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { remindDue, sendQueued } from "./reminders";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Alt Player", position: "F", rating: 55, email: "alt@example.com" },
];
const BANK = { name: "Battersea Cougars", sortCode: "12-34-56", account: "12345678" };
const DAY = 86_400_000;

let w: ReturnType<typeof testWorld>;
type Browser = Awaited<ReturnType<typeof w.signedIn>>;
let dana: Browser;
beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
  dana = await w.signedIn("dana@example.com");
  expect((await dana.call("PUT", "/api/settings/bank", BANK)).status).toBe(200);
});

const idOf = async (name: string) =>
  (await dana.call("GET", "/api/bootstrap")).body.members.find((m: { name: string }) => m.name === name).id as number;
/** They owe this, from that day (an adjustment: a charge on their ledger, dated). */
async function owes(name: string, pence: number, on: string, reason = "Kit") {
  const r = await dana.call("POST", `/api/members/${await idOf(name)}/adjustments`, { pence, reason, on });
  expect(r.status).toBe(201);
}
const send = (o: unknown = {}) => dana.call("POST", "/api/dues/reminders", o);
const mailedFor = () => w.mails.map((m) => m.subject.match(/for ([^\]]+)\]/)?.[1] ?? m.to.join(", "));

describe("who never gets one", () => {
  it("a member in credit, owed nothing, is not listed and gets nothing", async () => {
    await owes("Reg Player", -1500, "2026-09-01", "Reffed");
    expect((await dana.call("GET", "/api/dues/reminders")).body.people).toEqual([]);
    expect((await send()).body).toMatchObject({ queued: 0 });
    await remindDue(w.env, NOW);
    expect(w.mails).toEqual([]);
  });

  it("a member who's left the club isn't listed or reminded, though they still owe", async () => {
    await owes("Reg Player", 1200, "2026-09-20");
    w.db.raw.exec("UPDATE members SET status = 'inactive' WHERE name = 'Reg Player'");
    expect((await dana.call("GET", "/api/dues/reminders")).body.people).toEqual([]);
    expect((await send({ memberIds: [await idOf("Reg Player")] })).body).toMatchObject({ queued: 0 });
    await remindDue(w.env, NOW);
    expect(w.mails).toEqual([]);
  });

  it("someone who pays between being queued and the run that sends it gets nothing, and can be reminded later", async () => {
    // More owers than one run sends, so the last waits in the queue for the next run
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `Player ${String(i).padStart(2, "0")} Many`,
      position: "F",
      rating: 50,
      email: `p${i}@example.com`,
    }));
    w = testWorld([...ROSTER, ...many]);
    dana = await w.signedIn("dana@example.com");
    await dana.call("PUT", "/api/settings/bank", BANK);
    w.db.raw.exec(`INSERT INTO charges (member_id, reason, amount_pence, due_on, created_at)
      SELECT id, 'Kit', 1000, '2026-09-01', '2026-09-01' FROM members WHERE email LIKE 'p%@example.com'`);
    await remindDue(w.env, NOW);
    expect(w.mails).toHaveLength(10);
    const waiting = (
      w.db.raw.prepare("SELECT member_id m FROM dues_reminders WHERE status = 'queued'").all() as { m: number }[]
    ).map((r) => r.m);
    expect(waiting).toHaveLength(2);
    for (const m of waiting) await dana.call("POST", `/api/members/${m}/payments`, { via: "transfer", pence: 1000 });
    await sendQueued(w.env, new Date(NOW.getTime() + 5 * 60_000));
    expect(w.mails).toHaveLength(10);
    // Nothing of theirs is left queued or counted as sent: a new charge reminds them as anyone
    expect(w.db.raw.prepare("SELECT COUNT(*) n FROM dues_reminders WHERE member_id IN (?, ?)").get(...waiting)).toEqual(
      {
        n: 0,
      },
    );
  });
});

describe("what it says", () => {
  it("someone part paid is reminded only of what's left", async () => {
    await owes("Reg Player", 1250, "2026-09-20");
    await dana.call("POST", `/api/members/${await idOf("Reg Player")}/payments`, { via: "cash", pence: 1001 });
    await send();
    expect(w.mails[0].subject).toContain("£2.49");
  });

  it("a long list names twenty charges, sums the rest in a line, and the total is all of it", async () => {
    for (let i = 1; i <= 23; i++) await owes("Reg Player", 101, `2026-09-${String(i).padStart(2, "0")}`, `Kit ${i}`);
    await send();
    const [mail] = w.mails;
    expect(mail.subject).toContain("£23.23");
    expect(mail.text).toContain("Kit 20");
    expect(mail.text).not.toContain("Kit 21");
    expect(mail.text).toMatch(/and 3 more\s+£3\.03/);
    expect(mail.text).toMatch(/Total\s+£23\.23/);
  });

  it("a name with accents or emoji, and a reason with them, read as written", async () => {
    w.db.raw.exec("UPDATE members SET name = 'Zoë Ångström 🏒' WHERE name = 'Reg Player'");
    await owes("Zoë Ångström 🏒", 1200, "2026-09-20", "Stick 🏒 tape");
    await send();
    expect(w.mails[0].text).toContain("Hi Zoë,");
    expect(w.mails[0].text).toContain("Stick 🏒 tape");
  });
});

describe("the exact edges of the hourly reminders", () => {
  // NOW is Tuesday 6 October 2026, 12:00 in London (BST)
  const at = (iso: string) => remindDue(w.env, new Date(iso));

  it("thirteen days old is too soon; fourteen days old, it goes", async () => {
    await owes("Reg Player", 1200, "2026-09-23"); // 13 days old today
    await at("2026-10-06T11:00:00Z");
    expect(w.mails).toEqual([]);
    await at("2026-10-07T11:00:00Z");
    expect(mailedFor()).toEqual(["reg@example.com"]);
  });

  it("ninety days old still gets one; ninety-one gets nothing automatic, though an admin can still send", async () => {
    await owes("Reg Player", 1200, "2026-07-08"); // 90 days old today
    await owes("Alt Player", 1200, "2026-07-07"); // 91 days old
    await at(NOW.toISOString());
    expect(mailedFor()).toEqual(["reg@example.com"]);
    // A week on, Reg's is over 90 too: nothing more goes by itself
    await at(new Date(NOW.getTime() + 8 * DAY).toISOString());
    expect(mailedFor()).toEqual(["reg@example.com"]);
    expect((await send({ memberIds: [await idOf("Alt Player")] })).body).toMatchObject({ queued: 1 });
    expect(mailedFor()).toEqual(["reg@example.com", "alt@example.com"]);
  });

  it("in summer (BST) the day's window is 09:00 to 19:00 UTC: 09:59 London no, 10:00 yes, 20:00 no", async () => {
    await owes("Reg Player", 1200, "2026-09-20");
    await at("2026-10-06T08:59:00Z");
    await at("2026-10-06T19:00:00Z"); // 20:00 in London
    expect(w.mails).toEqual([]);
    await at("2026-10-06T18:59:00Z"); // 19:59 in London
    expect(w.mails).toHaveLength(1);
  });

  it("in winter (GMT) the same window is 10:00 to 20:00 UTC, the day after the clocks go back", async () => {
    await owes("Reg Player", 1200, "2026-10-01");
    // 26 October 2026, a Monday after the clocks went back on the 25th: 09:30 UTC is 09:30 in London
    await at("2026-10-26T09:30:00Z");
    expect(w.mails).toEqual([]);
    await at("2026-10-26T10:00:00Z");
    expect(w.mails).toHaveLength(1);
  });
});

describe("what an admin's send refuses", () => {
  it("memberIds must be a list of member ids, at most 500", async () => {
    await owes("Reg Player", 1200, "2026-09-20");
    for (const memberIds of ["1", 1, [0], [-1], [1.5], ["2"], [null], Array.from({ length: 501 }, (_, i) => i + 1)])
      expect((await send({ memberIds })).status, JSON.stringify(memberIds).slice(0, 30)).toBe(400);
    expect((await dana.call("GET", "/api/dues/reminders?member=abc")).status).toBe(400);
    expect(w.mails).toEqual([]);
  });

  it("asking for someone who doesn't exist sends nothing", async () => {
    await owes("Reg Player", 1200, "2026-09-20");
    expect((await send({ memberIds: [9999] })).body).toMatchObject({ queued: 0 });
    expect(w.mails).toEqual([]);
  });

  it("an empty list sends to nobody, not everyone", async () => {
    await owes("Reg Player", 1200, "2026-09-20");
    expect((await send({ memberIds: [] })).body).toMatchObject({ queued: 0 });
    expect(w.mails).toEqual([]);
  });

  it("a reminder sent twice in a row by an admin goes once", async () => {
    await owes("Reg Player", 1200, "2026-09-20");
    expect((await send()).body).toMatchObject({ queued: 1 });
    expect((await send()).body).toMatchObject({ queued: 0, held: 1 });
    expect(w.mails).toHaveLength(1);
  });

  it("someone not signed in can't preview or send", async () => {
    await owes("Reg Player", 1200, "2026-09-20");
    const stranger = w.browser();
    expect((await stranger.call("GET", "/api/dues/reminders")).status).toBe(401);
    expect((await stranger.call("POST", "/api/dues/reminders", {})).status).toBe(401);
    expect(w.mails).toEqual([]);
  });
});
