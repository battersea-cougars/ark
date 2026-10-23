// What every journey shares (ADR 0124): the people in it, each signed in in a browser of their own, and the steps.
//
// A journey is one story told in stages (`stage`), each a list of things a person does or checks (`does`, `checks`).
// What a person does moves the story on: if they can't, the rest can't happen, so the journey stops there. What a
// person checks (they can, they can't, they see) is noted when it fails and the journey goes on, so one run finds
// every broken check, not just the first. A known bug is `knownBug`: it should fail, and says so when it doesn't.
// journeys.report.ts turns the failures into one summary for the run.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const root = join(import.meta.dirname, "../../..");
const out = process.env.JOURNEY_OUT ?? join(root, ".journeys");
const port = process.env.JOURNEY_PORT;
/** `npm run journeys -- --a11y`: axe looks at every person's page at the end of every stage (a11y.md). */
const a11y = process.env.JOURNEY_A11Y === "1";

/** Someone in the story: who they are in it, signed in in a browser of their own. */
export interface Person {
  /** As the summary names them: their part, then their name ("Player (Fay)"). */
  role: string;
  name: string;
  email: string;
  context: BrowserContext;
  page: Page;
}

/**
 * Signs `email` in (scripts/dev-sign-in.mjs: a session of their own, no code, only a local server answers) and opens
 * the app for them.
 */
export async function signIn(browser: Browser, role: string, name: string, email: string): Promise<Person> {
  const state = join(out, "auth", `${email}.json`);
  execFileSync("node", [join(root, "scripts/dev-sign-in.mjs"), email, "--port", String(port), "--out", state], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  const person = { role: `${role} (${name.split(" ")[0]})`, name, email, context, page };
  people.push(person);
  return person;
}

/** Everyone signed in so far, for the accessibility look (their page may have closed since). */
const people: Person[] = [];

/**
 * The API as a member, without a browser: only to get the story to a step that isn't the one under test (the other
 * players saying they're in, say), each such use saying so where it's called. Same session as `signIn` makes.
 */
export function asMember(email: string) {
  const state = join(out, "auth", `${email}.api.json`);
  execFileSync("node", [join(root, "scripts/dev-sign-in.mjs"), email, "--port", String(port), "--out", state], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const { cookies } = JSON.parse(readFileSync(state, "utf8")) as { cookies: { name: string; value: string }[] };
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const origin = `http://localhost:${port}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (method: string, path: string, body?: object): Promise<any> => {
    const res = await fetch(`${origin}${path}`, {
      method,
      // The API takes a change only from its own page (api/api.http.ts sameOrigin)
      headers: { cookie, origin, ...(body && { "content-type": "application/json" }) },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${email}: ${method} ${path} → ${res.status} ${await res.text()}`);
    return res.headers.get("content-type")?.includes("json") ? res.json() : null;
  };
}

/** The checks that failed, so the test fails at the end once every stage has run. */
const failed: string[] = [];

/** A stage of the story ("Sign-up opens"), its steps under it. */
export const stage = (title: string, body: () => Promise<void>) =>
  test.step(title, async () => {
    await body();
    if (a11y) await lookForBarriers(title);
  });

/** Axe over each person's open page, the WCAG 2.1 AA rules: what it finds goes in a11y.md, never fails the run. */
async function lookForBarriers(stageTitle: string) {
  for (const who of people) {
    if (who.page.isClosed()) continue;
    const { violations } = await new AxeBuilder({ page: who.page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze()
      .catch(() => ({ violations: [] }));
    const path = new URL(who.page.url()).pathname;
    const found = violations.map(
      (v) =>
        `  - ${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join("; ")}`,
    );
    appendFileSync(
      join(out, "a11y.md"),
      `- ${stageTitle} · ${who.role} on ${path}: ${found.length ? `\n${found.join("\n")}` : "nothing found"}\n`,
    );
  }
}

/** Something a person does that the story needs: if it fails, the journey stops here. */
export const does = (who: Person, what: string, body: () => Promise<void>) => test.step(`${who.role}: ${what}`, body);

/** Something a person can or can't do, or sees: a failure is noted and the journey goes on. */
export async function checks(who: Person, what: string, body: () => Promise<void>) {
  const title = `${who.role}: ${what}`;
  try {
    await test.step(title, body);
  } catch {
    failed.push(title);
  }
}

/**
 * A check that fails today because of a known bug in the app: it runs, and should fail. Passing means the bug's fixed:
 * that's a failure to look at (take `knownBug` off, as `it.fails` is in a use case).
 */
export async function knownBug(who: Person, what: string, bug: string, body: () => Promise<void>) {
  const title = `${who.role}: ${what}`;
  let passed = false;
  await test.step(`${title} (known bug: ${bug})`, async () => {
    try {
      await body();
      passed = true;
    } catch {
      test.info().annotations.push({ type: "known bug", description: `${title}: ${bug}` });
    }
  });
  if (passed)
    await checks(who, `${what} (known bug: ${bug})`, async () => {
      throw new Error(
        `Expected: still failing (known bug: ${bug})\nReceived: it passed. Fixed? Take knownBug off this check.`,
      );
    });
}

/** At the end of a journey: fails it if any check failed (each is in the summary already). */
export function noFailedChecks() {
  if (failed.length) throw new Error(`${failed.length} check(s) failed:\n${failed.map((f) => `- ${f}`).join("\n")}`);
}
