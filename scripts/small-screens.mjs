#!/usr/bin/env node
// Small screens: visits every team-app page (and its main sheets and drawers) in WebKit at phone widths and reports
// what doesn't fit: the page scrolling sideways, things past the right edge, words cut short by an ellipsis, and
// small tap targets. Screenshots go to --out/<width>/<page>.png to look at.
//
//   node scripts/dev-sign-in.mjs --port <team port>      # signs in, writes .auth/team.json
//   node scripts/small-screens.mjs --port <team port> [--widths 320,360,375] [--only game,schedule] [--out dir]
//
// Needs Playwright (npx playwright install webkit); set PLAYWRIGHT_DIR to a node_modules that has it if it isn't here.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRoutes } from "../apps/team/src/app/nav-routes.ts";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const port = arg("port");
if (!port) throw new Error("--port <team app port> (npm run app -- --private prints it)");
const base = `http://localhost:${port}`;
const widths = arg("widths", "320,360,375").split(",").map(Number);
const only = arg("only", "")?.split(",").filter(Boolean);
const out = arg("out", join(tmpdir(), "small-screens"));
const require = createRequire(process.env.PLAYWRIGHT_DIR ?? import.meta.url);
const { webkit } = require("playwright");

const state = JSON.parse(readFileSync(".auth/team.json", "utf8"));
const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
const boot = await (await fetch(`${base}/api/bootstrap`, { headers: { cookie } })).json();

// The route tree from the same function the app uses, fed from the bootstrap: a couple of each kind of page
const routes = buildRoutes({
  series: boot.series,
  types: boot.tournamentTypes.map((t) => {
    const editions = boot.tournaments.filter((x) => x.typeId === t.id);
    return {
      ...t,
      captains: editions.flatMap((x) => x.teams.flatMap((team) => team.captainMemberId ?? [])),
      onTeam: true,
      games: editions.flatMap((x) => (x.games ?? []).map((g) => g.id)),
      teams: editions.flatMap((x) => x.teams.flatMap((team) => (team.id ? [{ id: team.id, mine: false }] : []))),
      past: editions.filter((x) => x.status === "played").map((x) => x.id),
      idle: false,
    };
  }),
  me: boot.me,
  members: boot.members.filter((m) => m.status === "active").map((m) => ({ id: m.id, name: m.name })),
  devTools: true,
  unfinished: false,
});
const seen = new Map();
const pages = routes.filter((r) => {
  const kind = r.id.replace(/:.*/, "");
  seen.set(kind, (seen.get(kind) ?? 0) + 1);
  return seen.get(kind) <= (kind === "member" ? 1 : 2);
});

// Sheets and drawers, opened from their page. Only ever buttons that open something: this is the shared local
// database, so a check never changes anything (a state that isn't there is faked in the bootstrap instead). `tabs`:
// each of the open sheet's tabs in turn.
const button = (name) => (p) => p.getByRole("button", { name }).first();
const manage = button(/^Manage/);
const openers = [
  { page: "members", name: "member-sheet", steps: [(p) => p.locator(".page [role=row]").nth(1)], tabs: true },
  { page: "games:", name: "manage", steps: [manage] },
  { page: "games:", name: "editor", steps: [manage, button(/settings/)], tabs: true },
  { page: "schedule:", name: "manage", steps: [manage] },
  { page: "draft:", name: "manage", steps: [manage] },
  { page: "draft:", name: "rules", steps: [button(/^Rules/)] },
  { page: "training:", name: "manage", steps: [manage] },
  { page: "training:", name: "editor", steps: [manage, button(/^Training settings/)], tabs: true },
  { page: "training:", name: "add-player", steps: [manage, button(/^Add player/)] },
  { page: "member:", name: "tabs", steps: [], tabs: true },
  { page: "game:", name: "tools", boot: (b) => setKeeper(b, b.me), steps: [button(/keeping score: tools/)] },
];
function setKeeper(b, keeperId) {
  for (const t of b.tournaments) for (const g of t.games ?? []) if (g.status !== "done") g.keeperId = keeperId;
  return b;
}

// What doesn't fit, measured in the page
function measure() {
  const vw = document.documentElement.clientWidth;
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const text = (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  // Inside a scroller that scrolls sideways on purpose (a table, a strip of chips), going past the edge is fine
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  // Something placed on purpose (a glow, a badge on a corner), not laid out in the flow
  const placed = (el) => ["absolute", "fixed"].includes(getComputedStyle(el).position);
  const found = { overflow: [], pastEdge: [], sideways: [], ellipsis: [], small: [] };
  for (const el of [document.documentElement, document.body]) {
    if (el.scrollWidth > el.clientWidth + 1)
      found.overflow.push(`${el.tagName.toLowerCase()} ${el.scrollWidth}>${el.clientWidth}`);
  }
  for (const el of document.querySelectorAll(".page, dialog, .sheet, .drawer, .panel, [role=dialog]")) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    if (!/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1)
      found.overflow.push(`${label(el).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
  }
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.right > vw + 1 && r.left < vw && !placed(el) && !inScroller(el)) {
      // Only the outermost one: its children are past the edge because it is
      const parent = el.parentElement;
      if (!parent || parent.getBoundingClientRect().right <= vw + 1)
        found.pastEdge.push(`${label(el)} right=${Math.round(r.right)}`);
    }
    // A scroller that scrolls sideways: fine for a table or a strip of chips, a bug for a page
    if (
      /(auto|scroll)/.test(s.overflowX) &&
      el.scrollWidth > el.clientWidth + 1 &&
      !el.matches("[data-scrolls-sideways]")
    )
      found.sideways.push(`${label(el).slice(0, 50)} ${el.scrollWidth}>${el.clientWidth}`);
    if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1 && r.right > 0 && r.left < vw)
      found.ellipsis.push(label(el));
    if (
      el.matches("button, a.btn, [role=button], input[type=checkbox], input[type=radio]") &&
      r.left < vw &&
      r.top < innerHeight
    ) {
      if ((r.height < 32 || r.width < 32) && !el.closest(".dev, [data-small-ok]"))
        found.small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  for (const k of Object.keys(found)) found[k] = [...new Set(found[k])];
  return found;
}

// The game pages as someone following (nobody keeping score: where Keep score is offered) and as the scorekeeper
const variants = [
  { page: "game:", name: "following", boot: (b) => setKeeper(b, null) },
  { page: "game:", name: "scoring", boot: (b) => setKeeper(b, b.me) },
];
const browser = await webkit.launch();
let problems = 0;
for (const width of widths) {
  const dir = join(out, String(width));
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    storageState: ".auth/team.json",
    viewport: { width, height: width < 360 ? 568 : 740 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const report = async (name) => {
    await page.waitForTimeout(400);
    const found = await page.evaluate(measure);
    await page.screenshot({ path: join(dir, `${name}.png`) });
    const lines = Object.entries(found).flatMap(([k, v]) => v.map((x) => `    ${k}: ${x}`));
    const serious = found.overflow.length + found.pastEdge.length;
    problems += serious;
    console.log(`${width} ${name}${serious ? " !" : ""}${lines.length ? "\n" + lines.join("\n") : ""}`);
  };
  // Each page fresh, once its first screen is drawn (the live pages never go quiet enough for "networkidle")
  const visit = async (path) => {
    await page.goto("about:blank");
    await page.goto(base + path, { waitUntil: "load" }).catch(() => {});
    await page.waitForSelector(".page, .game, .note", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
  };
  let fake = null;
  await page.route("**/api/bootstrap", async (r) => {
    if (!fake) return r.continue();
    const res = await r.fetch();
    await r.fulfill({ response: res, json: fake(await res.json()) });
  });
  for (const route of pages) {
    const name = route.id.replace(/:/g, "-");
    if (only?.length && !only.some((o) => route.id.startsWith(o))) continue;
    await visit(route.path);
    await report(name);
    for (const opener of openers.filter((o) => route.id.startsWith(o.page))) {
      fake = opener.boot ?? null;
      await visit(route.path);
      let opened = true;
      for (const step of opener.steps) {
        const target = step(page);
        if (!(await target.count())) {
          opened = false;
          break;
        }
        await target.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
      if (opened) await report(`${name}--${opener.name}`);
      const sheet = page.locator("dialog[open], [role=dialog]:visible").last();
      const scope = (await sheet.count()) ? sheet : page;
      const tabs = opened && opener.tabs ? scope.locator("[role=tab]:visible") : null;
      for (let i = 1; tabs && i < (await tabs.count()); i++) {
        const tab = tabs.nth(i);
        const label = (await tab.innerText()).trim().split(/\s/)[0].toLowerCase();
        await tab.click({ timeout: 3000 }).catch(() => {});
        await report(`${name}--${opener.name}-${label}`);
      }
      fake = null;
    }
    for (const variant of variants.filter((v) => route.id.startsWith(v.page))) {
      fake = variant.boot;
      await visit(route.path);
      await report(`${name}--${variant.name}`);
      fake = null;
    }
  }
  await context.close();
}
await browser.close();
console.log(problems ? `\n${problems} overflowing` : "\nEverything fits.");
process.exit(problems ? 1 : 0);
