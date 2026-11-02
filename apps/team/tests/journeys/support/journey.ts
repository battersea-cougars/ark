// What every journey shares (ADR 0031): the people in it, each signed in in a browser of their own, and the steps.
//
// A journey is one story, a `test.describe.serial` in its own file: each step of the story is a `test` of its own, run
// in order on the same people and the same database (so one step can't run alone: run its journey). Its people sign in
// in `test.beforeAll` and leave in `test.afterAll`. Inside a step, things a person does or checks (`does`, `checks`):
// what a person does moves the story on, so if they can't, the step stops there. What a person checks (they can, they
// can't, they see) is noted when it fails and the step goes on, so it finds every broken check in it, not just the
// first; the step fails at its end. A failed step ends the journey (the steps after it are skipped). A known bug is
// `test.fail()` on its step: it should fail, and a pass says it's fixed.
// Everyone's browser is listened to: an uncaught error, a console error or one of Svelte's warnings that means a bug,
// on any of their pages, fails the step it happened in (noted, as a check is). This file's `test` is Playwright's,
// with that look after every step (and axe's, with --a11y) as an automatic fixture; journeys.report.ts turns the
// failures into one summary for the run.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test as base, type Browser, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test";
import { PAGE_PARTS } from "../../../src/app/club-parts";
import { wholeClub } from "../../../src/app/club-whole";

const root = join(import.meta.dirname, "../../../../..");
const out = process.env.JOURNEY_OUT ?? join(root, ".journeys");
const port = process.env.JOURNEY_PORT;
/** The journeys' own D1 (journeys.setup.mjs), as wrangler reads it. */
const state = process.env.JOURNEY_STATE ?? join(out, "d1");
/** `npm run journeys -- --a11y`: axe looks at every person's page at the end of every step (a11y.md). */
const a11y = process.env.JOURNEY_A11Y === "1";
/** The header that moves the server's clock for one request (worker/api/api.dev-clock.ts): dev and local only. */
const DEV_NOW = "x-dev-now";

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
  freshFor(base.info().file);
  const state = join(out, "auth", `${email}.json`);
  execFileSync("node", [join(root, "scripts/dev-sign-in.mjs"), email, "--port", String(port), "--out", state], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const context = await browser.newContext({ storageState: state });
  const person = { role: `${role} (${name.split(" ")[0]})`, name, email, context } as Person;
  // Every page they open, this one and any later (context.newPage), is listened to
  context.on("page", (p) => listen(person, p));
  const page = await context.newPage();
  person.page = page;
  people.push(person);
  return person;
}

/**
 * Someone with no account, in a browser no one's signed in on: listened to like everyone else. Their browser says it's
 * on an address of its own (CF-Connecting-IP, as Cloudflare's edge sets it): the sign-in and join limits count per
 * address (api.limits.ts), and a journey isn't testing them.
 */
export async function stranger(browser: Browser, role: string, name: string, email: string): Promise<Person> {
  freshFor(base.info().file);
  const address = `10.${(Date.now() >> 16) & 255}.${(Date.now() >> 8) & 255}.${Date.now() & 255}`;
  const context = await browser.newContext({ extraHTTPHeaders: { "cf-connecting-ip": address } });
  const person = { role: `${role} (${name.split(" ")[0]})`, name, email, context } as Person;
  context.on("page", (p) => listen(person, p));
  person.page = await context.newPage();
  people.push(person);
  return person;
}

/** Everyone signed in so far, for the accessibility look (their page may have closed since). */
const people: Person[] = [];

/**
 * Svelte's dev warnings that mean a bug in the app, not a style note (svelte.dev/docs/svelte/runtime-warnings). Its
 * runtime errors (effect_update_depth_exceeded, state_unsafe_mutation, …) are thrown, so they're page errors already.
 */
const SVELTE_BUGS = [
  "ownership_invalid_binding",
  "ownership_invalid_mutation",
  "state_proxy_equality_mismatch",
  "state_snapshot_uncloneable",
  "binding_property_non_reactive",
  "await_reactivity_loss",
  "await_waterfall",
  "assignment_value_stale",
  "event_handler_invalid",
  "hydration_mismatch",
  "lifecycle_double_unmount",
  "select_multiple_invalid_value",
];

/** The refusals the step under way taps for on purpose (`expectRefusal`): cleared when it ends. */
const refusalsExpected = new Set<number>();

/**
 * The step under way is refused on purpose, with this status (the last admin's 409, a signed-out page's 401): Chrome
 * logs every such reply as a console error ("Failed to load resource"), and that one isn't a bug. Only for this step,
 * and only that status: any other error still fails it.
 */
export function expectRefusal(status: number) {
  refusalsExpected.add(status);
}

/** Console errors that aren't the app's bugs, each with why. Keep it short: an entry here hides a real message. */
const HARMLESS: { why: string; is: (m: ConsoleMessage) => boolean }[] = [
  {
    why: "the browser asking for /favicon.ico on its own: the app's icon is in its manifest",
    is: (m) => /\/favicon\.ico$/.test(m.location().url),
  },
  {
    why: "a signed-out page finding out it's signed out: the app's first ask (the bootstrap) gets a 401, by design",
    is: (m) =>
      m.text().startsWith("Failed to load resource: the server responded with a status of 401 ") &&
      new URL(m.location().url || "http://x/").pathname === "/api/bootstrap",
  },
  {
    why: "Chrome's own line for a request made with no signal, which only a step taking the signal away (setOffline) has",
    is: (m) => m.text().startsWith("Failed to load resource: net::ERR_INTERNET_DISCONNECTED"),
  },
  {
    why: "Chrome's own line for a reply the step was refused on purpose (expectRefusal), not the app's",
    is: (m) =>
      [...refusalsExpected].some((status) =>
        m.text().startsWith(`Failed to load resource: the server responded with a status of ${status} `),
      ),
  },
];

/** What went wrong in someone's browser since the last step took it: "Admin (Ada) on /settings: …". */
const browserErrors: string[] = [];

/**
 * An overlay closing takes its own history entry off (lib/back.ts: `history.back()`), and that lands a moment later:
 * an address opened before it lands is cancelled by it (net::ERR_ABORTED), as typing one at that moment would be.
 * So a person's `goto` waits for it: for the entry to go once no overlay's open, and, if one was still on its way out
 * when the address was opened, opens it again once the entry's gone (the one thing that cancels it, so once).
 */
function settledGoto(page: Page) {
  const goto = page.goto.bind(page);
  const overlayEntryGone = () =>
    page
      .waitForFunction(
        () => {
          const state = history.state as Record<string, unknown> | null;
          const onOverlay = !!state && typeof state === "object" && "layer" in state;
          return !onOverlay || !!document.querySelector("dialog[open], [role='dialog']");
        },
        undefined,
        { timeout: 5_000 },
      )
      // A page that's gone, or an entry left from before a reload with nothing open: nothing of ours to wait for
      .catch(() => {});
  page.goto = async (url, options) => {
    await overlayEntryGone();
    try {
      return await goto(url, options);
    } catch (e) {
      if (!String(e).includes("net::ERR_ABORTED")) throw e;
      await overlayEntryGone();
      return goto(url, options);
    }
  };
}

function listen(who: Person, page: Page) {
  settledGoto(page);
  const where = () => `${who.role} on ${new URL(page.url() || "about:blank", "http://x").pathname}`;
  page.on("pageerror", (e) => browserErrors.push(`${where()}: uncaught ${e.name}: ${e.message}`));
  page.on("console", (m) => {
    const svelteBug = m.type() === "warning" && SVELTE_BUGS.some((code) => m.text().includes(code));
    if ((m.type() !== "error" && !svelteBug) || HARMLESS.some((h) => h.is(m))) return;
    const from = m.location().url ? ` (${m.location().url})` : "";
    browserErrors.push(`${where()}: console ${m.type()}: ${m.text()}${from}`);
  });
}

/** The error screen each page was last seen on (brokenScreens). */
const screensSeen = new WeakMap<Page, string>();

/**
 * The app's own "it broke" screen (main.ts showError: "Can't reach the club's data" and why) on anyone's open page. An
 * error the app catches while it starts never reaches the console, so it's looked for: one per page it's on.
 */
async function brokenScreens() {
  for (const who of people)
    for (const page of who.context.pages()) {
      const screen = page.locator(".boot-error");
      if (page.isClosed() || !(await screen.count().catch(() => 0))) continue;
      const said = (await screen.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const where = new URL(page.url() || "about:blank", "http://x").pathname;
      const line = `${who.role} on ${where}: the app's error screen: ${said}`;
      // Once for each time it breaks: a page left on it isn't a new error at every step after
      if (screensSeen.get(page) === line) continue;
      screensSeen.set(page, line);
      browserErrors.push(line);
    }
}

/**
 * The browser errors since the last step took them, failing a step of their own under the one they happened in (so
 * the summary has them, under it) and noted as a failed check: the journey goes on.
 */
async function noBrowserErrors(title: string) {
  refusalsExpected.clear();
  await brokenScreens();
  if (!browserErrors.length) return;
  const errors = browserErrors.splice(0);
  try {
    await test.step(`${title}: no errors in the browser`, () => {
      throw new Error(`${errors.length} error(s) in the browser:\n${errors.map((e) => `- ${e}`).join("\n")}`);
    });
  } catch {
    failed.push(`${title}: errors in the browser`);
  }
}

/**
 * The API as a member, without a browser: only to get the story to a step that isn't the one under test (the other
 * players saying they're in, say), each such use saying so where it's called. Same session as `signIn` makes.
 */
export function asMember(email: string, opts: { at?: Date | string } = {}) {
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
      headers: {
        cookie,
        origin,
        ...(body && { "content-type": "application/json" }),
        ...(opts.at && { [DEV_NOW]: new Date(opts.at).toISOString() }),
      },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${email}: ${method} ${path} → ${res.status} ${await res.text()}`);
    return res.headers.get("content-type")?.includes("json") ? res.json() : null;
  };
}

/**
 * The club as the app holds it once its pages are read (#178), through a shortcut like `asMember`'s: opening the app
 * (the core) and every page's parts, put together as the app puts them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function clubVia(api: (method: string, path: string) => Promise<any>) {
  const core = await api("GET", "/api/bootstrap");
  return wholeClub(core, (await api("GET", `/api/slices?names=${PAGE_PARTS.join(",")}`)).slices);
}

/**
 * A training a journey made, paused (no more nights, off the menus) if it's still running: for the journey's
 * `test.afterAll`, so one that stopped half way never leaves its nights to meet the journeys after it on Home and
 * the calendar (a Tuesday night still on at 00:30 leads Home over the Kumite's after-party). As the admin, through the
 * API, at the story's last moment (`at`: a journey moves forward only). A shortcut, not under test.
 */
export async function pauseTraining(adminEmail: string, seriesId: number, at: Date) {
  if (!seriesId) return;
  const api = asMember(adminEmail, { at });
  const series = (await clubVia(api)).series as { id: number; active: boolean }[];
  const ours = series.find((s) => s.id === seriesId);
  if (ours?.active) await api("PUT", `/api/series/${seriesId}`, { ...ours, active: false });
}

/**
 * Puts someone at a moment: their browser's clock (Playwright's clock, for every page of theirs, fixed there) and the
 * server's for every request their pages make (worker/api/api.dev-clock.ts). Both, so the app's own reckoning ("Tonight",
 * "In 3 days") and the server's (what's open, what's refused, what's charged) agree. Their next page load sees it.
 */
export async function at(who: Person, when: Date | string) {
  const moment = new Date(when);
  await who.context.clock.setFixedTime(moment);
  await who.context.setExtraHTTPHeaders({ [DEV_NOW]: moment.toISOString() });
}

/**
 * The Worker's cron run at a moment (wrangler.jsonc triggers), as Cloudflare would: "hourly" charges what a new day or
 * quarter makes due (dues.charge), "five" sends queued reminders and tells members a sign-up has opened. The local dev
 * server's own trigger (`/cdn-cgi/local/scheduled`), so only a local server runs it.
 */
export async function cron(when: Date | string, run: "hourly" | "five" = "hourly") {
  const schedule = run === "hourly" ? "7 * * * *" : "*/5 * * * *";
  const url = new URL("/cdn-cgi/local/scheduled", `http://localhost:${port}`);
  url.searchParams.set("cron", schedule);
  url.searchParams.set("time", String(new Date(when).getTime()));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cron ${schedule} at ${new Date(when).toISOString()}: ${res.status}`);
}

/** What the local server queued for someone's phones or browsers (push_outbox, ADR 0108). */
export interface Queued {
  key: string;
  title: string;
  body: string;
  path: string;
}

/**
 * The fake push outbox: no Firebase on a local server, so nothing leaves it, and what it would have sent stays in its
 * D1 (`push_outbox`, a row per member per notification, ADR 0108), read here as wrangler reads the journeys' own D1.
 * Only for a member with a device: the outbox has nobody else's.
 */
export function pushOutboxOf(email: string): Queued[] {
  if (!/^[\w.+-]+@[\w.-]+$/.test(email)) throw new Error(`pushOutboxOf: not an email: ${email}`);
  const sql = `SELECT o.key, o.title, o.body, o.path FROM push_outbox o JOIN members m ON m.id = o.member_id
    WHERE m.email = '${email}' ORDER BY o.id`;
  const said = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      state,
      "-c",
      join(root, "apps/web/wrangler.jsonc"),
      "--json",
      "--command",
      sql,
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return (JSON.parse(said.slice(said.indexOf("["))) as { results: Queued[] }[])[0].results;
}

/** A London wall-clock time as an instant: `london("2026-10-25T01:30")`, BST or GMT as London had it then. */
export function london(wall: string): Date {
  const [day, time = "12:00"] = wall.split("T");
  const guess = new Date(`${day}T${time}:00Z`);
  // London is UTC or UTC+1: try both, keep the one London reads back as the wall time asked for
  for (const offset of [0, 1]) {
    const t = new Date(guess.getTime() - offset * 3_600_000);
    const read = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .format(t)
      .replace(" ", "T");
    if (read === `${day}T${time}`) return t;
  }
  throw new Error(`${wall} never happened in London (the clocks went forward over it)`);
}

/** The checks that failed in the step under way, so it fails at its end once all of it has run. */
const failed: string[] = [];

/** The journey (its file) these are for: a new one starts with none of the last one's people or errors. */
let journeyFile = "";
function freshFor(file: string) {
  if (file === journeyFile) return;
  journeyFile = file;
  failed.length = 0;
  browserErrors.length = 0;
  people.length = 0;
}

/**
 * Playwright's `test`, with one automatic fixture: after every step (each `test` in a journey), the browser errors since
 * the last look, axe's look with --a11y, and the step failed if any of its checks did.
 */
export const test = base.extend<{ afterEachStep: void }>({
  afterEachStep: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      failed.length = 0;
      await use();
      // Any that came between its does and checks
      await noBrowserErrors(testInfo.title);
      if (a11y) await lookForBarriers(testInfo.title);
      if (failed.length)
        throw new Error(`${failed.length} check(s) failed:\n${failed.map((f) => `- ${f}`).join("\n")}`);
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";

/** Axe over each person's open page, the WCAG 2.1 AA rules: what it finds goes in a11y.md, never fails the run. */
async function lookForBarriers(stepTitle: string) {
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
      `- ${stepTitle} · ${who.role} on ${path}: ${found.length ? `\n${found.join("\n")}` : "nothing found"}\n`,
    );
  }
}

/** Something a person does that the story needs: if it fails, the journey stops here. */
export const does = (who: Person, what: string, body: () => Promise<void>) =>
  test.step(`${who.role}: ${what}`, async () => {
    await body();
    await noBrowserErrors(`${who.role}: ${what}`);
  });

/** Something a person can or can't do, or sees: a failure is noted and the journey goes on. */
export async function checks(who: Person, what: string, body: () => Promise<void>) {
  const title = `${who.role}: ${what}`;
  try {
    await test.step(title, async () => {
      try {
        await body();
      } finally {
        await noBrowserErrors(title);
      }
    });
  } catch {
    failed.push(title);
  }
}
