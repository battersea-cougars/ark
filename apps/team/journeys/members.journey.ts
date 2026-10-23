// Members: added, changed, given roles, and gone (ADR 0024, 0029, 0069, 0124). Ada, an admin, adds someone from The
// club and changes their name, email and position on their card; adds another quietly, with the email switch off, and
// sends them the app link from their card later (#164); makes Mo a Session lead, and Mo has the night's jobs
// (Make teams, Add player) till she takes it away; can't make herself a Member, as she's the last admin. Rae deletes
// her own account from her You page, can't sign in again, and is gone from the club's lists. Hal, a plain member,
// can't open Settings → Members. The Roles page shows what a role can do.
//
// The member Ada adds is new every run (their email has the time in it). Rae can leave only once a database: on one a
// run has been through already she's gone, and her stage says so and checks only that she stays gone.
import { expect, test, type Locator } from "@playwright/test";
import { asMember, checks, does, expectRefusal, noFailedChecks, signIn, stage, type Person } from "./journey";

/** A surname no run has used: letters from the time. */
const freshSurname = () => {
  const letters = Date.now()
    .toString(26)
    .split("")
    .map((d) => String.fromCharCode(97 + parseInt(d, 26)))
    .join("")
    .slice(-6);
  return letters[0].toUpperCase() + letters.slice(1);
};

interface Member {
  id: number;
  name: string;
  email: string | null;
  position: string;
  status: string;
  roles: string[];
}

test("Members: added, changed, given roles, and gone", async ({ browser }) => {
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const mo = await signIn(browser, "Member, then Session lead", "Mo Moved", "mo@example.com");
  const hal = await signIn(browser, "Member", "Hal Holiday", "hal@example.com");
  const adaApi = asMember(ada.email);
  const members = async () => (await adaApi("GET", "/api/bootstrap")).members as Member[];
  const byEmail = async (email: string) => (await members()).find((m) => m.email === email);

  /** Opens someone's card on The club, as an admin: their sheet, with Details. */
  const openCard = async (name: string) => {
    await ada.page.goto("/club");
    await ada.page.getByRole("button", { name: `${name}: turn the card over` }).click();
    await expect(ada.page.getByRole("dialog", { name })).toBeVisible();
    // Named for who it's about, so not by name once it's open: a rename renames it
    const sheet = ada.page.getByRole("dialog").filter({ has: ada.page.getByRole("tab", { name: "Details" }) });
    await expect(sheet.getByRole("tab", { name: "Details" })).toBeVisible();
    return sheet;
  };
  /** Picks `option` in one of the sheet's drop-downs (lib/Select: a button, then a list). */
  const choose = async (sheet: Locator, field: string, option: string) => {
    await sheet.getByRole("button", { name: field, exact: true }).click();
    await ada.page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
  };
  const save = async (sheet: Locator) => {
    const button = sheet.getByRole("button", { name: "Save", exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(sheet.getByRole("status")).toContainText("Saved");
  };

  const surname = freshSurname();
  const added = { name: `Lee ${surname}`, email: `lee.${surname.toLowerCase()}@example.com` };
  const renamed = { name: `Lea ${surname}`, email: `lea.${surname.toLowerCase()}@example.com` };
  const quiet = { name: `Qui ${surname}`, email: `qui.${surname.toLowerCase()}@example.com` };
  /** The record's latest entry of `action` about someone (Settings → Audit log reads the same). */
  const recorded = async (action: string, memberId: number) =>
    ((await adaApi("GET", "/api/audit")).entries as { action: string; detail: Record<string, unknown> }[]).find(
      (e) => e.action === action && e.detail.memberId === memberId,
    );

  await stage("1. A member added, then changed", async () => {
    await checks(hal, "can't add anyone: no Member button on The club", async () => {
      await hal.page.goto("/club");
      await expect(hal.page.getByRole("heading", { name: "The club", level: 1 })).toBeVisible();
      await expect(hal.page.getByRole("button", { name: "Member", exact: true })).toHaveCount(0);
    });

    await does(ada, `adds ${added.name}, a forward, from The club (Member)`, async () => {
      await ada.page.goto("/club");
      await ada.page.getByRole("button", { name: "Member", exact: true }).click();
      const sheet = ada.page.getByRole("dialog", { name: "Add a member" });
      await sheet.getByRole("textbox", { name: "Name" }).fill(added.name);
      await sheet.getByRole("textbox", { name: "Email" }).fill(added.email);
      await sheet.getByRole("button", { name: "Forward" }).click();
      await sheet.getByRole("button", { name: "Add and email them" }).click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(async () => (await byEmail(added.email))?.status).toBe("active");
    });

    await checks(ada, "sees their card on The club, and their row in Settings → Members", async () => {
      await ada.page.goto("/club");
      await expect(ada.page.getByRole("button", { name: `${added.name}: turn the card over` })).toContainText(
        "Forward",
      );
      await ada.page.goto("/settings/members");
      await expect(ada.page.getByRole("row", { name: new RegExp(`^${added.name} .*${added.email}`) })).toBeVisible();
    });

    await does(ada, "changes their name, email and position on their card, and saves", async () => {
      const sheet = await openCard(added.name);
      await sheet.getByRole("textbox", { name: "Name" }).fill(renamed.name);
      await sheet.getByRole("textbox", { name: "Email (they sign in with it)" }).fill(renamed.email);
      await choose(sheet, "Position", "Defence");
      await save(sheet);
      await expect
        .poll(async () => (await byEmail(renamed.email)) ?? null)
        .toMatchObject({ name: renamed.name, position: "D" });
      await ada.page.keyboard.press("Escape");
    });

    await checks(ada, "sees the change everywhere: the card, and the old email gone", async () => {
      await ada.page.goto("/club");
      await expect(ada.page.getByRole("button", { name: `${renamed.name}: turn the card over` })).toContainText(
        "Defence",
      );
      await expect(ada.page.getByRole("button", { name: `${added.name}: turn the card over` })).toHaveCount(0);
      expect(await byEmail(added.email)).toBeUndefined();
    });

    await does(ada, `adds ${quiet.name} without emailing them: the switch off, the button just Add`, async () => {
      await ada.page.goto("/club");
      await ada.page.getByRole("button", { name: "Member", exact: true }).click();
      const sheet = ada.page.getByRole("dialog", { name: "Add a member" });
      await sheet.getByRole("textbox", { name: "Name" }).fill(quiet.name);
      await sheet.getByRole("textbox", { name: "Email" }).fill(quiet.email);
      const emailThem = sheet.getByRole("switch", { name: "Email them a link to the app" });
      await expect(emailThem).toHaveAttribute("aria-checked", "true");
      await emailThem.click();
      await expect(sheet.getByRole("button", { name: "Add and email them" })).toHaveCount(0);
      await sheet.getByRole("button", { name: "Add", exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(async () => (await byEmail(quiet.email))?.status).toBe("active");
    });

    await checks(ada, "the record says they weren't emailed", async () => {
      const { id } = (await byEmail(quiet.email))!;
      expect((await recorded("member.added", id))?.detail.to).toMatchObject({ name: quiet.name, emailed: false });
    });

    await does(ada, "sends them the app link from their card later, and it's on the record", async () => {
      const { id } = (await byEmail(quiet.email))!;
      const sheet = await openCard(quiet.name);
      await sheet.getByRole("button", { name: "Send them the app link" }).click();
      await expect.poll(async () => (await recorded("member.app_link", id))?.detail.to).toEqual({ emailed: true });
      await ada.page.keyboard.press("Escape");
    });
  });

  const training = "/training/friday";
  const nightJobs = async (who: Person, has: boolean) => {
    await who.page.goto(training);
    await expect(who.page.getByRole("heading", { name: "Friday Training", level: 1 })).toBeVisible();
    await expect(who.page.getByRole("button", { name: "Make teams" })).toHaveCount(has ? 1 : 0);
    const manage = who.page.getByRole("button", { name: "Manage Friday" });
    if (!has) return expect(manage).toHaveCount(0);
    await manage.click();
    const menu = who.page.getByRole("dialog", { name: "Manage Friday" });
    await expect(menu.getByRole("button", { name: /^Add player/ })).toBeVisible();
    // The night's jobs, not the training's own settings: those are an admin's
    await expect(menu.getByRole("button", { name: /^Training settings/ })).toHaveCount(0);
    await menu.getByRole("button", { name: "Close", exact: true }).click();
  };

  await stage("2. Roles: Mo made a Session lead, then a member again", async () => {
    await checks(ada, "sees on the Roles page what a Session lead may do: the register and the teams", async () => {
      await ada.page.goto("/settings/roles");
      await ada.page.getByRole("group", { name: "Roles" }).getByRole("button", { name: "Session lead" }).click();
      await expect(ada.page.getByRole("textbox", { name: "Name" })).toHaveValue("Session lead");
      for (const action of ["Run the register", "Make teams", "Publish teams"])
        await expect(ada.page.getByRole("checkbox", { name: action })).toBeChecked();
      await expect(ada.page.getByRole("checkbox", { name: "Set up trainings" })).not.toBeChecked();
    });

    await checks(mo, "has none of the night's jobs as a member", () => nightJobs(mo, false));

    await does(ada, "makes Mo a Session lead on his card, and saves", async () => {
      const sheet = await openCard("Mo Moved");
      await choose(sheet, "Role", "Session lead");
      await save(sheet);
      await expect.poll(async () => (await byEmail(mo.email))?.roles).toContain("Session lead");
      await ada.page.keyboard.press("Escape");
    });

    await checks(mo, "has the night's jobs now: Make teams, and Add player under Manage", () => nightJobs(mo, true));
    await checks(mo, "still can't open Settings → Members", async () => {
      await mo.page.goto("/settings/members");
      await expect(mo.page.getByRole("heading", { name: "Not for this role" })).toBeVisible();
    });

    await does(ada, "makes Mo a member again", async () => {
      const sheet = await openCard("Mo Moved");
      await choose(sheet, "Role", "Member");
      await save(sheet);
      await expect.poll(async () => (await byEmail(mo.email))?.roles).not.toContain("Session lead");
      await ada.page.keyboard.press("Escape");
    });

    await checks(mo, "has lost the night's jobs again", () => nightJobs(mo, false));

    await checks(ada, "can't make herself a member: she's the club's last admin, and says so", async () => {
      expectRefusal(409);
      const sheet = await openCard("Ada Admin");
      await choose(sheet, "Role", "Member");
      await sheet.getByRole("button", { name: "Save", exact: true }).click();
      await expect(ada.page.getByRole("alert").filter({ hasText: "last admin" })).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Role", exact: true })).toHaveText("Admin");
      await ada.page.keyboard.press("Escape");
      expect((await byEmail(ada.email))?.roles).toContain("Admin");
    });
  });

  await checks(hal, "can't open Settings → Members: Not for this role", async () => {
    await hal.page.goto("/settings/members");
    await expect(hal.page.getByRole("heading", { name: "Not for this role" })).toBeVisible();
    await expect(hal.page.getByRole("grid")).toHaveCount(0);
  });

  const raeEmail = "rae@example.com";
  const raeHere = (await byEmail(raeEmail))?.status === "active";
  await stage(
    `3. Rae deletes her own account${raeHere ? "" : " (gone already: a database a run's been through)"}`,
    async () => {
      if (raeHere) {
        const rae = await signIn(browser, "Leaving", "Rae Retiring", raeEmail);
        await does(rae, "deletes her account from her You page, asked first, and is signed out", async () => {
          await rae.page.goto("/me");
          await rae.page
            .getByRole("region", { name: "Your account" })
            .getByRole("button", { name: "Delete my account" })
            .click();
          const ask = rae.page.getByRole("dialog", { name: "Delete your account?" });
          await ask.getByRole("button", { name: "Delete my account" }).click();
          await expect(rae.page.getByRole("heading", { name: "Sign in" })).toBeVisible();
        });
        await checks(rae, "can't sign in again: no code for her email", async () => {
          // Her own address, as anyone's phone would be: the sign-in limit counts per address (api.limits.ts)
          await rae.context.setExtraHTTPHeaders({ "cf-connecting-ip": `10.9.${Date.now() & 255}.1` });
          await rae.page.goto("/");
          await rae.page.getByRole("textbox", { name: "Your email" }).fill(raeEmail);
          await rae.page.getByRole("button", { name: "Send me a code" }).click();
          await expect(rae.page.getByRole("heading", { name: "Check your email" })).toBeVisible();
          await expect(rae.page.getByRole("heading", { name: "Your code" })).toHaveCount(0);
        });
        await rae.context.close();
      }
      await checks(ada, "no longer sees Rae: not on The club, not in Settings → Members", async () => {
        await ada.page.goto("/club");
        await expect(ada.page.getByRole("heading", { name: "The club", level: 1 })).toBeVisible();
        await expect(ada.page.getByRole("button", { name: "Rae Retiring: turn the card over" })).toHaveCount(0);
        await ada.page.goto("/settings/members");
        await expect(ada.page.getByRole("row", { name: /^Ada Admin/ })).toBeVisible();
        await expect(ada.page.getByRole("row", { name: /Rae Retiring/ })).toHaveCount(0);
        expect(await byEmail(raeEmail)).toBeUndefined();
      });
    },
  );

  noFailedChecks();
  for (const who of [ada, mo, hal]) await who.context.close();
});
