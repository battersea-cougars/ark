// Every page opens clean (ADR 0031): for each of the three people (an admin, a Kumite player, a member not in it),
// every page their menu has (the rail, Settings for the admin, More for a member) and the overlays that only look
// (each editor opened and shut unsaved, Manage, the draft room, the awards), each showing its heading with no error in
// the browser (journey.ts listens: an uncaught error, a console error, a Svelte warning that means a bug).
//
// Nothing is saved, deleted or confirmed: it only looks. On whatever the database holds when it runs (after the
// Kumite night, its past Kumite's pages too).
import { expect, test, type Page } from "@playwright/test";
import { checks, noFailedChecks, signIn, stage, type Person } from "./journey";

const KUMITE = "/tournaments/kumite";

/** The app's own pages a page links to, from `scope` ("nav a" for the menus), each once. */
async function linksOn(page: Page, scope: string) {
  const hrefs = await page
    .locator(`${scope}[href^="/"]`)
    .evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
  return hrefs;
}

/** Every page in someone's menus: the rail and tabs, then the lists under Settings, More and You. */
async function menuOf(who: Person) {
  const paths = new Set<string>(["/"]);
  await who.page.goto("/");
  await expect(who.page.getByRole("navigation").first()).toBeVisible();
  for (const p of await linksOn(who.page, "nav a")) paths.add(p);
  for (const list of ["/settings", "/more", "/me"].filter((p) => paths.has(p))) {
    await who.page.goto(list);
    await expect(who.page.getByRole("main").getByRole("heading").first()).toBeVisible();
    for (const p of await linksOn(who.page, "main a")) paths.add(p);
  }
  // A link out of the app (the privacy policy's site, a sign-out) isn't a page here
  return [...paths].filter((p) => !/^\/(api|auth|sign-?out)\b/.test(p)).sort();
}

/** Opens a page and sees it drawn: a heading in its main part. */
const opens = async (who: Person, path: string) => {
  await who.page.goto(path);
  await expect(who.page.getByRole("main").getByRole("heading").first()).toBeVisible();
};

/** Opens an overlay with `open`, sees it, then shuts it unsaved (Escape), and it's gone. */
const looksIn = async (who: Person, open: () => Promise<void>) => {
  await open();
  const dialog = who.page.getByRole("dialog").last();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading").first()).toBeVisible();
  await who.page.keyboard.press("Escape");
  await expect(who.page.getByRole("dialog")).toHaveCount(0);
};

test("Every page opens clean", async ({ browser }) => {
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const fay = await signIn(browser, "Player", "Fay Forward", "fay@example.com");
  const nell = await signIn(browser, "Member, not in it", "Nell Nonplayer", "nell@example.com");

  for (const who of [ada, fay, nell])
    await stage(`${who.role}: every page in the menus`, async () => {
      const pages = await menuOf(who);
      for (const path of pages) await checks(who, `opens ${path}`, () => opens(who, path));
      // Reached from the Kumite's page, not the menu
      for (const path of [`${KUMITE}/draft/room`, `${KUMITE}/awards`])
        await checks(who, `opens ${path}`, () => opens(who, path));
    });

  await stage("Admin (Ada): every editor opens, and shuts unsaved", async () => {
    await checks(ada, "opens the Kumite's editor (Next Kumite, or Manage → Kumite settings)", async () => {
      await opens(ada, KUMITE);
      const next = ada.page.getByRole("button", { name: "Next Kumite" });
      await looksIn(ada, async () => {
        if (await next.isVisible()) return next.click();
        await ada.page.getByRole("button", { name: "Manage the Kumite" }).click();
        await ada.page
          .getByRole("dialog", { name: "Manage the Kumite" })
          .getByRole("button", { name: /^Kumite settings/ })
          .click();
      });
    });
    const manage = ada.page.getByRole("button", { name: "Manage the Kumite" });
    if (await manage.isVisible())
      await checks(ada, "opens Manage on the Kumite's page", () => looksIn(ada, () => manage.click()));
    const editors: [string, string, string][] = [
      ["a tournament series' editor", "/settings/tournament-series", "main button.card.panel"],
      ["a training's editor", "/settings/training", "main button.card.panel"],
      ["a venue's editor", "/settings/venues", "main button.open"],
      ["a tournament's editor", "/settings/tournaments", "main button.table-row"],
    ];
    for (const [what, path, row] of editors)
      await checks(ada, `opens ${what} (${path})`, async () => {
        await opens(ada, path);
        const first = ada.page.locator(row).first();
        // None yet (a fresh database has no tournaments till the Kumite night's run): nothing to open
        if (await first.count()) await looksIn(ada, () => first.click());
      });
  });

  noFailedChecks();
  for (const who of [ada, fay, nell]) await who.context.close();
});
