// Next quarter's plan, a few days before it starts (ADR 0007, #187): five days before a quarter, everyone who'll be
// Quarterly then is told its fee is due and that they can still switch to pay as you go; Ivy is one, on her phone,
// and switches; at the quarter's start she isn't charged. Ada, the admin, sees the lead time on Settings → Membership
// and who was told on the Audit log. Pia pays as she goes, with a phone too, and hears nothing.
//
// The moments: Sun 20 Dec 2026 Ivy goes Quarterly for Jan–Mar 2027; the hourly runs on Sat 26 Dec (the day before) and
// at 09:07 on Sun 27 Dec (before 10am) tell nobody; the 10:07 run tells Ivy; the 11:07 run doesn't again; Ivy switches
// that morning; the run at 00:30 on Fri 1 Jan charges the quarter, not to her.
//
// Shortcuts, each said where it's taken: Ivy's and Pia's phones are registered through the API (as the store app does
// after sign-in), and what a phone would have been sent is read from the local server's push outbox (no Firebase on
// your machine: journey.ts `pushOutboxOf`). Her charges are read through the API as the admin. What's under test is
// who's told, when and what it says, the Dues page it opens, and the charge that doesn't come.
import { expect, test } from "@playwright/test";
import {
  asMember,
  at,
  checks,
  clubVia,
  cron,
  does,
  london,
  noFailedChecks,
  pushOutboxOf,
  signIn,
  stage,
  type Person,
  type Queued,
} from "./journey";

const QUARTER = "2027-Q1";
const KEY = `plan:${QUARTER}`;
/** A journey run on a database other runs may have used: a phone token nobody's used yet. */
const TAG = Date.now().toString(36).slice(-4);

test("Next quarter's plan: told five days before, switched in time, not charged", async ({ browser }) => {
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const ivy = await signIn(browser, "Quarterly next quarter", "Ivy Invite", "ivy@example.com");
  const pia = await signIn(browser, "Pays as she goes", "Pia Payer", "pia@example.com");
  const everyone = [ada, ivy, pia];

  let now = london("2026-12-20T12:00");
  const moveTo = async (wall: string, people: Person[] = everyone) => {
    now = london(wall);
    for (const who of people) await at(who, now);
  };
  const open = async (who: Person, path: string) => {
    await who.page.goto(path);
    await expect(who.page.getByRole("main").getByRole("heading").first()).toBeVisible();
  };
  const plans = (outbox: Queued[]) => outbox.filter((n) => n.key === KEY);
  const members = (await clubVia(asMember(ada.email, { at: now }))).members as { id: number; name: string }[];
  const ivyId = members.find((m) => m.name === "Ivy Invite")!.id;
  const quarterCharges = async () =>
    (
      (await asMember(ada.email, { at: now })("GET", `/api/members/${ivyId}/ledger?limit=200`)).lines as {
        kind: string;
        charge?: { quarter: string | null };
      }[]
    ).filter((l) => l.kind === "charge" && l.charge?.quarter === QUARTER);
  const nextPlan = () => ivy.page.getByRole("group", { name: "Next quarter's plan" });

  await stage("1. Ivy goes Quarterly for next quarter; she and Pia have the app", async () => {
    await moveTo("2026-12-20T12:00");
    await does(ivy, "chooses Quarterly for Jan–Mar 2027 on her Dues page", async () => {
      await open(ivy, "/me/tab");
      await expect(ivy.page.getByText("Next quarter · Jan–Mar 2027")).toBeVisible();
      await nextPlan()
        .getByRole("button", { name: /^Quarterly/ })
        .click();
      await expect(nextPlan().getByRole("button", { name: /^Quarterly/ })).toHaveAttribute("aria-pressed", "true");
    });
    // Their phones, as the store app registers one after sign-in: a shortcut, not the step under test
    for (const who of [ivy, pia])
      await asMember(who.email)("PUT", "/api/auth/device", { token: `journey-${TAG}-${who.email}`, platform: "ios" });
    await checks(ada, "sees on Settings → Membership that the reminder goes 5 days before each quarter", async () => {
      await at(ada, now);
      await open(ada, "/settings/fees");
      await expect(ada.page.getByText("Reminder", { exact: true })).toBeVisible();
      await expect(ada.page.getByText("5 days before", { exact: true })).toBeVisible();
    });
  });

  await stage("2. Not the day before, not before 10am", async () => {
    await moveTo("2026-12-26T12:07");
    await cron(now);
    await checks(ivy, "has nothing on Sat 26 Dec, the day before", async () => {
      expect(plans(pushOutboxOf(ivy.email))).toEqual([]);
    });
    await moveTo("2026-12-27T09:07");
    await cron(now);
    await checks(ivy, "has nothing at 09:07 on Sun 27 Dec", async () => {
      expect(plans(pushOutboxOf(ivy.email))).toEqual([]);
    });
  });

  await stage("3. Five days before, from 10am: Ivy's told; Pia isn't", async () => {
    await moveTo("2026-12-27T10:07");
    await cron(now);
    await checks(
      ivy,
      "is told on her phone: the quarter, its fee, the charge day and the last day to switch",
      async () => {
        const told = plans(pushOutboxOf(ivy.email));
        expect(told).toHaveLength(1);
        expect(told[0].title).toBe("Next quarter's fee is due");
        expect(told[0].body).toMatch(
          /^Your Quarterly membership for 2027-Q1 \(£\d+(\.\d\d)?\) is charged on Fri 1 Jan\. Want to pay as you go instead\? Change it on your Dues page by Thu 31 Dec\.$/,
        );
        expect(told[0].path).toBe("/me/tab?plan=next");
      },
    );
    await checks(pia, "hears nothing: she pays as she goes", async () => {
      expect(plans(pushOutboxOf(pia.email))).toEqual([]);
    });
    await checks(ada, "sees on the Audit log that the app told Ivy, by notification", async () => {
      await open(ada, "/settings/audit");
      await expect(
        ada.page.getByText(`The app told Ivy Invite their ${QUARTER} fee is due, by notification`),
      ).toBeVisible();
    });
    await moveTo("2026-12-27T11:07");
    await cron(now);
    await checks(ivy, "isn't told again by the next hour's run", async () => {
      expect(plans(pushOutboxOf(ivy.email))).toHaveLength(1);
    });
  });

  await stage("4. Ivy taps it, and switches to pay as you go", async () => {
    await moveTo("2026-12-27T11:30");
    await checks(
      ivy,
      "lands on her Dues page at next quarter's plan, which says she can change it by Thu 31 Dec",
      async () => {
        await open(ivy, "/me/tab?plan=next");
        await expect(nextPlan()).toBeInViewport();
        await expect(ivy.page.getByText("Change it by Thu 31 Dec")).toBeVisible();
        await expect(ivy.page).toHaveURL(/\/me\/tab$/);
      },
    );
    await does(ivy, "taps Pay as you go", async () => {
      await nextPlan()
        .getByRole("button", { name: /^Pay as you go/ })
        .click();
      await expect(nextPlan().getByRole("button", { name: /^Pay as you go/ })).toHaveAttribute("aria-pressed", "true");
    });
  });

  await stage("5. The quarter starts: Ivy isn't charged for it", async () => {
    await moveTo("2027-01-01T00:30");
    await cron(now);
    await checks(ivy, "has no 2027-Q1 charge after the hourly run at 00:30 on 1 January", async () => {
      expect(await quarterCharges()).toEqual([]);
    });
    await moveTo("2027-01-01T10:00");
    await checks(ivy, "sees this quarter as Pay as you go on her Dues page", async () => {
      await open(ivy, "/me/tab");
      await expect(ivy.page.getByText(/This quarter · Jan–Mar 2027\s*Pay as you go/)).toBeVisible();
    });
  });

  noFailedChecks();
});
