// Fridays: a training night and what it costs (ADR 0007, 0030, 0124; #154). An admin sets up a small training of her
// own; members say they're in or out as its sign-up opens; it fills, the waiting list moves up, the keepers keep their
// own place; the register on the night; a member's own answer refused once it's started; the fees charged (on the night
// by the register, the next day by the hourly run); Unpaid fees, a payment, an adjustment, reminders sent by hand; a
// night called off; a Quarterly Member's quarter charged on its first day. Ada runs it; Pia, Wes, Tam and Kit (a
// keeper) play pay as you go; Quin goes Quarterly.
//
// Its dates are the edges (#154: "test edge cases around dates"), each with both clocks moved (journey.ts `at`: the
// browser's, and the server's for that person's requests): a training on Sundays and Tuesdays, 7:30 to 9pm, sign-up
// opening two days before at London midnight. Its first night is Sunday 25 October 2026, the day the clocks go back;
// one is Sunday 28 March 2027, the day they go forward; one is Tuesday 29 February 2028. Charges come from the Worker's
// hourly cron (journey.ts `cron`), run at the moment the story is at.
//
// The story keeps to one clock going forward: every request is at the story's moment or later. The server works out
// what's owed again on each day's first open (bootstrap.routes.ts), so a page opened on an earlier day would take back
// the charges a later one made. Real clocks don't go backwards; a journey mustn't either.
import { expect, test, type Page } from "@playwright/test";
import { asMember, at, checks, cron, does, london, noFailedChecks, signIn, stage, type Person } from "./journey";

/** The training this journey makes: on a database other runs may have used, a name nobody's used yet. */
const TAG = Date.now().toString(36).slice(-4);
const NAME = `Sunday Skate ${TAG}`;
const SHORT = `Skate ${TAG}`;

interface Session {
  id: number;
  seriesId: number;
  heldOn: string;
  cancelledAt: string | null;
  going: number[];
  waitlist: number[];
  noShows: number[];
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

/** The night's card, on the training's page or Home: the date, how soon, its In and Out. */
const card = (page: Page) =>
  page.getByRole("article").filter({ has: page.getByRole("group", { name: "Are you in?" }) });
const answers = (page: Page) => page.getByRole("group", { name: "Are you in?" });
/** Their In, pressed: "In" on the training's page, "I'm in" on Home's card. */
const saidIn = (page: Page) => answers(page).getByRole("button", { name: /^(In|I'm in)$/, pressed: true });

test("Fridays: a training night and what it costs", async ({ browser }) => {
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const pia = await signIn(browser, "Member", "Pia Payer", "pia@example.com");
  const wes = await signIn(browser, "Member, waiting", "Wes Waiting", "wes@example.com");
  const tam = await signIn(browser, "Member, drops out", "Tam Tardy", "tam@example.com");
  const kit = await signIn(browser, "Keeper", "Kit Keeper", "kit@example.com");
  const quin = await signIn(browser, "Quarterly Member", "Quin Quarterly", "quin@example.com");
  const everyone = [ada, pia, wes, tam, kit, quin];

  /** The story's moment: everyone's clocks, and the API's, are put there before each step. */
  let now = london("2026-10-22T12:00");
  const moveTo = async (wall: string, people: Person[] = everyone) => {
    now = london(wall);
    for (const who of people) await at(who, now);
  };
  /** The club as the admin's app reads it, at the story's moment. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const club = async (): Promise<any> => asMember(ada.email, { at: now })("GET", "/api/bootstrap");
  const adaApi = (method: string, where: string, body?: object) =>
    asMember(ada.email, { at: now })(method, where, body);
  const members = (await club()).members as { id: number; name: string }[];
  const idOf = (name: string) => members.find((m) => m.name === name)!.id;
  let seriesId = 0;
  let path = "";
  const sessionOn = async (day: string) =>
    ((await club()).sessions as Session[]).find((x) => x.seriesId === seriesId && x.heldOn === day)!;
  const chargesOf = async (name: string) =>
    ((await club()).charges as Charge[]).filter((c) => c.memberId === idOf(name));
  /** Someone's charge for one of this training's nights, if they have one. */
  const chargeFor = async (name: string, day: string) => {
    const session = await sessionOn(day);
    return (await chargesOf(name)).find((c) => c.kind === "session" && c.refId === session.id);
  };
  /** What someone owes, in pence (every charge less what's paid towards it). */
  const owes = async (name: string) => (await chargesOf(name)).reduce((sum, c) => sum + c.pence - c.paidPence, 0);
  /** Pence as the app shows them: "£8". */
  const pounds = (pence: number) => `£${pence / 100}`;
  /**
   * A member's own In or Out through the API at a moment: only for a refusal or an opening at an exact instant, where
   * the page shows another night (the next one's card) or a disabled button; the status code is what's checked.
   */
  const answerAt = async (email: string, day: string, answer: "in" | "out", wall: string) => {
    const session = await sessionOn(day);
    try {
      await asMember(email, { at: london(wall) })("POST", `/api/sessions/${session.id}/answer`, { answer });
      return 200;
    } catch (e) {
      return Number(/→ (\d{3})/.exec(String(e))?.[1] ?? 0);
    }
  };
  const open = async (who: Person, where = path) => {
    await who.page.goto(where);
    await expect(who.page.getByRole("main").getByRole("heading").first()).toBeVisible();
  };

  await stage(
    "1. An admin sets up a training: Sundays and Tuesdays, two places, a keeper's, sign-up two days before",
    async () => {
      await moveTo("2026-10-22T12:00");
      for (const who of [pia, kit])
        await checks(who, "can't set up a training", async () => {
          await open(who, "/settings/training");
          await expect(who.page.getByRole("button", { name: /^New training/ })).toHaveCount(0);
        });

      await does(ada, `adds ${NAME} in Settings → Training`, async () => {
        await open(ada, "/settings/training");
        await ada.page.getByRole("button", { name: /^New training/ }).click();
        const editor = ada.page.getByRole("dialog", { name: "New training" });
        await editor.getByRole("textbox", { name: "Name", exact: true }).fill(NAME);
        await editor.getByRole("textbox", { name: "Short name" }).fill(SHORT);
        await editor.getByRole("spinbutton", { name: "Skater places" }).fill("2");
        await editor.getByRole("spinbutton", { name: "Goalie places" }).fill("1");
        await editor.getByRole("textbox", { name: "Fee per session (£)" }).fill("8");
        await editor.getByRole("tab", { name: "Schedule" }).click();
        const days = editor.getByRole("group", { name: "Days" });
        // The day it's made is offered first (a Thursday): Sundays and Tuesdays only
        for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
          const button = days.getByRole("button", { name: day });
          const pressed = (await button.getAttribute("aria-pressed")) === "true";
          if (pressed !== (day === "Sun" || day === "Tue")) await button.click();
        }
        await expect(editor.getByText("Every week on Tue and Sun")).toBeVisible();
        await editor.getByRole("button", { name: /^Sign-up opens:/ }).click();
        await ada.page.getByRole("option", { name: "2 days before", exact: true }).click();
        await editor.getByRole("button", { name: /^Where:/ }).click();
        await ada.page.getByRole("option", { name: "Battersea Sports Centre" }).click();
        await editor.getByRole("button", { name: "Add training" }).click();
        const made = async () => ((await club()).series as { name: string }[]).some((s) => s.name === NAME);
        // On a database other runs have used, its nights fall on theirs: keep both (the clash prompt is the calendar's
        // journey's to check)
        const clash = ada.page.getByRole("dialog", { name: "Already on then" });
        await expect.poll(async () => (await clash.isVisible()) || (await made())).toBe(true);
        if (await clash.isVisible()) {
          // All of these: Keep both, when there are several, keeps every row, a tournament's that stays on too (#171);
          // one alone, its own Keep both
          const all = clash.getByRole("group", { name: /^All of these/ });
          if (await all.count()) await all.getByRole("button", { name: "Keep both" }).click();
          else
            for (const keep of await clash.locator('button:not([aria-pressed="true"])', { hasText: "Keep both" }).all())
              await keep.click();
          await expect(clash.getByRole("button", { name: "Save" })).toBeEnabled();
          await clash.getByRole("button", { name: "Save" }).click();
        }
        await expect.poll(made).toBe(true);
        const ours = ((await club()).series as { id: number; slug: string; name: string }[]).find(
          (s) => s.name === NAME,
        )!;
        seriesId = ours.id;
        path = `/training/${ours.slug}`;
      });

      for (const who of everyone)
        await checks(who, `has ${NAME} in the menu, and its page opens on its first night`, async () => {
          await who.page.goto("/");
          await who.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: NAME }).click();
          await expect(who.page.getByRole("heading", { name: NAME, level: 1 })).toBeVisible();
          await expect(who.page.getByText(/Every week on Tue and Sun · 7:30 to 9pm/)).toBeVisible();
          await expect(card(who.page)).toContainText("Sun 25 Oct");
        });
    },
  );

  await stage("2. Sign-up opens at London midnight two days before (BST): Sunday 25 October", async () => {
    await moveTo("2026-10-22T23:59");
    await checks(
      pia,
      "at 23:59 on Thursday: Sun 25 Oct is in 3 days, sign-up opens Friday, In can't be tapped",
      async () => {
        await open(pia);
        await expect(card(pia.page)).toContainText("Sun 25 Oct");
        await expect(card(pia.page)).toContainText("7:30 to 9pm");
        await expect(card(pia.page)).toContainText("In 3 days");
        await expect(answers(pia.page).getByRole("button", { name: "Sign-up opens Fri" })).toBeDisabled();
      },
    );
    await checks(pia, "is refused an In at 23:59 London (the server's own clock)", async () => {
      expect(await answerAt(pia.email, "2026-10-25", "in", "2026-10-22T23:59")).toBe(409);
    });

    await moveTo("2026-10-23T00:00");
    await does(pia, "at midnight London (23:00 UTC), taps In, and is in", async () => {
      await open(pia);
      await answers(pia.page).getByRole("button", { name: "In", exact: true }).click();
      await expect(saidIn(pia.page)).toBeVisible();
    });
  });

  await stage("3. Full: the waiting list, the keeper's own place, and moving up", async () => {
    await moveTo("2026-10-23T15:00");
    await checks(pia, "sees it in 2 days", async () => {
      await open(pia);
      await expect(card(pia.page)).toContainText("In 2 days");
    });
    await does(tam, "taps In: the second and last skater's place", async () => {
      await open(tam);
      await answers(tam.page).getByRole("button", { name: "In", exact: true }).click();
      await expect(tam.page.getByText(/0 spaces left/)).toBeVisible();
    });
    await does(kit, "taps In though the skaters are full: a keeper has a place of her own", async () => {
      await open(kit);
      await answers(kit.page).getByRole("button", { name: "In", exact: true }).click();
      await expect(saidIn(kit.page)).toBeVisible();
      await expect(kit.page.getByRole("region", { name: "Keepers" })).toContainText("Kit Keeper");
    });
    // A second keeper to fill the keepers' place: Gil, through the API (not the step under test)
    await checks(kit, "a second keeper waits: the keepers' limit is theirs", async () => {
      expect(await answerAt("gil@example.com", "2026-10-25", "in", "2026-10-23T15:00")).toBe(200);
      const night = await sessionOn("2026-10-25");
      expect(night.waitlist).toContain(idOf("Gil Pads"));
      expect(night.going).toContain(idOf("Kit Keeper"));
    });

    await moveTo("2026-10-24T10:00");
    await does(wes, "on Home, the night's full: Join waitlist, and he's waiting", async () => {
      await open(wes, "/");
      const region = wes.page.getByRole("region", { name: /^Are you in this/ }).filter({ hasText: NAME });
      await region.getByRole("button", { name: "Join waitlist" }).click();
      await expect.poll(async () => (await sessionOn("2026-10-25")).waitlist).toContain(idOf("Wes Waiting"));
    });
    await checks(wes, "sees himself on the page's Waiting list", async () => {
      await open(wes);
      await wes.page.getByRole("tab", { name: /^Waiting/ }).click();
      await expect(wes.page.getByRole("tabpanel")).toContainText("Wes Waiting");
    });

    await moveTo("2026-10-24T12:00");
    await does(tam, "changes her mind: Out", async () => {
      await open(tam);
      await answers(tam.page).getByRole("button", { name: "Out", exact: true }).click();
      await expect.poll(async () => (await sessionOn("2026-10-25")).going).not.toContain(idOf("Tam Tardy"));
    });
    await checks(wes, "has moved up: he's in", async () => {
      await open(wes);
      await expect(saidIn(wes.page)).toBeVisible();
    });
  });

  await stage("4. The night before and its day, the clocks going back at 2am", async () => {
    await moveTo("2026-10-24T23:30");
    await checks(pia, "at 23:30 BST on Saturday, it's Tomorrow", async () => {
      await open(pia);
      await expect(card(pia.page)).toContainText("Sun 25 Oct");
      await expect(card(pia.page)).toContainText("Tomorrow");
    });
    // Tuesday 27th's sign-up opens at London midnight on Sunday: still BST then, so 23:00 UTC on Saturday. Wes asks
    // through the API either side of it: the page shows Sunday's card, not Tuesday's
    await checks(
      wes,
      "is refused an In for Tue 27 Oct at 23:59 BST, and let in at midnight (BST, before the clocks go back)",
      async () => {
        expect(await answerAt(wes.email, "2026-10-27", "in", "2026-10-24T23:59")).toBe(409);
        expect(await answerAt(wes.email, "2026-10-27", "in", "2026-10-25T00:00")).toBe(200);
      },
    );

    await moveTo("2026-10-25T00:30");
    await checks(pia, "at 00:30 on Sunday (BST still), it's Tonight", async () => {
      await open(pia);
      await expect(card(pia.page)).toContainText("Sun 25 Oct");
      await expect(card(pia.page)).toContainText("Tonight");
    });

    await moveTo("2026-10-25T19:45");
    // Locked once it starts, not only once it's over (ADR 0030, decided with #11; #167)
    await checks(pia, "at 7:45pm, training's started: no In or Out, the night says it's started", async () => {
      await open(pia);
      const night = pia.page.getByRole("article").filter({ hasText: "Sun 25 Oct" });
      await expect(night).toContainText("Started: the register says who's in");
      await expect(answers(pia.page)).toHaveCount(0);
    });
  });

  await stage("5. On the night: the register (a no-show, a walk-in let in), and what it charges", async () => {
    await moveTo("2026-10-25T20:00");
    for (const who of [pia, kit])
      await checks(who, "can't take the register", async () => {
        await open(who);
        await expect(who.page.getByRole("button", { name: `Manage ${SHORT}` })).toHaveCount(0);
      });

    const register = ada.page.getByRole("dialog", { name: "Add player" });
    await does(ada, "opens the register (Manage → Add player) for Sun 25 Oct", async () => {
      await open(ada);
      await ada.page.getByRole("button", { name: `Manage ${SHORT}` }).click();
      await ada.page.getByRole("button", { name: /^Add player/ }).click();
      await expect(register).toContainText("Sun 25 Oct");
    });
    await does(ada, "marks Wes a no-show", async () => {
      await register.getByRole("button", { name: /^WW Wes Waiting/ }).click();
      await expect(register.getByRole("button", { name: /^WW Wes Waiting .*No-show$/ })).toBeVisible();
    });
    await does(ada, "adds Tam, who turned up after all: the night's full, so she waits, then Let in", async () => {
      await register.getByRole("button", { name: /^TT Tam Tardy/ }).click();
      await register.getByRole("button", { name: "Let Tam Tardy in" }).click();
      await expect.poll(async () => (await sessionOn("2026-10-25")).going).toContain(idOf("Tam Tardy"));
      await register.getByRole("button", { name: "Done" }).click();
    });

    await checks(
      ada,
      "the night charges £8 each to Pia and Tam, nothing to Wes (a no-show) or Kit (a keeper)",
      async () => {
        expect((await chargeFor("Pia Payer", "2026-10-25"))?.pence).toBe(800);
        expect((await chargeFor("Tam Tardy", "2026-10-25"))?.pence).toBe(800);
        expect(await chargeFor("Wes Waiting", "2026-10-25")).toBeUndefined();
        expect(await chargeFor("Kit Keeper", "2026-10-25")).toBeUndefined();
      },
    );

    // It starts at 7:30pm GMT (19:30 UTC, the clocks gone back) and ends at 9pm. Bo, who never answered, says Out
    // through the API either side of its start (a request's own clock, not the page's): from then it's the register's
    await checks(
      pia,
      "a member's own answer is taken at 7:29pm and refused from 7:30pm GMT, and after 9pm: the register's now",
      async () => {
        expect(await answerAt("bo@example.com", "2026-10-25", "out", "2026-10-25T19:29")).toBe(200);
        expect(await answerAt("bo@example.com", "2026-10-25", "out", "2026-10-25T19:30")).toBe(409);
        expect(await answerAt("bo@example.com", "2026-10-25", "out", "2026-10-25T21:00")).toBe(409);
      },
    );
    await moveTo("2026-10-25T21:01");
    // The server refuses them (above); the page doesn't offer them, and says it's over
    await checks(pia, "once it's over, isn't offered In or Out for Sunday any more: it says it's over", async () => {
      await open(pia);
      await expect(card(pia.page).filter({ hasText: "Sun 25 Oct" })).toHaveCount(0);
      const night = pia.page.getByRole("article").filter({ hasText: "Sun 25 Oct" });
      if (await night.count()) await expect(night).toContainText("Over: the register says who came");
    });
  });

  await stage("6. The next day: the register, and the hourly run charging Tuesday's sign-ups", async () => {
    await moveTo("2026-10-26T08:00");
    // The register itself, through the API as the admin: the drawer is the next night's by now, so there's no tap
    await checks(ada, "can't change Sunday's register the next morning (#11: not built yet)", async () => {
      const session = await sessionOn("2026-10-25");
      await expect(
        asMember(ada.email, { at: now })("POST", `/api/sessions/${session.id}/register`, {
          memberId: idOf("Wes Waiting"),
          here: false,
        }),
      ).rejects.toThrow(/→ 409/);
    });

    await moveTo("2026-10-26T23:30");
    await cron(now);
    await checks(ada, "Wes isn't charged for Tuesday before its day", async () => {
      expect(await chargeFor("Wes Waiting", "2026-10-27")).toBeUndefined();
    });
    await moveTo("2026-10-27T00:30");
    await cron(now);
    await checks(
      ada,
      "the hourly run on Tuesday charges Wes £8 for it, due that day, nobody touching the register",
      async () => {
        expect(await chargeFor("Wes Waiting", "2026-10-27")).toMatchObject({ pence: 800, dueOn: "2026-10-27" });
      },
    );
  });

  await stage("7. Dues: Unpaid fees, a payment, an adjustment, reminders sent by hand", async () => {
    await moveTo("2026-10-28T12:00");
    await checks(pia, "sees what she owes on Home and on her tab, overdue, Sunday's £8 on it", async () => {
      const owed = pounds(await owes("Pia Payer"));
      await open(pia, "/");
      await expect(pia.page.getByRole("link", { name: `${owed} overdue: your tab` })).toBeVisible();
      await open(pia, "/me/tab");
      await expect(pia.page.getByRole("main")).toContainText(new RegExp(`You owe\\s*${owed}`));
      await expect(pia.page.getByRole("row", { name: new RegExp(`Sun 25 Oct ${NAME} £8`) })).toBeVisible();
    });
    for (const who of [pia, wes])
      await checks(who, "can't see Unpaid fees", async () => {
        await who.page.goto("/settings/overdue");
        await expect(who.page.getByRole("heading", { name: "Unpaid fees" })).toHaveCount(0);
      });

    await checks(ada, "sees Pia, Tam and Wes on Unpaid fees, up to 30 days", async () => {
      await open(ada, "/settings/overdue");
      for (const name of ["Pia Payer", "Tam Tardy", "Wes Waiting"])
        await expect(ada.page.getByRole("button", { name: new RegExp(`^${name} .*Up to 30 days`) })).toBeVisible();
    });

    const sheetOf = (name: string) => ada.page.getByRole("dialog", { name });
    // What she owes in all, so she's paid up (on a database other runs used, it may be more than Sunday's £8)
    await does(ada, "records Pia's payment by transfer of what she owes, paid today (Wed 28 Oct)", async () => {
      const owed = await owes("Pia Payer");
      await open(ada, "/settings/overdue");
      await ada.page.getByRole("button", { name: /^Pia Payer / }).click();
      await sheetOf("Pia Payer").getByRole("button", { name: "Record a payment" }).click();
      const pay = ada.page.getByRole("dialog", { name: "Payment from Pia" });
      await expect(pay.getByRole("button", { name: /^Paid on:/ })).toHaveText("Wed 28 Oct 2026");
      await pay.getByRole("textbox", { name: /^Amount/ }).fill(String(owed / 100));
      await pay.getByRole("button", { name: "Record payment" }).click();
      await expect.poll(() => owes("Pia Payer")).toBe(0);
      await ada.page.keyboard.press("Escape");
    });
    await checks(pia, "is paid up: owes nothing, and Home has no tab to pay", async () => {
      await open(pia, "/me/tab");
      await expect(pia.page.getByRole("main")).toContainText(/All square\s*£0\s*Nothing owed/);
      await open(pia, "/");
      await expect(pia.page.getByRole("link", { name: /overdue: your tab/ })).toHaveCount(0);
    });

    await does(ada, "takes what Tam owes off (she reffed), with why", async () => {
      const owed = await owes("Tam Tardy");
      await open(ada, "/settings/overdue");
      await ada.page.getByRole("button", { name: /^Tam Tardy / }).click();
      await sheetOf("Tam Tardy").getByRole("button", { name: "Adjust" }).click();
      const adjust = ada.page.getByRole("dialog", { name: "Adjust Tam's dues" });
      await adjust.getByRole("button", { name: "Take off what they owe" }).click();
      await adjust.getByRole("textbox", { name: "Amount" }).fill(String(owed / 100));
      await adjust.getByRole("textbox", { name: "Why" }).fill("Reffed the scrimmage");
      await adjust.getByRole("button", { name: "Adjust" }).click();
      await expect.poll(() => owes("Tam Tardy")).toBe(0);
      await ada.page.keyboard.press("Escape");
    });
    await checks(ada, "Unpaid fees has only Wes now", async () => {
      await open(ada, "/settings/overdue");
      await expect(ada.page.getByRole("button", { name: /^Wes Waiting / })).toBeVisible();
      for (const name of ["Pia Payer", "Tam Tardy"])
        await expect(ada.page.getByRole("button", { name: new RegExp(`^${name} `) })).toHaveCount(0);
    });

    const review = ada.page.getByRole("dialog", { name: "Send reminders" });
    // A reminder says where to pay, so the club's bank details come first (unless another run set them)
    const bankSet = async () => Boolean((await club()).settings.bank);
    if (!(await bankSet()))
      await checks(ada, "adds the club's bank details from Send reminders (Add bank details), and saves", async () => {
        await open(ada, "/settings/overdue");
        await ada.page.getByRole("button", { name: "Send reminders" }).click();
        await review.getByRole("button", { name: "Add bank details" }).click();
        const bank = ada.page.getByRole("dialog", { name: "The club's bank details" });
        await bank.getByRole("textbox", { name: "Account name" }).fill("Battersea Cougars");
        await bank.getByRole("textbox", { name: "Sort code" }).fill("12-34-56");
        await bank.getByRole("textbox", { name: "Account number" }).fill("12345678");
        await bank.getByRole("button", { name: "Save" }).click();
        await expect(bank).toHaveCount(0);
        await expect.poll(bankSet).toBe(true);
      });
    // If the sheet couldn't save them, through the API, so the reminders (the step under test next) can go
    if (!(await bankSet()))
      await adaApi("PUT", "/api/settings/bank", {
        name: "Battersea Cougars",
        sortCode: "12-34-56",
        account: "12345678",
      });
    // At most one a week each: on a database an earlier run used, Wes may have had this week's already
    const remindedBefore = ((await club()).reminders as { memberId: number }[]).some(
      (r) => r.memberId === idOf("Wes Waiting"),
    );
    if (!remindedBefore)
      await does(ada, "sends the reminders by hand: one email to go, to Wes", async () => {
        await open(ada, "/settings/overdue");
        await ada.page.getByRole("button", { name: "Send reminders" }).click();
        await expect(review.getByRole("heading", { name: "1 email to go" })).toBeVisible();
        await expect(review.getByRole("button", { name: /^Wes Waiting Not reminded yet/ })).toBeVisible();
        await review.getByRole("button", { name: "Send", exact: true }).click();
        await expect(review).toHaveCount(0);
      });
    // The queue's sent by the five-minute run (dues.remind.send): nothing's emailed from a local server
    await cron(now, "five");
    await checks(ada, "Wes has been reminded, and isn't offered another this week", async () => {
      await open(ada, "/settings/overdue");
      await ada.page.getByRole("button", { name: "Send reminders" }).click();
      await expect(review.getByRole("button", { name: /^Wes Waiting / })).not.toContainText("Not reminded yet");
      await ada.page.keyboard.press("Escape");
    });
  });

  await stage("8. A night called off: whoever's in hears it's off, and nobody's charged", async () => {
    await moveTo("2026-10-30T12:00");
    // Pia and Kit in for Sunday 1 November through the API (open since Friday's midnight): not the step under test
    for (const email of [pia.email, kit.email])
      expect(await answerAt(email, "2026-11-01", "in", "2026-10-30T12:00")).toBe(200);
    for (const who of [pia, kit])
      await checks(who, "can't call a night off", async () => {
        await open(who);
        await expect(who.page.getByRole("button", { name: /^Cancel this night/ })).toHaveCount(0);
      });
    await does(ada, "cancels Sun 1 Nov (Manage → Cancel this night)", async () => {
      await open(ada);
      await expect(card(ada.page)).toContainText("Sun 1 Nov");
      await ada.page.getByRole("button", { name: `Manage ${SHORT}` }).click();
      await ada.page.getByRole("button", { name: /^Cancel this night/ }).click();
      await ada.page
        .getByRole("dialog", { name: /^Cancel / })
        .getByRole("button", { name: "Cancel this night" })
        .click();
      await expect.poll(async () => (await sessionOn("2026-11-01")).cancelledAt).not.toBeNull();
    });
    await checks(pia, "sees Sun 1 Nov Cancelled on its page", async () => {
      await open(pia);
      await expect(pia.page.getByRole("article").filter({ hasText: "Sun 1 Nov" })).toContainText("Cancelled");
    });
    await moveTo("2026-11-02T08:00");
    await cron(now);
    await checks(ada, "nobody's charged for it", async () => {
      expect(await chargeFor("Pia Payer", "2026-11-01")).toBeUndefined();
    });
  });

  await stage("9. Month ends: an unpaid fee ages from up to 30 days to 31 to 60", async () => {
    await moveTo("2026-11-26T12:00", [ada]);
    await checks(ada, "on Thu 26 Nov, Wes's fee of Tue 27 Oct is up to 30 days old", async () => {
      await open(ada, "/settings/overdue");
      await expect(ada.page.getByRole("button", { name: /^Wes Waiting .*Up to 30 days/ })).toBeVisible();
    });
    await moveTo("2026-11-27T12:00", [ada]);
    await checks(ada, "on Fri 27 Nov, it's 31 to 60 days", async () => {
      await open(ada, "/settings/overdue");
      await expect(ada.page.getByRole("button", { name: /^Wes Waiting .*31 to 60 days/ })).toBeVisible();
    });
  });

  await stage("10. Quarterly: next quarter's plan, the quarter charged on its first day, its nights free", async () => {
    await moveTo("2026-12-01T12:00");
    const plan = () =>
      quin.page.getByRole("group", { name: "Next quarter's plan" }).getByRole("button", { name: /^Quarterly/ });
    await does(quin, "chooses Quarterly for next quarter on her tab (Jan–Mar 2027)", async () => {
      await open(quin, "/me/tab");
      await expect(quin.page.getByText("Next quarter · Jan–Mar 2027")).toBeVisible();
      await plan().click();
      await expect(plan()).toHaveAttribute("aria-pressed", "true");
    });

    await moveTo("2026-12-31T23:30");
    await cron(now);
    await checks(quin, "isn't charged for the new quarter at 11:30pm on New Year's Eve", async () => {
      expect((await chargesOf("Quin Quarterly")).filter((c) => c.quarter === "2027-Q1")).toHaveLength(0);
    });
    await moveTo("2027-01-01T00:30");
    await cron(now);
    await checks(quin, "is charged the quarter by the hourly run at 00:30 on 1 January, due that day", async () => {
      const q1 = (await chargesOf("Quin Quarterly")).find((c) => c.quarter === "2027-Q1");
      expect(q1).toMatchObject({ dueOn: "2027-01-01" });
      expect(q1!.pence).toBeGreaterThan(0);
    });

    await moveTo("2027-01-01T10:00");
    await checks(quin, "sees this quarter as Quarterly", async () => {
      await open(quin, "/me/tab");
      await expect(quin.page.getByText(/This quarter · Jan–Mar 2027\s*Quarterly/)).toBeVisible();
    });
    await does(quin, "taps In for Sun 3 Jan (open since midnight)", async () => {
      await open(quin);
      await expect(card(quin.page)).toContainText("Sun 3 Jan");
      await expect(card(quin.page)).toContainText("In 2 days");
      await answers(quin.page).getByRole("button", { name: "In", exact: true }).click();
      await expect(saidIn(quin.page)).toBeVisible();
    });
    // Pia in too, through the API, to be charged beside her: not the step under test
    expect(await answerAt(pia.email, "2027-01-03", "in", "2027-01-01T10:00")).toBe(200);
    await moveTo("2027-01-03T22:00");
    await cron(now);
    await checks(ada, "after the night, Pia's charged £8 and Quin nothing: her quarter pays for it", async () => {
      expect((await chargeFor("Pia Payer", "2027-01-03"))?.pence).toBe(800);
      expect((await chargeFor("Quin Quarterly", "2027-01-03"))?.pence ?? 0).toBe(0);
    });
  });

  await stage("11. The clocks go forward: Sunday 28 March 2027", async () => {
    await moveTo("2027-03-25T23:59");
    await checks(pia, "at 23:59 GMT on Thursday, Sun 28 Mar is in 3 days and not open yet", async () => {
      await open(pia);
      await expect(card(pia.page)).toContainText("Sun 28 Mar");
      await expect(card(pia.page)).toContainText("In 3 days");
      await expect(answers(pia.page).getByRole("button", { name: "Sign-up opens Fri" })).toBeDisabled();
    });
    await moveTo("2027-03-26T00:00");
    await does(pia, "at midnight GMT on Friday, taps In", async () => {
      await open(pia);
      await answers(pia.page).getByRole("button", { name: "In", exact: true }).click();
      await expect(saidIn(pia.page)).toBeVisible();
    });
    await moveTo("2027-03-27T23:30");
    await checks(pia, "at 23:30 GMT on Saturday, it's Tomorrow", async () => {
      await open(pia);
      await expect(card(pia.page)).toContainText("Tomorrow");
    });
    await moveTo("2027-03-28T03:00");
    await checks(
      pia,
      "at 3am BST on Sunday (an hour after the clocks went forward), it's Tonight, 7:30 to 9pm",
      async () => {
        await open(pia);
        await expect(card(pia.page)).toContainText("Sun 28 Mar");
        await expect(card(pia.page)).toContainText("Tonight");
        await expect(card(pia.page)).toContainText("7:30 to 9pm");
      },
    );
    // The night starts at 7:30pm BST: 18:30 UTC. Bo either side of it, through the API, as on 25 October
    await checks(
      pia,
      "a member's own answer is taken at 7:29pm BST and refused from 7:30pm BST (18:30 UTC)",
      async () => {
        expect(await answerAt("bo@example.com", "2027-03-28", "out", "2027-03-28T19:29")).toBe(200);
        expect(await answerAt("bo@example.com", "2027-03-28", "out", "2027-03-28T19:30")).toBe(409);
      },
    );
    await moveTo("2027-03-28T22:00");
    await cron(now);
    await checks(ada, "Pia's charged £8 for it, due Sun 28 Mar", async () => {
      expect(await chargeFor("Pia Payer", "2027-03-28")).toMatchObject({ pence: 800, dueOn: "2027-03-28" });
    });
  });

  await stage("12. A leap day: Tuesday 29 February 2028", async () => {
    // Its sign-up opens at midnight on Sunday 27th; Sunday's night comes first, so the page has that one's card then
    await moveTo("2028-02-26T23:59");
    await checks(pia, "is refused an In for Tue 29 Feb at 23:59 on Saturday 26th, taken at midnight", async () => {
      expect(await answerAt(pia.email, "2028-02-29", "in", "2028-02-26T23:59")).toBe(409);
      expect(await answerAt(pia.email, "2028-02-29", "in", "2028-02-27T00:00")).toBe(200);
    });
    await moveTo("2028-02-28T12:00");
    await checks(pia, "on Mon 28 Feb, the next night is Tue 29 Feb, Tomorrow, and she's in", async () => {
      await open(pia);
      await expect(card(pia.page)).toContainText("Tue 29 Feb");
      await expect(card(pia.page)).toContainText("Tomorrow");
      await expect(saidIn(pia.page)).toBeVisible();
    });
    // Not the hourly run here: at a moment past every session's expiry it forgets them all (retention.forget), and
    // everyone in the story would be signed out. The day's first open of the app charges what's due as well
    await moveTo("2028-02-29T22:00");
    await checks(ada, "Pia's charged £8 for it, due 29 February, on the day's first open", async () => {
      expect(await chargeFor("Pia Payer", "2028-02-29")).toMatchObject({ pence: 800, dueOn: "2028-02-29" });
    });
    await moveTo("2028-03-01T12:00");
    await checks(pia, "sees Tue 29 Feb on her tab, and the next night is Sun 5 Mar", async () => {
      await open(pia, "/me/tab");
      await expect(pia.page.getByRole("row", { name: new RegExp(`Tue 29 Feb ${NAME} £8`) })).toBeVisible();
      await open(pia);
      await expect(card(pia.page)).toContainText("Sun 5 Mar");
    });
  });

  // Last, so the training's nights don't meet the journeys after this one (nor a rerun's) on Home and the calendar
  await stage("13. The admin pauses the training: no more nights, and it's off the menu", async () => {
    await does(ada, `unticks Running in ${NAME}'s settings, and saves`, async () => {
      await open(ada, "/settings/training");
      await ada.page.getByRole("button", { name: new RegExp(NAME) }).click();
      const editor = ada.page.getByRole("dialog", { name: NAME });
      await editor.getByRole("checkbox", { name: "Running" }).uncheck();
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .poll(
          async () =>
            ((await club()).series as { id: number; active: boolean }[]).find((x) => x.id === seriesId)?.active,
        )
        .toBe(false);
    });
    await checks(pia, `has no ${NAME} in the menu, nor on Home`, async () => {
      await open(pia, "/");
      await expect(pia.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: NAME })).toHaveCount(0);
      await expect(pia.page.getByRole("main")).not.toContainText(NAME);
    });
  });

  noFailedChecks();
  for (const who of everyone) await who.context.close();
});
