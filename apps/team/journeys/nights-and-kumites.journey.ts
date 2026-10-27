// Nights and Kumites (#186, ADR 0122, 0030, 0031): several Kumites on Fridays, the training nights they put off,
// nights called off by hand, and each one coming back on its own terms. Seen on dev: after several Kumites, nights
// cancelled and more Kumites, Fridays stayed Cancelled and couldn't be taken back. The rule: a night off for a Kumite
// comes back when that Kumite is deleted or moved, unless another Kumite that day or a hand cancellation still keeps
// it off; It's back on, on the night's page, puts any night back on; and several Kumites are in order everywhere.
// Ada runs it (an admin) on Monday 30 November 2026; Fay (a member) looks.
//
// How each gets to the step under test is a shortcut, said so where it's taken: one Kumite is scheduled through the
// Calendar's wizard and its question (Cancel Friday Training), the rest made, moved and deleted through the API as the
// admin, sending what the app sends (the night off for the Kumite, after it's saved). What's under test is what each
// person sees, a Kumite deleted from its editor, and the night's own Manage. Every Kumite here is deleted at the end
// and every night put back on, so the club's left as it was.
import { expect, test, type Page } from "@playwright/test";
import { asMember, at, checks, clubVia, does, london, noFailedChecks, signIn, stage, type Person } from "./journey";

const NOW = "2026-11-30T12:00";
/** The Fridays (Friday Training's nights) and a Saturday this story uses, as the pages write them and as days. */
const DEC_4 = { day: "2026-12-04", says: "Fri 4 Dec" };
const DEC_11 = { day: "2026-12-11", says: "Fri 11 Dec" };
const DEC_18 = { day: "2026-12-18", says: "Fri 18 Dec" };
const DEC_19 = "2026-12-19";
const DEC_25 = { day: "2026-12-25", says: "Fri 25 Dec" };
const FRIDAYS = [DEC_4, DEC_11, DEC_18, DEC_25];
const OURS = [DEC_4.day, DEC_11.day, DEC_18.day, DEC_19];

const TAG = Date.now().toString(36).slice(-4);
const C = `December Kumite ${TAG}`;
const B = `Christmas Kumite ${TAG}`;
const D = `Second Christmas Kumite ${TAG}`;

interface Night {
  id: number;
  seriesId: number;
  heldOn: string;
  cancelledAt: string | null;
}
interface Kumite {
  id: number;
  typeId: number;
  name: string;
  heldOn: string;
  status: string;
}

test("Nights and Kumites", async ({ browser }) => {
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const fay = await signIn(browser, "Member", "Fay Forward", "fay@example.com");
  for (const who of [ada, fay]) await at(who, london(NOW));

  // The API as the admin at NOW (a shortcut, not under test)
  const api = asMember(ada.email, { at: london(NOW) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const club = async (): Promise<any> => clubVia(api);
  const friday = ((await club()).series as { id: number; name: string; slug: string }[]).find(
    (s) => s.name === "Friday Training",
  )!;
  const nightOn = async (day: string) =>
    ((await club()).sessions as Night[]).find((s) => s.seriesId === friday.id && s.heldOn === day);
  const offDays = async () =>
    ((await club()).sessions as Night[])
      .filter((s) => s.seriesId === friday.id && FRIDAYS.some((f) => f.day === s.heldOn) && s.cancelledAt)
      .map((s) => s.heldOn)
      .sort();
  const kumites = async () => ((await club()).tournaments as Kumite[]).filter((t) => t.typeId === 1);
  const body = (name: string, heldOn: string) => ({
    typeId: 1,
    name,
    heldOn,
    startTime: "18:00",
    endTime: "22:00",
    location: "The Rink",
    feePence: 0,
    kind: "teams",
    teams: [],
  });
  /** What the app does after a Kumite's saved over Friday Training and the admin chose Cancel it. */
  const offFor = async (id: number, day: string) => {
    const night = await nightOn(day);
    if (night && !night.cancelledAt)
      await api("POST", `/api/sessions/${night.id}/cancelled`, { cancelled: true, tournamentId: id });
  };
  const make = async (name: string, day: string) => {
    const { id } = (await api("POST", "/api/tournaments", body(name, day))) as { id: number };
    await offFor(id, day);
    return id;
  };
  const remove = (id: number) => api("DELETE", `/api/tournaments/${id}`);

  /** The calendar's card for a thing on a day. */
  const card = (page: Page, title: string, says: string) =>
    page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .filter({ hasText: says });
  const calendar = async (who: Person) => {
    await who.page.goto("/calendar");
    await expect(who.page.getByRole("main").getByRole("heading").first()).toBeVisible();
  };
  const nightPage = (who: Person, day: string) => who.page.goto(`/training/${friday.slug}/${day}`);
  const manage = (who: Person) => who.page.getByRole("button", { name: /^Manage / });
  const backOn = (who: Person) => who.page.getByRole("button", { name: /^It's back on/ });

  // Anything an earlier run left on our days: gone, and our Fridays back on
  for (const t of await kumites()) if (OURS.includes(t.heldOn)) await remove(t.id);
  for (const f of FRIDAYS) {
    const night = await nightOn(f.day);
    if (night?.cancelledAt) await api("POST", `/api/sessions/${night.id}/cancelled`, { cancelled: false });
  }

  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;

  await stage("1. Several Kumites, in any order, and nights called off", async () => {
    const wizard = ada.page.getByRole("dialog", { name: "The next Kumite" });
    const clash = ada.page.getByRole("dialog", { name: "Already on then" });
    await does(
      ada,
      "schedules a Kumite on Fri 11 Dec through the Calendar's wizard, and cancels Friday Training that night",
      async () => {
        await calendar(ada);
        await ada.page.getByRole("button", { name: "New event" }).click();
        await ada.page.getByRole("button", { name: /^Next Kumite/ }).click();
        await wizard.getByRole("button", { name: /^Day:/ }).click();
        const picker = ada.page.getByRole("dialog", { name: "Day" });
        await picker.getByRole("button", { name: "Next month" }).click();
        await picker.getByRole("button", { name: "Fri 11 Dec 2026" }).click();
        await wizard.getByRole("button", { name: "Next · Sign-up" }).click();
        await wizard.getByRole("button", { name: "Next · Teams" }).click();
        await wizard.getByRole("button", { name: "Next · Check" }).click();
        await wizard.getByRole("button", { name: "Schedule it" }).click();
        const training = clash.getByRole("listitem").filter({ hasText: "Friday Training" });
        await expect(training).toContainText("Fri 11 Dec");
        await training.getByRole("button", { name: "Cancel it" }).click();
        await clash.getByRole("button", { name: /^Save/ }).click();
        await expect(wizard).toHaveCount(0);
        await expect.poll(async () => (await kumites()).find((t) => t.heldOn === DEC_11.day)?.id).toBeDefined();
        a = (await kumites()).find((t) => t.heldOn === DEC_11.day)!.id;
        await expect.poll(async () => (await nightOn(DEC_11.day))?.cancelledAt).not.toBeNull();
      },
    );

    // A shortcut: the rest made through the API, the last first, each night off for its Kumite as the app sends it
    b = await make(B, DEC_18.day);
    c = await make(C, DEC_4.day);
    // A second on the 18th: that night's off already, so it isn't asked about; it's off for both
    d = await make(D, DEC_18.day);

    await does(ada, "calls off Fri 25 Dec by hand, from its own page (Manage → Cancel this night)", async () => {
      await nightPage(ada, DEC_25.day);
      await manage(ada).click();
      await ada.page.getByRole("button", { name: /^Cancel this night/ }).click();
      await ada.page
        .getByRole("dialog", { name: /^Cancel / })
        .getByRole("button", { name: "Cancel this night" })
        .click();
      await expect.poll(offDays).toEqual(FRIDAYS.map((f) => f.day));
    });

    for (const who of [ada, fay])
      await checks(
        who,
        "sees the Kumites in date order on the Calendar, each Friday's training Cancelled",
        async () => {
          await calendar(who);
          const titles = await who.page.getByRole("article").getByRole("heading").allInnerTexts();
          const ours = titles.filter((t) => [C, B, D].includes(t) || /Kumite/.test(t));
          const order = [C, B].map((n) => ours.indexOf(n));
          expect(order[0]).toBeGreaterThanOrEqual(0);
          expect(order[0]).toBeLessThan(order[1]);
          for (const f of FRIDAYS) await expect(card(who.page, "Friday Training", f.says)).toContainText("Cancelled");
        },
      );

    await checks(fay, "on Home, Coming up has Friday Training on Fri 4 Dec Cancelled", async () => {
      await fay.page.goto("/");
      const row = fay.page
        .getByRole("region", { name: "Coming up" })
        .getByRole("link")
        .filter({ hasText: "Friday Training" });
      await expect(row.filter({ hasText: DEC_4.says })).toContainText("Cancelled");
    });

    await checks(ada, "on the Kumite's page, the one on is the soonest not played: 4 Dec's, made last", async () => {
      const soonest = (await kumites())
        .filter((t) => t.status !== "finished")
        .sort((x, y) => x.heldOn.localeCompare(y.heldOn))[0];
      // Another journey's Kumite left before ours would be the one on: ours are from 4 Dec
      expect(soonest.id).toBe(c);
      await ada.page.goto("/tournaments/kumite");
      await expect(ada.page.getByRole("main")).toContainText(DEC_4.says);
    });
  });

  await stage(
    "2. Kumites deleted and moved: their Fridays come back, unless something still keeps them off",
    async () => {
      await does(ada, "deletes the 11 Dec Kumite from its editor (Settings → Tournaments)", async () => {
        await ada.page.goto("/settings/tournaments");
        const name = (await kumites()).find((t) => t.id === a)!.name;
        await ada.page.getByRole("button").filter({ hasText: name }).filter({ hasText: "11 Dec" }).first().click();
        await ada.page.getByRole("button", { name: "Delete" }).click();
        await ada.page.getByRole("button", { name: "Delete" }).click();
        await expect.poll(async () => (await kumites()).some((t) => t.id === a)).toBe(false);
      });
      await checks(fay, "sees Friday Training on Fri 11 Dec on again on the Calendar", async () => {
        await calendar(fay);
        await expect(card(fay.page, "Friday Training", DEC_11.says)).not.toContainText("Cancelled");
      });

      // A shortcut: the API deletes one of the 18th's two Kumites, then moves the other to the Saturday
      await remove(b);
      await checks(ada, "Fri 18 Dec stays off: the second Kumite that day still keeps it off", async () => {
        expect(await offDays()).toEqual([DEC_4.day, DEC_18.day, DEC_25.day]);
      });
      await api("PUT", `/api/tournaments/${d}`, body(D, DEC_19));
      await checks(fay, "with that one moved to the Saturday, Fri 18 Dec is back on", async () => {
        expect(await offDays()).toEqual([DEC_4.day, DEC_25.day]);
        await calendar(fay);
        await expect(card(fay.page, "Friday Training", DEC_18.says)).not.toContainText("Cancelled");
      });
    },
  );

  await stage("3. It's back on, from the night's own page, whatever kept it off", async () => {
    await does(ada, "puts Fri 25 Dec, called off by hand, back on (Manage → It's back on)", async () => {
      await nightPage(ada, DEC_25.day);
      await expect(ada.page.getByRole("article").filter({ hasText: DEC_25.says })).toContainText("Cancelled");
      await manage(ada).click();
      await expect(backOn(ada)).toContainText("called off");
      await backOn(ada).click();
      await expect.poll(async () => (await nightOn(DEC_25.day))?.cancelledAt).toBeNull();
    });
    await does(ada, "puts Fri 4 Dec, off for its Kumite, back on: Keep both after all", async () => {
      await nightPage(ada, DEC_4.day);
      await manage(ada).click();
      await expect(backOn(ada)).toContainText(`off for ${C}`);
      await backOn(ada).click();
      await expect.poll(async () => (await nightOn(DEC_4.day))?.cancelledAt).toBeNull();
    });
    // A shortcut: the API deletes the 4 Dec Kumite; the night was put back on by hand, so it stays on
    await remove(c);
    await checks(fay, "sees every Friday in December on, on the Calendar and Home", async () => {
      expect(await offDays()).toEqual([]);
      await calendar(fay);
      for (const f of FRIDAYS) await expect(card(fay.page, "Friday Training", f.says)).not.toContainText("Cancelled");
      await fay.page.goto("/");
      await expect(fay.page.getByRole("region", { name: "Coming up" })).not.toContainText("Cancelled");
    });
  });

  // The club as it was: the last Kumite gone
  await remove(d);
  noFailedChecks();
});
