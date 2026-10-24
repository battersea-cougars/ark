// Signing in, and asking to join (ADR 0023, 0069, 0031): someone new asks to join from the sign-in page and waits; an
// admin lets them in from The club; they sign in with the code (on your own machine it's on the screen, nothing is
// emailed), a wrong one refused; they add a passkey on their You page, sign out, and sign in with it, no code. Three
// people: Jo, new, in a browser no one's signed in on; Ada, an admin; Hal, a member, who can't let anyone in.
//
// Jo is new every run (her email has the time in it), so it runs on a fresh database or one a run has been through.
// Her browser says it's on an address of its own (journey.ts stranger): the sign-in and join limits count per address
// (api.limits.ts), and they aren't what this tests.
import { expect, test, type Page } from "@playwright/test";
import {
  asMember,
  clubVia,
  checks,
  does,
  expectRefusal,
  noFailedChecks,
  signIn,
  stage,
  stranger,
  type Person,
} from "./journey";

/**
 * A passkey authenticator in this tab, as a phone's own would be (Chrome's virtual one, through DevTools). `present`
 * says whether the person's there to say yes: the face or finger taken as given while they are. While they aren't, a
 * passkey request waits, as the sign-in page's own quiet ask (its email field's suggestions) waits for a tap on a real
 * phone; a virtual authenticator that's always present would answer that at once and sign her straight back in.
 */
async function withAuthenticator(who: Person, page: Page) {
  const devtools = await who.context.newCDPSession(page);
  await devtools.send("WebAuthn.enable");
  const { authenticatorId } = await devtools.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    present: (enabled: boolean) =>
      devtools.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled }),
  };
}

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

test("Signing in, and asking to join", async ({ browser }) => {
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const hal = await signIn(browser, "Member", "Hal Holiday", "hal@example.com");
  const surname = freshSurname();
  const jo = await stranger(browser, "New", `Jo ${surname}`, `jo.${surname.toLowerCase()}@example.com`);
  const adaApi = asMember(ada.email);
  const statusOf = async () =>
    ((await clubVia(adaApi)).members as { name: string; status: string }[]).find((m) => m.name === jo.name)?.status;
  /** The sign-in page's first step: her email, and Send me a code. */
  const askForCode = async () => {
    await jo.page.goto("/");
    await expect(jo.page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await jo.page.getByRole("textbox", { name: "Your email" }).fill(jo.email);
    await jo.page.getByRole("button", { name: "Send me a code" }).click();
  };

  await stage("1. Asking to join", async () => {
    await does(jo, "asks to join from the sign-in page: her name, email and position", async () => {
      await jo.page.goto("/");
      await jo.page.getByRole("button", { name: "Ask to join" }).click();
      await expect(jo.page.getByRole("heading", { name: "Ask to join" })).toBeVisible();
      await jo.page.getByRole("textbox", { name: "Your name" }).fill(jo.name);
      await jo.page.getByRole("textbox", { name: "Email" }).fill(jo.email);
      await jo.page.getByRole("button", { name: "Defence" }).click();
      await jo.page.getByRole("button", { name: "Ask to join" }).click();
      await expect(jo.page.getByRole("heading", { name: "Asked" })).toBeVisible();
      await expect(jo.page.getByText("An admin will let you in")).toBeVisible();
      await expect.poll(statusOf).toBe("pending");
    });

    await checks(jo, "can't sign in before she's let in: no code, only the reply anyone gets", async () => {
      await askForCode();
      await expect(jo.page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      await expect(jo.page.getByRole("heading", { name: "Your code" })).toHaveCount(0);
    });

    await checks(hal, "doesn't see who's asking to join, nor Approve", async () => {
      await hal.page.goto("/club");
      await expect(hal.page.getByRole("heading", { name: "The club", level: 1 })).toBeVisible();
      await expect(hal.page.getByRole("heading", { name: "Asking to join" })).toHaveCount(0);
      await expect(hal.page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    });

    await checks(ada, "sees Jo asking to join on The club, and how many are asking", async () => {
      await ada.page.goto("/club");
      await expect(ada.page.getByRole("heading", { name: "Asking to join" })).toBeVisible();
      await expect(ada.page.getByText(/· \d+ asking to join/)).toBeVisible();
      await expect(ada.page.getByText(jo.name)).toBeVisible();
    });

    // Home tells whoever lets members in, as The club does (decided 2026-10-23, ADR 0118)
    await checks(ada, "is told on Home, under For admins, that Jo is asking to join, opening The club", async () => {
      await ada.page.goto("/");
      const forAdmins = ada.page.getByRole("region", { name: "For admins" });
      await expect(forAdmins.getByRole("link", { name: new RegExp(`${jo.name} is asking to join`) })).toHaveAttribute(
        "href",
        "/club",
      );
    });
    await checks(hal, "isn't told on Home that anyone's asking to join", async () => {
      await hal.page.goto("/");
      await expect(hal.page.getByRole("main")).toBeVisible();
      await expect(hal.page.getByText(/asking to join/)).toHaveCount(0);
    });

    await does(ada, "lets her in (Approve)", async () => {
      await ada.page.goto("/club");
      // Each row's Approve names who it lets in
      await ada.page.getByRole("button", { name: `Approve ${jo.name}` }).click();
      await expect.poll(statusOf).toBe("active");
      await expect(ada.page.locator(".row").filter({ hasText: jo.name })).toHaveCount(0);
      await expect(ada.page.getByRole("button", { name: `${jo.name}: turn the card over` })).toBeVisible();
    });
  });

  await stage("2. Signing in with a code", async () => {
    await checks(jo, "has a wrong code refused, and stays on Your code", async () => {
      expectRefusal(400);
      await askForCode();
      await expect(jo.page.getByRole("heading", { name: "Your code" })).toBeVisible();
      const shown = (await jo.page.locator(".flag .num").textContent())!.trim();
      await jo.page.getByRole("textbox", { name: "The 6-digit code" }).fill(shown === "000000" ? "111111" : "000000");
      await jo.page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(jo.page.getByRole("alert")).not.toBeEmpty();
      await expect(jo.page.getByRole("heading", { name: "Your code" })).toBeVisible();
    });

    await does(jo, "signs in with the code on the screen, and lands on Home", async () => {
      if (!(await jo.page.getByRole("heading", { name: "Your code" }).isVisible())) await askForCode();
      const shown = (await jo.page.locator(".flag .num").textContent())!.trim();
      await jo.page.getByRole("textbox", { name: "The 6-digit code" }).fill(shown);
      await jo.page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(jo.page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(jo.page.getByRole("heading", { level: 1 })).toContainText("Jo");
      await expect(jo.page.getByRole("link", { name: `You: ${jo.name}` })).toBeVisible();
    });
  });

  await stage("3. A passkey: added, then signed in with, no code", async () => {
    const phone = await withAuthenticator(jo, jo.page);

    await does(jo, "adds a passkey on her You page", async () => {
      await jo.page.goto("/me");
      const passkeys = jo.page.getByRole("region", { name: "Passkeys" });
      await passkeys.getByRole("button", { name: /next time/ }).click();
      await expect(passkeys.getByText(/^Added /)).toBeVisible();
    });

    await does(jo, "signs out of this device", async () => {
      // Away from the phone: the sign-in page's quiet ask for a passkey waits for her
      await phone.present(false);
      await jo.page.goto("/me");
      await jo.page.getByRole("button", { name: /^Sign out Of this device/ }).click();
      await expect(jo.page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    });

    await checks(jo, "is signed out: her You page goes to sign-in", async () => {
      await jo.page.goto("/me");
      await expect(jo.page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await expect(jo.page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    });

    await does(jo, "signs in with her passkey (Sign in with a passkey), no code", async () => {
      await jo.page.goto("/");
      await jo.page.getByRole("button", { name: "Sign in with a passkey" }).click();
      // The phone asks for her face or finger, and she's there
      await phone.present(true);
      await expect(jo.page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(jo.page.getByRole("link", { name: `You: ${jo.name}` })).toBeVisible();
    });

    await checks(ada, "sees on Jo's card that she signs in with a passkey", async () => {
      await ada.page.goto("/club");
      await ada.page.getByRole("button", { name: `${jo.name}: turn the card over` }).click();
      const sheet = ada.page.getByRole("dialog", { name: jo.name });
      await expect(sheet.getByText(/passkey/i).first()).toBeVisible();
      await expect(sheet.getByText("No passkeys: they sign in with a code.")).toHaveCount(0);
      await ada.page.keyboard.press("Escape");
    });
  });

  noFailedChecks();
  for (const who of [ada, hal, jo]) await who.context.close();
});
