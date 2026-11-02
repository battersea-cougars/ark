// The edges (#148): a double tap on a slow signal, a very long name on a phone, and a tap with no signal at all.
// Ada, an admin, double-taps Record payment for Gwen and Post it on Home: each is recorded once. She adds a member whose
// name is 60 letters with an email to match, and puts him in for Friday; on a phone (360 wide) nothing on The club,
// Friday, his card or Settings → Members runs past the screen's edge. Fay, on her phone, loses signal: her In is
// refused with a word saying so and the page doesn't claim she's in; with signal back, the same tap takes.
//
// The long-named member is new every run (his email has the time in it); a database other runs used has others too.
import type { Page } from "@playwright/test";
import { asMember, checks, clubVia, does, expect, signIn, test, type Person } from "./support/journey";

/** 60 letters, spaces and hyphens: the longest name a form is likely to see, with no space to break at for 31. */
const LONG_NAME = "Maximilian-Alexander Featherstonehaugh-Montgomery Wolstenhol";
const PHONE = { width: 360, height: 740 };

/** Friday Training's next night, as the club gives it: the one its page's first card shows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nextFriday(club: any): { id: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const series = (club.series as any[]).find((x) => x.slug === "friday");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (club.sessions as any[])
    .filter((x) => x.seriesId === series.id && !x.cancelled)
    .sort((a, b) => a.heldOn.localeCompare(b.heldOn))[0];
}

/** What runs past the right edge of the screen, if anything: the page scrolling sideways, or an element beyond it. */
async function pastTheEdge(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const sideways = document.documentElement.scrollWidth > width + 1 ? ["the page scrolls sideways"] : [];
    const beyond = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.right <= width + 1) return false;
        // Inside something that scrolls sideways on purpose (a tab strip, a ticker, a wide table) is fine
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.getBoundingClientRect().right <= width + 1)
            return false;
        }
        return getComputedStyle(el).visibility !== "hidden";
      })
      .map(
        (el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${el.textContent?.trim().slice(0, 40)}"`,
      );
    return [...sideways, ...beyond.slice(0, 5)];
  });
}

test.describe.serial("Edge cases: a double tap, a long name on a phone, and no signal", () => {
  let ada: Person;
  let fay: Person;
  let adaApi: ReturnType<typeof asMember>;
  const club = () => clubVia(adaApi);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idOf = async (name: string) => ((await club()).members as any[]).find((m) => m.name === name)?.id as number;
  const paymentsOf = async (name: string) =>
    ((await adaApi("GET", `/api/members/${await idOf(name)}/ledger?limit=200`)).lines as { kind: string }[]).filter(
      (l) => l.kind === "payment",
    ).length;
  const stamp = Date.now().toString(36);
  const email = `maximilian.alexander.featherstonehaugh.${stamp}@a-very-long-domain-name-example.co.uk`;

  test.beforeAll(async ({ browser }) => {
    ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
    fay = await signIn(browser, "Member, on her phone", "Fay Forward", "fay@example.com");
    await fay.page.setViewportSize(PHONE);
    adaApi = asMember(ada.email);
  });
  test.afterAll(async () => {
    for (const who of [ada, fay]) await who?.context.close();
  });

  test("1. A double tap is one change", async () => {
    const before = await paymentsOf("Gwen Glove");
    await does(ada, "double-taps Record payment for Gwen's £5 (a slow signal)", async () => {
      await ada.page.goto("/club");
      await ada.page.getByRole("button", { name: "Gwen Glove: turn the card over" }).click();
      const card = ada.page.getByRole("dialog", { name: "Gwen Glove" });
      await card.getByRole("tab", { name: /^Dues/ }).click();
      await card.getByRole("button", { name: "Record a payment" }).click();
      const pay = ada.page.getByRole("dialog", { name: "Payment from Gwen" });
      await pay.getByRole("textbox", { name: /^Amount/ }).fill("5");
      await pay.getByRole("button", { name: "Record payment" }).dblclick();
      await expect(pay).toHaveCount(0);
    });
    await checks(ada, "sees one payment on Gwen's ledger, not two", async () => {
      await expect.poll(() => paymentsOf("Gwen Glove")).toBe(before + 1);
      // A beat later, in case a second was still on its way
      await ada.page.waitForTimeout(1500);
      expect(await paymentsOf("Gwen Glove")).toBe(before + 1);
      await ada.page.keyboard.press("Escape");
    });

    const title = `Double tap ${Date.now().toString(36)}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posted = async () => ((await club()).announcements as any[]).filter((a) => a.title === title).length;
    await does(ada, "double-taps Post it on Home", async () => {
      await ada.page.goto("/");
      await ada.page.getByRole("button", { name: "Post to the locker room" }).click();
      const sheet = ada.page.getByRole("dialog", { name: "Post to the locker room" });
      await sheet.getByRole("textbox", { name: "Title" }).fill(title);
      await sheet.getByRole("button", { name: "Post it" }).dblclick();
      await expect(sheet).toHaveCount(0);
    });
    await checks(ada, "sees it posted once", async () => {
      await expect.poll(posted).toBe(1);
      await ada.page.waitForTimeout(1500);
      expect(await posted()).toBe(1);
    });
    // Taken down again, so the locker room's two at a time is left for the other journeys
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const a of ((await club()).announcements as any[]).filter((x) => x.title === title))
      await adaApi("DELETE", `/api/announcements/${a.id}`);
  });

  test("2. A 60-letter name on a phone", async () => {
    await does(ada, `adds ${LONG_NAME} (60 letters) with a long email`, async () => {
      await ada.page.goto("/club");
      await ada.page.getByRole("button", { name: "Member", exact: true }).click();
      const sheet = ada.page.getByRole("dialog", { name: "Add a member" });
      await sheet.getByRole("textbox", { name: "Name" }).fill(LONG_NAME);
      await sheet.getByRole("textbox", { name: "Email" }).fill(email);
      await sheet.getByRole("button", { name: "Forward" }).click();
      const quietly = sheet.getByRole("switch", { name: "Email them a link to the app" });
      if ((await quietly.getAttribute("aria-checked")) === "true") await quietly.click();
      await sheet.getByRole("button", { name: "Add", exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await expect
        .poll(async () =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((await club()).members as any[]).some((m) => m.email === email),
        )
        .toBe(true);
    });

    await does(ada, "puts him in for the next Friday (Manage → Add player, as on the night)", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const id = ((await club()).members as any[]).find((m) => m.email === email).id;
      const next = nextFriday(await club());
      await adaApi("POST", `/api/sessions/${next.id}/players`, { memberId: id, in: true });
    });

    await ada.page.setViewportSize(PHONE);
    const card = (page: Page) => page.getByRole("button", { name: `${LONG_NAME}: turn the card over` });
    const pages: [string, string, (page: Page) => ReturnType<Page["getByRole"]>][] = [
      ["The club", "/club", card],
      ["Friday", "/training/friday", (page) => page.getByRole("group", { name: "Are you in?" }).first()],
      [
        "Settings → Members",
        "/settings/members",
        (page) => page.getByRole("row", { name: new RegExp(`^${LONG_NAME}`) }),
      ],
    ];
    for (const [where, path, shows] of pages)
      await checks(ada, `on a phone, nothing on ${where} runs past the screen's edge`, async () => {
        await ada.page.goto(path);
        await expect(shows(ada.page)).toBeVisible();
        expect(await pastTheEdge(ada.page)).toEqual([]);
      });

    await checks(ada, "on a phone, his card's header and Details fit", async () => {
      await ada.page.goto("/club");
      await card(ada.page).click();
      await expect(ada.page.getByRole("dialog", { name: LONG_NAME })).toBeVisible();
      expect(await pastTheEdge(ada.page)).toEqual([]);
      await ada.page.keyboard.press("Escape");
    });

    await checks(fay, "on her phone, Friday's who's in fits with him on it", async () => {
      await fay.page.goto("/training/friday");
      await expect(fay.page.getByRole("group", { name: "Are you in?" }).first()).toBeVisible();
      expect(await pastTheEdge(fay.page)).toEqual([]);
    });
    await ada.page.setViewportSize({ width: 1280, height: 720 });
    // Gone again (erased: a "Former member" to admins), so the journeys after this one meet the club they expect
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const long = ((await club()).members as any[]).find((m) => m.email === email);
    await adaApi("DELETE", `/api/members/${long.id}`);
  });

  test("3. No signal", async () => {
    const inButton = () =>
      fay.page
        .getByRole("group", { name: "Are you in?" })
        .first()
        .getByRole("button", { name: /^(In|I'm in)$/ });
    const fayApi = asMember(fay.email);
    await does(fay, "opens Friday on her phone, then loses signal", async () => {
      // Out first, through her own API, so In is there to tap whatever another journey left
      const next = nextFriday(await clubVia(fayApi));
      await fayApi("POST", `/api/sessions/${next.id}/answer`, { answer: "out" });
      await fay.page.goto("/training/friday");
      await expect(inButton()).toHaveAttribute("aria-pressed", "false");
      await fay.context.setOffline(true);
    });
    await checks(fay, "taps In with no signal: told it didn't go, and In isn't shown as hers", async () => {
      await inButton().click();
      // A failed save's note is an alert (the shell's save note)
      await expect(fay.page.getByRole("alert").filter({ hasText: /reach|signal|offline|connection/i })).toBeVisible();
      await expect(inButton()).toHaveAttribute("aria-pressed", "false");
    });
    await checks(fay, "with signal back, the same tap takes", async () => {
      await fay.context.setOffline(false);
      await inButton().click();
      await expect(inButton()).toHaveAttribute("aria-pressed", "true");
    });
    // Not answered again, as she was, for the journeys after this one
    await fayApi("POST", `/api/sessions/${nextFriday(await clubVia(fayApi)).id}/answer`, { answer: "out" });
    await fayApi("POST", `/api/sessions/${nextFriday(await clubVia(fayApi)).id}/answer`, { answer: "clear" });
  });
});
