// Fees: what a Friday costs as its fee changes (ADR 0007; #154). A training's fee runs from its date until the next one
// starts: an admin schedules a new one, changes one back in time, and makes nights free; members come on Fridays and
// see on their tab what each night charged. Ada sets the fees in the training's editor (Settings → Training → the
// training → Fee per session, Fee from); Sam and Dee pay as they go; Bo is a Quarterly Member, whom no night charges.
//
// The fees, as Ada sets them (each night's in brackets):
//
//   £10 from Mon 12 Oct 2026, when it's made              (Fri 16 Oct: £10)
//   £12 from Fri 23 Oct, set ahead on Wed 14 Oct            (Fri 23 Oct: £12, charged at 00:30 BST, 23:30 UTC Thursday)
//   £11 from "today", at 00:30 BST on Sun 25 Oct (the day the clocks go back; still Saturday in UTC)
//   £9 from Fri 30 Oct, set on Mon 2 Nov: back in time     (Fri 30 Oct: £11 → £9, closed and paid: £2 credit)
//   £14 from Fri 6 Nov, set on Mon 9 Nov: back in time     (Fri 6 Nov: £9 → £14, closed and paid: £5 owed)
//   £13 from Sat 14 Nov, the day after a Friday             (Fri 13 Nov: keeps £14)
//   £15 from Thu 19 Nov, £16 from Fri 20 Nov, a day apart   (Fri 20 Nov: £16)
//   £0 from Fri 27 Nov                                      (Fri 27 Nov: free, nothing owed)
//
// A night's own fee, beating the training's on that night only, isn't built (ADR 0007): a known bug, checked once.
//
// Like every journey that moves the clocks, it keeps to one going forward (journey.ts `at`): the server works out
// what's owed again on each day's first open, so an earlier moment would take back what a later one charged.
import { expect, test, type Page } from "@playwright/test";
import {
  asMember,
  at,
  checks,
  cron,
  does,
  knownBug,
  london,
  noFailedChecks,
  signIn,
  stage,
  type Person,
} from "./journey";

/** The training this journey makes: on a database other runs may have used, a name nobody's used yet. */
const TAG = Date.now().toString(36).slice(-4);
const NAME = `Fee Fridays ${TAG}`;
const SHORT = `FeeFri ${TAG}`;

interface Session {
  id: number;
  seriesId: number;
  heldOn: string;
}
interface Charge {
  memberId: number;
  kind: string;
  refId: number | null;
  quarter: string | null;
  pence: number;
  dueOn: string;
  paidPence: number;
}
interface DatedFee {
  pence: number;
  from: string;
}

test("Fees: what a Friday costs as its fee changes", async ({ browser }) => {
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const sam = await signIn(browser, "Member", "Sam Skater", "sam@example.com");
  const dee = await signIn(browser, "Member", "Dee Defence", "dee@example.com");
  const bo = await signIn(browser, "Quarterly Member", "Bo Backhand", "bo@example.com");
  const everyone = [ada, sam, dee, bo];

  /** The story's moment: everyone's clocks, and the API's, are put there before each step. */
  let now = london("2026-10-12T12:00");
  const moveTo = async (wall: string, people: Person[] = everyone) => {
    now = london(wall);
    for (const who of people) await at(who, now);
  };
  /** The club as the admin's app reads it, at the story's moment. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const club = async (): Promise<any> => asMember(ada.email, { at: now })("GET", "/api/bootstrap");
  const members = (await club()).members as { id: number; name: string }[];
  const idOf = (name: string) => members.find((m) => m.name === name)!.id;
  let seriesId = 0;
  let path = "";
  const sessionOn = async (day: string) =>
    ((await club()).sessions as Session[]).find((x) => x.seriesId === seriesId && x.heldOn === day)!;
  const feesNow = async () =>
    ((await club()).series as { id: number; fees: DatedFee[] }[]).find((s) => s.id === seriesId)!.fees;
  const chargesOf = async (name: string) =>
    ((await club()).charges as Charge[]).filter((c) => c.memberId === idOf(name));
  /** Someone's charges for one of this training's nights: one at most, ever. */
  const chargesFor = async (name: string, day: string) => {
    const session = await sessionOn(day);
    return (await chargesOf(name)).filter((c) => c.kind === "session" && c.refId === session.id);
  };
  /** Someone's charge for a night, in pence: undefined if there's none, and never two. */
  const charged = async (name: string, day: string) => {
    const found = await chargesFor(name, day);
    expect(found.length, `${name} has one charge at most for ${day}`).toBeLessThanOrEqual(1);
    return found[0]?.pence;
  };
  /** What someone owes, in pence: every charge less what's paid towards it, less their credit. */
  const owes = async (name: string) => {
    const c = await club();
    const charges = (c.charges as Charge[]).filter((x) => x.memberId === idOf(name));
    const credit = (c.credits as { memberId: number; pence: number }[]).find((x) => x.memberId === idOf(name));
    return charges.reduce((sum, x) => sum + x.pence - x.paidPence, 0) - (credit?.pence ?? 0);
  };
  const creditOf = async (name: string) =>
    ((await club()).credits as { memberId: number; pence: number }[]).find((x) => x.memberId === idOf(name))?.pence ??
    0;
  /** Pence as the app shows them: "£8". */
  const pounds = (pence: number) => `£${pence / 100}`;
  /** Members say they're in for a night through the API: not the step under test (Fridays' journey taps In). */
  const allIn = async (day: string, people: Person[]) => {
    const session = await sessionOn(day);
    for (const who of people)
      await asMember(who.email, { at: now })("POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
  };
  /** A payment by transfer through the API: Fridays' journey records one in Unpaid fees; here it's only the set-up. */
  const pays = async (name: string, pence: number) =>
    asMember(ada.email, { at: now })("POST", `/api/members/${idOf(name)}/payments`, { via: "transfer", pence });
  const open = async (who: Person, where = path) => {
    await who.page.goto(where);
    await expect(who.page.getByRole("main").getByRole("heading").first()).toBeVisible();
  };
  /** A night's row on someone's tab: its day, the training, what it charged. */
  const tabRow = (page: Page, day: string, pence: number) =>
    page.getByRole("row", { name: new RegExp(`^${day} ${NAME} ${pounds(pence).replace(".", "\\.")}\\b`) });

  /** The training's editor, from Settings → Training. */
  const editor = () => ada.page.getByRole("dialog", { name: NAME });
  const openEditor = async () => {
    await open(ada, "/settings/training");
    await ada.page.getByRole("button", { name: new RegExp(NAME) }).click();
    await expect(editor().getByRole("textbox", { name: "Fee per session (£)" })).toBeVisible();
  };
  /** A day in the editor's Fee from (DateField): its month, then the day. */
  const pickFeeFrom = async (day: string) => {
    await editor()
      .getByRole("button", { name: /^Fee from:/ })
      .click();
    const picker = ada.page.getByRole("dialog", { name: "Fee from" });
    const label = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    })
      .format(new Date(`${day}T00:00:00Z`))
      .replace(/,/g, "");
    for (let i = 0; i < 24 && !(await picker.getByRole("button", { name: label, exact: true }).count()); i++) {
      const shown = new Date(`1 ${await picker.locator(".month").innerText()} UTC`);
      await picker
        .getByRole("button", { name: shown < new Date(`${day}T00:00:00Z`) ? "Next month" : "Last month" })
        .click();
    }
    await picker.getByRole("button", { name: label, exact: true }).click();
    await expect(editor().getByRole("button", { name: `Fee from: ${label}` })).toBeVisible();
  };
  /** Ada sets a fee from a day in the editor, and saves: the training's fees are then `expected`. */
  const setFee = async (pounds: string, from: string | null, expected: DatedFee) => {
    await openEditor();
    await editor().getByRole("textbox", { name: "Fee per session (£)" }).fill(pounds);
    if (from) await pickFeeFrom(from);
    await editor().getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await feesNow()).find((f) => f.from === expected.from)?.pence).toBe(expected.pence);
    await ada.page.keyboard.press("Escape");
  };

  await stage("1. An admin sets up a Friday training at £10, and a Quarterly Member", async () => {
    await moveTo("2026-10-12T12:00");
    await does(ada, `adds ${NAME} in Settings → Training: Fridays, £10 a session`, async () => {
      await open(ada, "/settings/training");
      await ada.page.getByRole("button", { name: /^New training/ }).click();
      const make = ada.page.getByRole("dialog", { name: "New training" });
      await make.getByRole("textbox", { name: "Name", exact: true }).fill(NAME);
      await make.getByRole("textbox", { name: "Short name" }).fill(SHORT);
      await make.getByRole("textbox", { name: "Fee per session (£)" }).fill("10");
      await make.getByRole("tab", { name: "Schedule" }).click();
      const days = make.getByRole("group", { name: "Days" });
      // The day it's made is offered first (a Monday): Fridays only
      for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
        const button = days.getByRole("button", { name: day });
        const pressed = (await button.getAttribute("aria-pressed")) === "true";
        if (pressed !== (day === "Fri")) await button.click();
      }
      await expect(make.getByText("Every week on Fri")).toBeVisible();
      await make.getByRole("button", { name: /^Where:/ }).click();
      await ada.page.getByRole("option", { name: "Battersea Sports Centre" }).click();
      await make.getByRole("button", { name: "Add training" }).click();
      const made = async () => ((await club()).series as { name: string }[]).some((s) => s.name === NAME);
      // Its nights fall on Friday Training's (the club's seed): keep both (the clash prompt is the calendar's journey's)
      const clash = ada.page.getByRole("dialog", { name: "Already on then" });
      await expect.poll(async () => (await clash.isVisible()) || (await made())).toBe(true);
      if (await clash.isVisible()) {
        const all = clash.getByRole("group", { name: /^All of these/ });
        if (await all.count()) await all.getByRole("button", { name: "Keep both" }).click();
        else
          for (const keep of await clash.locator('button:not([aria-pressed="true"])', { hasText: "Keep both" }).all())
            await keep.click();
        await clash.getByRole("button", { name: "Save" }).click();
      }
      await expect.poll(made).toBe(true);
      const ours = ((await club()).series as { id: number; slug: string; name: string }[]).find(
        (s) => s.name === NAME,
      )!;
      seriesId = ours.id;
      path = `/training/${ours.slug}`;
      expect(await feesNow()).toEqual([{ pence: 1000, from: "2026-10-12" }]);
    });
    // Bo goes Quarterly from today, through the API: the member sheet isn't the step under test (Fridays' journey
    // chooses a plan on the tab). The quarter (£90, the club's seed) pays for every night in it
    await asMember(ada.email, { at: now })("POST", `/api/members/${idOf("Bo Backhand")}/quarterly`, {
      quarterly: true,
    });
    await allIn("2026-10-16", [sam, bo]);
    await allIn("2026-10-23", [sam, bo]);
  });

  await stage(
    "2. A new fee scheduled to start on a Friday: that Friday's is new, the one before keeps the old",
    async () => {
      await moveTo("2026-10-14T12:00");
      await does(ada, "sets £12 from Fri 23 Oct in the training's editor (Fee from), and saves", async () => {
        await setFee("12", "2026-10-23", { pence: 1200, from: "2026-10-23" });
        expect(await feesNow()).toEqual([
          { pence: 1000, from: "2026-10-12" },
          { pence: 1200, from: "2026-10-23" },
        ]);
      });
      await checks(ada, "sees both fees in the editor, and £10 still the fee now", async () => {
        await openEditor();
        await expect(editor()).toContainText("£10 now.");
        await expect(editor()).toContainText("£12 from 23 Oct 2026 · £10 from 12 Oct 2026");
        await ada.page.keyboard.press("Escape");
      });

      await moveTo("2026-10-16T00:30");
      await cron(now);
      await checks(
        ada,
        "Fri 16 Oct, at 00:30 BST on its day: the hourly run charges Sam the old fee, £10",
        async () => {
          expect(await charged("Sam Skater", "2026-10-16")).toBe(1000);
        },
      );

      // 00:30 BST on Friday is 23:30 UTC on Thursday: the night's day is London's
      await moveTo("2026-10-22T23:30");
      await cron(now);
      await checks(ada, "at 23:30 on Thursday 22nd, the night before, Fri 23 Oct charges nobody yet", async () => {
        expect(await charged("Sam Skater", "2026-10-23")).toBeUndefined();
      });
      await moveTo("2026-10-23T00:30");
      await cron(now);
      await checks(
        ada,
        "at 00:30 BST on Fri 23 Oct (23:30 UTC Thursday), the hourly run charges Sam the new fee, £12",
        async () => {
          expect(await charged("Sam Skater", "2026-10-23")).toBe(1200);
        },
      );
      await moveTo("2026-10-23T19:07");
      await cron(now);
      await checks(ada, "the hourly run on the night leaves it at £12, once", async () => {
        expect(await charged("Sam Skater", "2026-10-23")).toBe(1200);
      });
      await moveTo("2026-10-24T09:07");
      await cron(now);
      await checks(sam, "the next day, sees Fri 16 Oct £10 and Fri 23 Oct £12 on his tab, £22 owed", async () => {
        await open(sam, "/me/tab");
        await expect(tabRow(sam.page, "Fri 16 Oct", 1000)).toBeVisible();
        await expect(tabRow(sam.page, "Fri 23 Oct", 1200)).toBeVisible();
        await expect(sam.page.getByRole("main")).toContainText(/You owe\s*£22/);
      });
      await checks(
        bo,
        "a Quarterly Member, isn't charged for either night, before the change or after it",
        async () => {
          expect(await charged("Bo Backhand", "2026-10-16")).toBeUndefined();
          expect(await charged("Bo Backhand", "2026-10-23")).toBeUndefined();
          expect((await chargesOf("Bo Backhand")).filter((c) => c.quarter === "2026-Q4")).toHaveLength(1);
          await open(bo, "/me/tab");
          await expect(bo.page.getByRole("row", { name: new RegExp(NAME) })).toHaveCount(0);
        },
      );
    },
  );

  await stage("3. The clocks go back: a fee from today, set at 00:30 BST on Sunday, is Sunday's", async () => {
    // 00:30 BST on Sunday 25 October is 23:30 UTC on Saturday: "today" is London's, Sunday
    await moveTo("2026-10-25T00:30");
    await does(ada, "sets £11 from today, the editor's own Fee from: Sun 25 Oct, not Saturday", async () => {
      await openEditor();
      await expect(editor().getByRole("button", { name: /^Fee from:/ })).toHaveText("Sun 25 Oct 2026");
      await ada.page.keyboard.press("Escape");
      await setFee("11", null, { pence: 1100, from: "2026-10-25" });
    });
    await checks(ada, "Fri 23 Oct keeps £12: the new fee is from after it", async () => {
      expect(await charged("Sam Skater", "2026-10-23")).toBe(1200);
      expect((await feesNow()).map((f) => f.from)).not.toContain("2026-10-24");
    });
  });

  await stage("4. A fee changed back in time over a night that's closed and paid: credit, nothing twice", async () => {
    await moveTo("2026-10-28T12:00");
    await allIn("2026-10-30", [sam, bo]);
    await moveTo("2026-10-31T10:07");
    await cron(now);
    await checks(ada, "Fri 30 Oct charged Sam £11, the fee from Sunday", async () => {
      expect(await charged("Sam Skater", "2026-10-30")).toBe(1100);
    });
    // Sam pays everything he owes (£10 + £12 + £11): through the API, set-up only
    await pays("Sam Skater", 3300);
    await checks(sam, "is all square", async () => {
      expect(await owes("Sam Skater")).toBe(0);
    });

    // Monday: Friday's register closed at 6am on Saturday
    await moveTo("2026-11-02T12:00");
    await checks(ada, "the editor tells her a new fee applies to nights already held too", async () => {
      await openEditor();
      await expect(editor()).toContainText("to nights already held too");
      await ada.page.keyboard.press("Escape");
    });
    await does(ada, "sets £9 from Fri 30 Oct, a closed night, and saves", async () => {
      await setFee("9", "2026-10-30", { pence: 900, from: "2026-10-30" });
    });
    await checks(ada, "Fri 30 Oct is recalculated to £9 for Sam: one charge, paid, £2 back as credit", async () => {
      expect(await chargesFor("Sam Skater", "2026-10-30")).toEqual([
        expect.objectContaining({ pence: 900, paidPence: 900 }),
      ]);
      expect(await creditOf("Sam Skater")).toBe(200);
      expect(await charged("Sam Skater", "2026-10-23")).toBe(1200);
      expect(await charged("Sam Skater", "2026-10-16")).toBe(1000);
    });
    await checks(sam, "sees Fri 30 Oct £9 on his tab, All square and £2 in credit", async () => {
      await open(sam, "/me/tab");
      await expect(tabRow(sam.page, "Fri 30 Oct", 900)).toBeVisible();
      await expect(sam.page.getByRole("main")).toContainText(/All square\s*£0/);
      await expect(sam.page.getByRole("main")).toContainText("£2 in credit");
    });
    await checks(ada, "Unpaid fees doesn't have Sam", async () => {
      await open(ada, "/settings/overdue");
      await expect(ada.page.getByRole("button", { name: /^Sam Skater / })).toHaveCount(0);
    });
  });

  await stage("5. A fee raised back in time over a night that's closed and paid: the difference owed", async () => {
    await moveTo("2026-11-04T12:00");
    await allIn("2026-11-06", [dee, bo]);
    await moveTo("2026-11-07T10:07");
    await cron(now);
    await checks(ada, "Fri 6 Nov charged Dee £9", async () => {
      expect(await charged("Dee Defence", "2026-11-06")).toBe(900);
    });
    await pays("Dee Defence", 900);

    await moveTo("2026-11-09T12:00");
    await does(ada, "sets £14 from Fri 6 Nov, a closed night, and saves", async () => {
      await setFee("14", "2026-11-06", { pence: 1400, from: "2026-11-06" });
    });
    await checks(ada, "Fri 6 Nov is £14 for Dee, one charge, £9 of it paid; Sam's Fri 30 Oct stays £9", async () => {
      expect(await chargesFor("Dee Defence", "2026-11-06")).toEqual([
        expect.objectContaining({ pence: 1400, paidPence: 900 }),
      ]);
      expect(await charged("Sam Skater", "2026-10-30")).toBe(900);
      expect(await creditOf("Sam Skater")).toBe(200);
    });
    await checks(dee, "sees Fri 6 Nov £14 on her tab, and owes the £5 difference", async () => {
      await open(dee, "/me/tab");
      await expect(tabRow(dee.page, "Fri 6 Nov", 1400)).toBeVisible();
      await expect(dee.page.getByRole("main")).toContainText(/You owe\s*£5/);
    });
    await checks(ada, "sees Dee on Unpaid fees, £5", async () => {
      await open(ada, "/settings/overdue");
      await expect(ada.page.getByRole("button", { name: /^Dee Defence .*£5\b/ })).toBeVisible();
    });
  });

  await stage("6. A fee from the Saturday after a Friday, and two a day apart (Thursday, then Friday)", async () => {
    await moveTo("2026-11-10T12:00");
    await does(ada, "sets £13 from Sat 14 Nov, then £15 from Thu 19 Nov, then £16 from Fri 20 Nov", async () => {
      await setFee("13", "2026-11-14", { pence: 1300, from: "2026-11-14" });
      await setFee("15", "2026-11-19", { pence: 1500, from: "2026-11-19" });
      await setFee("16", "2026-11-20", { pence: 1600, from: "2026-11-20" });
    });
    await allIn("2026-11-13", [sam, bo]);
    await allIn("2026-11-20", [sam, bo]);

    await moveTo("2026-11-13T00:30");
    await cron(now);
    await checks(ada, "Fri 13 Nov keeps £14: Saturday's fee starts the day after", async () => {
      expect(await charged("Sam Skater", "2026-11-13")).toBe(1400);
    });
    await moveTo("2026-11-20T00:30");
    await cron(now);
    await checks(ada, "Fri 20 Nov is £16, Friday's own fee, not Thursday's £15", async () => {
      expect(await charged("Sam Skater", "2026-11-20")).toBe(1600);
    });
    await moveTo("2026-11-21T09:07");
    await cron(now);
    await checks(
      sam,
      "sees Fri 13 Nov £14 and Fri 20 Nov £16 on his tab; his £2 credit paid towards them",
      async () => {
        await open(sam, "/me/tab");
        await expect(tabRow(sam.page, "Fri 13 Nov", 1400)).toBeVisible();
        await expect(tabRow(sam.page, "Fri 20 Nov", 1600)).toBeVisible();
        await expect(sam.page.getByRole("main")).toContainText(/You owe\s*£28/);
      },
    );
  });

  await stage("7. A night's own fee beats the training's on that night only", async () => {
    await moveTo("2026-11-22T12:00");
    await knownBug(
      ada,
      "finds a fee for Fri 27 Nov alone in its Manage",
      "not built yet: one night's own fee (ADR 0007)",
      async () => {
        await open(ada, `${path}/2026-11-27`);
        await ada.page.getByRole("button", { name: `Manage ${SHORT}` }).click();
        const manage = ada.page.getByRole("dialog", { name: `Manage ${SHORT}` });
        // Not Training settings ("…and fee, for every session"): a fee for this night alone
        await expect(
          manage.getByRole("button", {
            name: /(this night|this session|night's own|session's own).*fee|fee.*(this night|this session)/i,
          }),
        ).toBeVisible({ timeout: 2_000 });
      },
    );
    await ada.page.keyboard.press("Escape");
  });

  await stage("8. A fee of £0 from a Friday: that night's free, and nothing's owed for it", async () => {
    await moveTo("2026-11-23T12:00");
    await does(ada, "sets £0 from Fri 27 Nov, and saves", async () => {
      await setFee("0", "2026-11-27", { pence: 0, from: "2026-11-27" });
    });
    await allIn("2026-11-27", [sam, dee]);
    await moveTo("2026-11-27T00:30");
    await cron(now);
    await moveTo("2026-11-28T09:07");
    await cron(now);
    await checks(ada, "Fri 27 Nov charges nobody, not even £0", async () => {
      expect(await chargesFor("Sam Skater", "2026-11-27")).toEqual([]);
      expect(await chargesFor("Dee Defence", "2026-11-27")).toEqual([]);
    });
    await checks(dee, "has no Fri 27 Nov on her tab, and still owes only Fri 6 Nov's £5", async () => {
      await open(dee, "/me/tab");
      await expect(dee.page.getByRole("row", { name: new RegExp(`^Fri 27 Nov ${NAME}`) })).toHaveCount(0);
      await expect(dee.page.getByRole("main")).toContainText(/You owe\s*£5/);
    });
    await checks(ada, "sees Dee on Unpaid fees still at £5, and Sam at £28", async () => {
      await open(ada, "/settings/overdue");
      await expect(ada.page.getByRole("button", { name: /^Dee Defence .*£5\b/ })).toBeVisible();
      await expect(ada.page.getByRole("button", { name: /^Sam Skater .*£28\b/ })).toBeVisible();
    });
    await checks(
      bo,
      "a Quarterly Member, was charged for none of the nights, whatever the fee: only his quarter",
      async () => {
        expect((await chargesOf("Bo Backhand")).filter((c) => c.kind === "session")).toEqual([]);
      },
    );
  });

  // Last, so the training's nights don't meet the journeys after this one (nor a rerun's) on Home and the calendar,
  // and nobody here owes anything on Unpaid fees or in the reminders when the Fridays journey gets there
  await stage("9. The admin pauses the training; everyone pays up", async () => {
    // Through the API: set-up for the journeys after, not a step under test
    for (const name of ["Sam Skater", "Dee Defence", "Bo Backhand"]) {
      const owed = await owes(name);
      if (owed > 0) await pays(name, owed);
    }
    await does(ada, `unticks Running in ${NAME}'s settings, and saves`, async () => {
      await openEditor();
      await editor().getByRole("checkbox", { name: "Running" }).uncheck();
      await editor().getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .poll(
          async () =>
            ((await club()).series as { id: number; active: boolean }[]).find((x) => x.id === seriesId)?.active,
        )
        .toBe(false);
    });
  });

  noFailedChecks();
  for (const who of everyone) await who.context.close();
});
