// The calendar, the news and Home (ADR 0030, 0122, 0031; #154): an admin puts a one-off on the calendar and members
// say in or out; one over Friday Training asks first (the clash prompt), and closing it saves nothing; one called off is
// off for everyone. The locker room: a post on everyone's Home till its last day, London's midnight. A member's
// notification switches stay as they set them. Home says how soon each thing is (Today, Tonight, Tomorrow, In N days)
// by London's calendar. Settings' venues and quips each do their one job, and the audit log has what was done.
//
// Ada, an admin, runs it; Ivy and Hal are members who answer; Nell, a member, only looks. Everyone is put at a moment
// in November 2026 (`at`: the browser's clock and the server's, both), so the days are the same whenever it runs. It
// runs first, on a fresh database, and again on one it ran on before: what it adds has this run's own name.
import { expect, test, type Page } from "@playwright/test";
import { asMember, clubVia, at, checks, does, london, noFailedChecks, signIn, stage } from "./journey";

/** This run's mark on what it adds, so a database it ran on before doesn't confuse it. */
const run = Date.now().toString(36).slice(-4);
const KIT_DAY = `Kit day ${run}`;
const QUIZ = `Quiz night ${run}`;
const SKATE = `Skate-off ${run}`;
const PUB = `Pub ${run}`;
const POST = `Ice time ${run}`;
const VENUE = `Rink ${run}`;
const QUIP = `Laces tight ${run}?`;

/** The journey's Monday: Friday Training is on Fri 20 Nov, nothing else that week but what it adds. */
const MONDAY = london("2026-11-16T12:00");

type Event = {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  going: number[];
  out: number[];
};

test("The calendar, the news and Home", async ({ browser }) => {
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const ivy = await signIn(browser, "Member", "Ivy Invite", "ivy@example.com");
  const hal = await signIn(browser, "Member", "Hal Holiday", "hal@example.com");
  const nell = await signIn(browser, "Member, only looking", "Nell Nonplayer", "nell@example.com");
  const everyone = [ada, ivy, hal, nell];
  for (const who of everyone) await at(who, MONDAY);

  // The club's one-offs as the API has them, as the admin (on the journey's Monday)
  const adaApi = asMember(ada.email, { at: MONDAY });
  const events = async () => (await adaApi("GET", "/api/bootstrap")).clubEvents as Event[];
  const event = async (title: string) => (await events()).find((e) => e.title === title);
  const members = (await clubVia(adaApi)).members as { id: number; name: string }[];
  const memberId = (name: string) => members.find((m) => m.name === name)!.id;

  /** A card on the page by its heading: an event on the Calendar, or Home's. */
  const card = (page: Page, title: string) =>
    page.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

  /** The question before a save over something already on (lib/ClashSheet.svelte, ADR 0122). */
  const clash = ada.page.getByRole("dialog", { name: "Already on then" });
  /**
   * Answers it: Friday Training kept, and a one-off an earlier run of this journey left there (not this run's) called
   * off, so a database it ran on before asks the same as a fresh one would. Then saves.
   */
  const answerClash = async () => {
    for (const row of await clash.getByRole("group").all()) {
      const name = (await row.getAttribute("aria-label")) ?? "";
      const leftOver = !name.startsWith("Friday Training") && !name.includes(run);
      await row.getByRole("button", { name: leftOver ? "Cancel it" : "Keep both" }).click();
    }
    await clash.getByRole("button", { name: /^Save/ }).click();
  };

  /**
   * The one-off's sheet, from the Calendar's New event: title, day, start, the website left out; added. A question
   * about an earlier run's leftovers is answered (`answerClash`) unless `asked`, when it's left open for the step.
   */
  const addOneOff = async (title: string, day: string, opts: { starts?: string; asked?: boolean } = {}) => {
    await ada.page.goto("/calendar");
    await ada.page.getByRole("button", { name: "New event" }).click();
    await ada.page.getByRole("button", { name: /^One-off event/ }).click();
    const sheet = ada.page.getByRole("dialog", { name: "Add an event" });
    await sheet.getByRole("textbox", { name: "Title" }).fill(title);
    await sheet.getByRole("button", { name: /^Date:/ }).click();
    await ada.page.getByRole("dialog", { name: "Date" }).getByRole("button", { name: day }).click();
    if (opts.starts) {
      await sheet.getByRole("button", { name: /^Starts:/ }).click();
      await ada.page.getByRole("option", { name: opts.starts, exact: true }).click();
    }
    await sheet.getByRole("checkbox", { name: "Show on the website" }).uncheck();
    await sheet.getByRole("button", { name: "Add to calendar" }).click();
    if (opts.asked) return;
    await expect(sheet.or(clash).first()).toBeVisible();
    // Saved at once, or asked first about what an earlier run left there
    await expect.poll(async () => (await clash.isVisible()) || (await event(title)) !== undefined).toBe(true);
    if (await clash.isVisible()) await answerClash();
    await expect.poll(async () => (await event(title))?.id).toBeDefined();
  };

  /** Ada calls a one-off off from its card's Edit. */
  const callOff = async (title: string) => {
    await ada.page.goto("/calendar");
    await card(ada.page, title).getByRole("button", { name: "Edit" }).click();
    await ada.page
      .getByRole("dialog", { name: "Edit event" })
      .getByRole("button", { name: "Cancel this event" })
      .click();
    await expect.poll(async () => (await event(title))?.cancelledAt).not.toBeNull();
  };

  // A shortcut, not under test: what an earlier run of this journey left on the calendar (called off, but still in
  // Coming up and the clash question) goes back a year, as the admin through the API, so this run sees what a fresh
  // database would
  const ours = /^(Kit day|Quiz night|Skate-off|Pub) [0-9a-z]{4}$/;
  for (const e of (await events()).filter((x) => ours.test(x.title) && x.startsAt > "2026"))
    await adaApi("PUT", `/api/club-events/${e.id}`, {
      ...e,
      startsAt: e.startsAt.replace(/^2026/, "2025"),
      endsAt: e.endsAt.replace(/^2026/, "2025"),
    });

  await stage("1. A one-off on the calendar: members say in or out", async () => {
    for (const who of [ivy, nell])
      await checks(who, "can't put anything on the calendar", async () => {
        await who.page.goto("/calendar");
        await expect(who.page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
        await expect(who.page.getByRole("button", { name: "New event" })).toHaveCount(0);
      });

    await does(ada, `adds ${KIT_DAY}, a one-off on Wed 25 Nov, members saying in or out`, () =>
      addOneOff(KIT_DAY, "Wed 25 Nov 2026"),
    );

    for (const who of [ivy, nell])
      await checks(who, `sees ${KIT_DAY} on the Calendar, in 9 days, and Home's Coming up`, async () => {
        await who.page.goto("/calendar");
        await expect(card(who.page, KIT_DAY)).toContainText("Wed 25 Nov");
        await expect(card(who.page, KIT_DAY)).toContainText("In 9 days");
        await who.page.goto("/");
        await expect(
          who.page.getByRole("region", { name: "Coming up" }).getByRole("link", { name: new RegExp(KIT_DAY) }),
        ).toContainText("Wed 25 Nov");
      });

    await does(ivy, `says she's in for ${KIT_DAY}`, async () => {
      await ivy.page.goto("/calendar");
      await card(ivy.page, KIT_DAY).getByRole("button", { name: "In", exact: true }).click();
      await expect(card(ivy.page, KIT_DAY).getByRole("button", { name: "In", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(card(ivy.page, KIT_DAY)).toContainText("You're in");
    });
    await does(hal, `says he's out of ${KIT_DAY}`, async () => {
      await hal.page.goto("/calendar");
      await card(hal.page, KIT_DAY).getByRole("button", { name: "Out", exact: true }).click();
      await expect.poll(async () => (await event(KIT_DAY))?.out).toContain(memberId("Hal Holiday"));
    });
    await checks(ada, "sees Ivy in and Hal out", async () => {
      const e = (await event(KIT_DAY))!;
      expect(e.going).toEqual([memberId("Ivy Invite")]);
      expect(e.out).toEqual([memberId("Hal Holiday")]);
      await ada.page.goto("/calendar");
      await expect(card(ada.page, KIT_DAY)).toContainText(/1\s*in/);
    });
  });

  await stage("2. Over Friday Training: the clash prompt asks first", async () => {
    await does(ada, `adds ${QUIZ} on Fri 27 Nov: asked about Friday Training that night`, async () => {
      await addOneOff(QUIZ, "Fri 27 Nov 2026", { asked: true });
      await expect(clash).toBeVisible();
      await expect(clash.getByRole("listitem").filter({ hasText: "Friday Training" })).toContainText("Fri 27 Nov");
    });
    await checks(ada, "closes the question: back in the editor, nothing saved", async () => {
      await clash.getByRole("button", { name: "Close" }).click();
      await expect(ada.page.getByRole("dialog", { name: "Add an event" })).toBeVisible();
      expect(await event(QUIZ)).toBeUndefined();
    });
    await does(ada, "adds it again, keeping both: saved, and Friday Training still on", async () => {
      await ada.page
        .getByRole("dialog", { name: "Add an event" })
        .getByRole("button", { name: "Add to calendar" })
        .click();
      await expect(clash).toBeVisible();
      await answerClash();
      await expect.poll(async () => (await event(QUIZ))?.id).toBeDefined();
      await expect(ada.page.getByRole("dialog")).toHaveCount(0);
    });
    for (const who of [ivy, nell])
      await checks(who, `sees ${QUIZ} and Friday Training both on Fri 27 Nov`, async () => {
        await who.page.goto("/calendar");
        await expect(card(who.page, QUIZ)).toContainText("Fri 27 Nov");
        const training = card(who.page, "Friday Training").filter({ hasText: "Fri 27 Nov" });
        await expect(training).toHaveCount(1);
        await expect(training.getByRole("group", { name: "Are you in?" })).toBeVisible();
      });
  });

  await stage("3. Called off: off for everyone", async () => {
    await does(ada, `cancels ${KIT_DAY} (Edit → Cancel this event)`, () => callOff(KIT_DAY));
    await checks(ivy, `sees ${KIT_DAY} off, and can't say in or out of it`, async () => {
      await ivy.page.goto("/calendar");
      const off = card(ivy.page, KIT_DAY);
      await expect(off).toContainText(/off|cancelled/i);
      await expect(off.getByRole("button", { name: /^(In|Out|I'm in)$/ })).toHaveCount(0);
    });
    await checks(ivy, `sees ${KIT_DAY} Cancelled in Home's Coming up`, async () => {
      await ivy.page.goto("/");
      await expect(
        ivy.page.getByRole("region", { name: "Coming up" }).getByRole("link", { name: new RegExp(KIT_DAY) }),
      ).toContainText("Cancelled");
    });
    await checks(ivy, "can't say she's in for it through the API either: one refused tap", async () => {
      const { id } = (await event(KIT_DAY))!;
      await expect(
        asMember(ivy.email, { at: MONDAY })("POST", `/api/club-events/${id}/answer`, { answer: "in" }),
      ).rejects.toThrow(/→ 4\d\d/);
    });
    // Tidy: the quiz is called off too, so a later run's question is about Friday Training only
    await does(ada, `cancels ${QUIZ} too`, () => callOff(QUIZ));
  });

  await stage("4. The locker room: on Home till its last day", async () => {
    await checks(nell, "can't post to the locker room", async () => {
      await nell.page.goto("/");
      await expect(nell.page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(nell.page.getByRole("button", { name: "Post to the locker room" })).toHaveCount(0);
    });

    await does(ada, `posts ${POST}, its last day a week on: Mon 23 Nov`, async () => {
      await ada.page.goto("/");
      await ada.page.getByRole("button", { name: "Post to the locker room" }).click();
      const sheet = ada.page.getByRole("dialog", { name: "Post to the locker room" });
      await sheet.getByRole("textbox", { name: "Title" }).fill(POST);
      await sheet.getByRole("textbox", { name: "A line or two" }).fill("Extra ice on Sunday. Bring a puck.");
      await expect(sheet.getByRole("button", { name: /^Last day:/ })).toHaveText("Mon 23 Nov 2026");
      await sheet.getByRole("button", { name: "Post it" }).click();
      await expect(sheet).toHaveCount(0);
    });

    const lockerRoom = (page: Page) => page.getByRole("region", { name: "Locker room" });
    for (const who of [ivy, hal])
      await checks(who, `sees ${POST} on Home`, async () => {
        await who.page.goto("/");
        await expect(lockerRoom(who.page).getByRole("heading", { name: POST })).toBeVisible();
      });
    await does(hal, "says Got it, and it's gone from his Home", async () => {
      // It's told to the club a moment after the tap (the tick's shown first)
      const told = hal.page.waitForResponse((r) => /\/api\/announcements\/\d+\/dismiss$/.test(r.url()));
      await hal.page.getByRole("button", { name: `Got it: ${POST}` }).click();
      expect((await told).ok()).toBe(true);
      await hal.page.reload();
      await expect(hal.page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(hal.page.getByRole("heading", { name: POST })).toHaveCount(0);
    });
    await checks(ivy, "still sees it at 23:59 on its last day", async () => {
      await at(ivy, london("2026-11-23T23:59"));
      await ivy.page.goto("/");
      await expect(lockerRoom(ivy.page).getByRole("heading", { name: POST })).toBeVisible();
    });
    await checks(
      ivy,
      "doesn't, a minute after London's midnight; it's still under Everything from the locker room",
      async () => {
        await at(ivy, london("2026-11-24T00:01"));
        await ivy.page.goto("/");
        await expect(ivy.page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(ivy.page.getByRole("heading", { name: POST })).toHaveCount(0);
        await ivy.page.goto("/announcements");
        await expect(ivy.page.getByRole("main")).toContainText(POST);
      },
    );
    await at(ivy, MONDAY);
  });

  await stage("5. Notifications: the switches stay as they're set", async () => {
    // No push leaves a local server: what's checked is what the server keeps (it decides who's told, ADR 0108;
    // push.use-cases checks who hears what by these switches)
    const lockerRoomSwitch = () => ivy.page.getByRole("switch", { name: "Locker room" });
    await does(ivy, "turns Locker room off on You", async () => {
      await ivy.page.goto("/me");
      await expect(lockerRoomSwitch()).toBeChecked();
      await lockerRoomSwitch().click();
      await expect(lockerRoomSwitch()).not.toBeChecked();
    });
    await checks(ivy, "finds it still off after a reload, the others still on", async () => {
      await expect
        .poll(async () => {
          await ivy.page.reload();
          return lockerRoomSwitch().isChecked();
        })
        .toBe(false);
      for (const other of ["Teams are out", "Your place", "A session's off", "Dues", "The draft"])
        await expect(ivy.page.getByRole("switch", { name: other })).toBeChecked();
    });
    await checks(ivy, "turns it back on, and it stays on", async () => {
      await lockerRoomSwitch().click();
      await expect(lockerRoomSwitch()).toBeChecked();
      await expect
        .poll(async () => {
          await ivy.page.reload();
          return lockerRoomSwitch().isChecked();
        })
        .toBe(true);
    });
  });

  await stage("6. How soon: Today, Tonight, Tomorrow, In N days, by London's calendar", async () => {
    // Two on Saturday 21 Nov: one before 5pm (Today), one from 5pm (Tonight)
    await does(ada, `adds ${SKATE} at 4:45pm and ${PUB} at 5pm, Sat 21 Nov`, async () => {
      await addOneOff(SKATE, "Sat 21 Nov 2026", { starts: "4:45pm" });
      await addOneOff(PUB, "Sat 21 Nov 2026", { starts: "5pm" });
    });

    /** What Ivy's Calendar says of Friday Training's night, Fri 20 Nov, at a London time (Home's card says the same). */
    const fridayOn = async (wall: string) => {
      await at(ivy, london(wall));
      await ivy.page.goto("/calendar");
      return card(ivy.page, "Friday Training").filter({ hasText: "Fri 20 Nov" }).first();
    };
    for (const [wall, soon] of [
      ["2026-11-16T12:00", "In 4 days"],
      ["2026-11-19T16:59", "Tomorrow"],
      ["2026-11-19T23:59", "Tomorrow"],
      ["2026-11-20T00:01", "Tonight"],
      ["2026-11-20T16:59", "Tonight"],
    ] as const)
      await checks(
        ivy,
        `sees Friday Training (Fri 20 Nov, 7:30pm) as "${soon}" at ${wall.slice(5)} London`,
        async () => {
          await expect(await fridayOn(wall)).toContainText(soon);
        },
      );

    for (const [title, soon] of [
      [SKATE, "Today"],
      [PUB, "Tonight"],
    ] as const)
      await checks(ivy, `sees ${title} as "${soon}" on Sat 21 Nov's morning`, async () => {
        await at(ivy, london("2026-11-21T09:00"));
        await ivy.page.goto("/calendar");
        await expect(card(ivy.page, title)).toContainText(soon);
      });
    await checks(
      ivy,
      `sees ${QUIZ}, off, with no "In N days"; Friday Training on Fri 4 Dec "In 2 weeks" from Mon 16 Nov`,
      async () => {
        await at(ivy, MONDAY);
        await ivy.page.goto("/calendar");
        await expect(card(ivy.page, QUIZ)).not.toContainText(/In \d+ days/);
        await expect(card(ivy.page, "Friday Training").filter({ hasText: "Fri 4 Dec" })).toContainText("In 2 weeks");
      },
    );

    await checks(
      ivy,
      "has Friday's night as Home's hero, the Friday after in Coming up, and no tab: she owes nothing",
      async () => {
        await at(ivy, MONDAY);
        await ivy.page.goto("/");
        // Its sign-up opened this morning (four days before): the hero asks In or Out
        const hero = ivy.page.getByRole("region", { name: "Are you in this Friday?" });
        await expect(hero.getByRole("group", { name: "Are you in?" })).toBeVisible();
        await expect(hero).toContainText("Fri 20 Nov");
        await expect(
          ivy.page
            .getByRole("region", { name: "Coming up" })
            .getByRole("link", { name: /^Fri 27 Nov: Friday Training/ }),
        ).toBeVisible();
        await expect(ivy.page.getByRole("region", { name: "Your tab" })).toHaveCount(0);
      },
    );

    for (const title of [SKATE, PUB]) await does(ada, `cancels ${title}`, () => callOff(title));
  });

  await stage("7. Settings: venues and quips each do their one job; the audit log has it", async () => {
    await does(ada, `adds a venue, ${VENUE}, then gives it an address`, async () => {
      await ada.page.goto("/settings/venues");
      await ada.page.getByRole("button", { name: "Venue", exact: true }).click();
      const add = ada.page.getByRole("dialog", { name: "Add a venue" });
      await add.getByRole("textbox", { name: "Name", exact: true }).fill(VENUE);
      await add.getByRole("button", { name: "Add venue" }).click();
      await expect(add).toHaveCount(0);
      await ada.page.getByRole("button", { name: VENUE, exact: true }).click();
      const edit = ada.page.getByRole("dialog", { name: "Edit venue" });
      await edit.getByRole("textbox", { name: "Address", exact: true }).fill("Queenstown Road, SW8");
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expect(ada.page.getByRole("dialog")).toHaveCount(0);
    });
    await checks(ada, `sees ${VENUE} listed with its address, offered when choosing a place`, async () => {
      await ada.page.reload();
      await expect(ada.page.getByRole("listitem").filter({ hasText: VENUE })).toContainText("Queenstown Road, SW8");
    });

    await does(ada, `adds a quip to Ask, "${QUIP}"`, async () => {
      await ada.page.goto("/settings/quips");
      await ada.page.getByRole("textbox", { name: "New quip" }).fill(QUIP);
      await ada.page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(ada.page.getByRole("button", { name: `Delete “${QUIP}”` })).toBeVisible();
    });
    await checks(ada, "finds it listed after a reload, then deletes it", async () => {
      await ada.page.reload();
      await expect(ada.page.getByRole("button", { name: `Delete “${QUIP}”` })).toBeVisible();
      await ada.page.getByRole("button", { name: `Delete “${QUIP}”` }).click();
      await expect(ada.page.getByRole("button", { name: `Delete “${QUIP}”` })).toHaveCount(0);
    });

    await checks(ada, "sees the Kumite listed under Tournament series", async () => {
      await ada.page.goto("/settings/tournament-series");
      await expect(ada.page.getByRole("main")).toContainText("The Cougars Kumite");
    });

    await checks(ada, `finds what she did in the audit log: ${VENUE}, ${KIT_DAY}`, async () => {
      await ada.page.goto("/settings/audit");
      const search = ada.page.getByRole("searchbox", { name: "Search the log" });
      for (const what of [VENUE, KIT_DAY]) {
        await search.fill(what);
        await expect(ada.page.getByRole("main")).toContainText(what);
      }
    });
    await checks(nell, "can't open Settings' venues", async () => {
      await nell.page.goto("/settings/venues");
      await expect(nell.page.getByRole("button", { name: "Venue", exact: true })).toHaveCount(0);
    });
  });

  noFailedChecks();
  for (const who of everyone) await who.context.close();
});
