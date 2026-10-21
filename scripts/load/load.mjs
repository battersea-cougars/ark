#!/usr/bin/env node
// Load tests (docs/load-testing.md): the club's busy moments against a team Worker of the run's own (the built Worker
// under wrangler dev, its own D1 in a temp folder, ~120 members), or against dev's deployment (--target dev), never
// production.
//
//   npm run load -- baseline             one phone at a time: what each request costs on its own
//   npm run load -- friday-rush          120 members open the app and tap In within 10 s; the crons; teams published
//   npm run load -- live-draft           8 captains picking, 60 players watching the draft room live
//   npm run load -- scoring              1 scorekeeper, 80 members following the game live
//   npm run load -- all                  each, one after another, each on a fresh Worker
//   npm run load -- soak --minutes 60    the scenarios in turn, with a pause between, the crons running
//   npm run load -- cpu                  the Worker's own CPU a request (the fake world, D1's time taken off)
//
//   --members 120     the run's members      --one-address   everyone on one address (the rink's wifi)
//   --no-build        use the last build      --keep          keep the run's D1 folder
//   --target local    the run's own Worker, its members and sessions minted as on dev (the dev path, locally)
//   --target dev      dev (through env-pull; see "Against dev"): --dry-run first, then --yes; --cleanup for leftovers
//   --minutes N       repeat the scenario (or `soak`: each in turn) for N minutes; --pause 60 seconds between
//   --budget 0.5      against dev: start nothing new once the day's D1 rows read pass this share of the free 5M
//   npm run load -- report --from <iso> --to <iso>   Cloudflare's numbers for a window again (dev; they lag)
import { spawnSync } from "node:child_process";
import { cloudflareReport, usageToday } from "./load.analytics.mjs";
import { Stats, sleep } from "./load.client.mjs";
import { cleanUp, leftovers, nothingLeft } from "./load.club.mjs";
import { FREE, report } from "./load.report.mjs";
import { SCENARIOS } from "./load.scenarios.mjs";
import { devHandles, devTarget, localTarget, ownTarget } from "./load.target.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const valued = new Set(["--members", "--target", "--minutes", "--pause", "--budget", "--from", "--to"]);
const asked = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
const where = value("--target", "own");
const members = Number(value("--members", 120));
const log = console.log;

// The Worker's own CPU a request, measured in the fake world (D1's time taken off): api.cpu.use-cases.test.ts
if (asked === "cpu") {
  const r = spawnSync("npx", ["vitest", "run", "apps/team/worker/api/api.cpu.use-cases.test.ts"], {
    stdio: "inherit",
    env: { ...process.env, LOAD_CPU: "1" },
  });
  process.exit(r.status ?? 1);
}
if (!["own", "local", "dev"].includes(where)) fail(`--target own, local or dev, not ${where}`);

// Leftovers of a run stopped hard (kill -9, a lost connection): found by their mark, taken away
if (flag("--cleanup")) {
  if (where !== "dev") fail("--cleanup is for dev (a local run's D1 goes with it): --cleanup --target dev");
  const { db } = await devHandles();
  const { before, after } = await cleanUp(db);
  log(`${db.name}: was ${JSON.stringify(before)}, now ${JSON.stringify(after)}`);
  process.exit(nothingLeft(after) ? 0 : 1);
}
if (asked === "report") {
  const { analytics } = await devHandles();
  if (!analytics) fail("No CLOUDFLARE_ANALYTICS_TOKEN: run it through env-pull.");
  log((await cloudflareReport(analytics, new Date(value("--from")), new Date(value("--to")))).text);
  process.exit(0);
}

const names = asked === "all" || asked === "soak" ? Object.keys(SCENARIOS) : [asked];
if (!names.every((n) => n in SCENARIOS)) fail(`Which scenario? ${Object.keys(SCENARIOS).join(", ")}, all or soak`);
const minutes = Number(value("--minutes", asked === "soak" ? 30 : 0));
if (asked === "soak" && !minutes) fail("soak takes --minutes");

/**
 * D1 rows read a run of each reads (docs/load-testing.md, after #112, 120 members, a fresh database), for a club of
 * `size`: rows read grow about with the members (each read lists them, their answers and places).
 */
const ROWS = { baseline: 50_000, "friday-rush": 620_000, "live-draft": 1_670_000, scoring: 140_000 };
const estimate = (name, size) => Math.round((ROWS[name] * size) / 120);
const pct = (n) => `${((100 * n) / FREE.rowsReadPerDay).toFixed(0)}%`;

if (where === "dev") await checkDev();
await runAll();

/** Dev's preflight, read only: the target's dev's, nothing's left from before, what today's used, what this costs. */
async function checkDev() {
  const { db, analytics } = await devHandles();
  const [club] = await db.rows("SELECT COUNT(*) n FROM members WHERE status = 'active'");
  const left = await leftovers(db);
  const today = analytics ? await usageToday(analytics) : null;
  const size = club.n + members;
  const plan = minutes ? names.map((n) => `${n} (repeated for ${minutes} min)`) : names;
  const cost = names.reduce((n, s) => n + estimate(s, size), 0);
  log(
    [
      `Against dev: ${db.name} (${db.id.slice(0, 8)}…) and https://team.cougars-dev.workers.dev`,
      `Dev's club: ${club.n} active members, plus the run's ${members} (Load Admin and Load Member 1…), for the run only`,
      `Plan: ${plan.join(", ")}`,
      `Left from an earlier run: ${nothingLeft(left) ? "nothing" : JSON.stringify(left)}`,
      today
        ? `Today so far (UTC day): ${today.rowsRead} D1 rows read (${pct(today.rowsRead)} of the free 5M), ${today.rowsWritten} written, ${today.requests} team requests`
        : "Today so far: unknown (no CLOUDFLARE_ANALYTICS_TOKEN)",
      `This run reads about ${cost} rows (${pct(cost)})${minutes ? " a round" : ""}, writes a few thousand; ` +
        `the free day resets at 00:00 UTC; past 80% dev's hourly check emails its admins (ADR 0059)`,
    ].join("\n"),
  );
  if (!nothingLeft(left)) fail("Clean up first: npm run load -- --cleanup --target dev");
  if (today && !flag("--anyway") && today.rowsRead + (minutes ? 0 : cost) > 0.9 * FREE.rowsReadPerDay)
    fail("That would take dev past 90% of today's free rows read: wait for 00:00 UTC (or --anyway).");
  const budget = Number(value("--budget", 0.5));
  if (today && minutes && today.rowsRead > budget * FREE.rowsReadPerDay)
    fail(`Dev has already read ${pct(today.rowsRead)} today, past --budget ${budget}: wait for 00:00 UTC.`);
  if (minutes) log(`The soak starts nothing new once today's rows read pass ${budget * 100}% (--budget ${budget})`);
  if (flag("--dry-run") || !flag("--yes")) {
    log(flag("--dry-run") ? "Dry run: nothing sent." : "Nothing sent: add --yes to run it (tell the user first).");
    process.exit(0);
  }
}

/** Each scenario (in turn until --minutes are up), its report, and the clean-up whatever happens. */
async function runAll() {
  if (flag("--dry-run")) {
    log(`Dry run: would run ${names.join(", ")} against ${where}; nothing started.`);
    return;
  }
  const until = minutes ? Date.now() + minutes * 60_000 : 0;
  const budget = Number(value("--budget", 0.5));
  let build = !flag("--no-build");
  let round = 0;
  do {
    for (const name of names) {
      if (until && Date.now() > until) break;
      if (until && round + names.indexOf(name) > 0) await sleep(Number(value("--pause", 60)) * 1000);
      const ok = await runOne(name, build);
      build = false;
      if (!ok) return;
      // Against dev, before the next: today's rows read under the soak's budget (or 90% for `all`)
      if (where === "dev" && (until || names.length > 1)) {
        const { analytics } = await devHandles();
        const today = analytics && (await usageToday(analytics));
        const limit = until ? budget : 0.9;
        if (today && today.rowsRead > limit * FREE.rowsReadPerDay) {
          log(`Stopping: dev's rows read today ${today.rowsRead} (${pct(today.rowsRead)}) passed ${limit * 100}%`);
          return;
        }
      }
    }
    round++;
  } while (until && Date.now() < until);
}

/** One scenario on a fresh target: its report, then the run's people and what they made taken away. */
async function runOne(name, build) {
  const open = { own: ownTarget, local: localTarget, dev: devTarget }[where];
  const target = await open({ members, build, log });
  let stopping = false;
  target.stopping = () => stopping;
  // Ctrl-C or a kill: stop sending, take everything away, then go
  const onSignal = async (signal) => {
    if (stopping) return;
    stopping = true;
    log(`\n${signal}: cleaning up before stopping…`);
    try {
      await target.stop({ keep: flag("--keep") });
    } catch (e) {
      console.error(`Clean-up failed: ${e.message}. Run: npm run load -- --cleanup --target ${where}`);
    }
    process.exit(130);
  };
  // A stray promise's error (a phone's background tap) is reported, never a crash that skips the clean-up
  const onStray = (e) => console.error(`Unhandled: ${e?.stack ?? e}`);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("unhandledRejection", onStray);
  const stats = new Stats();
  const notes = [];
  const from = new Date();
  let ok = true;
  // The crons beside a long run on a Worker of our own; dev runs its own
  const timers =
    minutes > 0 && target.cron
      ? [
          setInterval(() => target.cron("*/5 * * * *"), 5 * 60_000),
          setInterval(() => target.cron("7 * * * *"), 60 * 60_000),
        ]
      : [];
  try {
    if (target.d1) await target.d1(true);
    const cpu = target.cpu?.();
    const t = performance.now();
    await SCENARIOS[name]({
      target,
      roster: target.roster,
      stats,
      shared: flag("--one-address"),
      notes,
      cpu: target.cpu,
      d1: target.d1,
    });
    const usage = {
      seconds: (performance.now() - t) / 1000,
      cpuMs: target.cpu ? target.cpu() - cpu : null,
      d1: target.d1 ? await target.d1() : null,
      // Against dev every request is this machine's: what production's per-address limits would make of it
      oneAddress: flag("--one-address") || target.remote,
      notes,
    };
    log(report(`${name} on ${where}${flag("--one-address") ? " (one address)" : ""}`, stats, usage));
    if (flag("--server-log") && target.output) log(`\nwrangler dev said:\n${target.output().slice(0, 6000)}`);
  } catch (e) {
    ok = false;
    console.error(`${name} failed: ${e.stack ?? e}\n${target.output?.().slice(-3000) ?? ""}`);
    process.exitCode = 1;
  } finally {
    timers.forEach(clearInterval);
    stopping = true;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("unhandledRejection", onStray);
    try {
      await target.stop({ keep: flag("--keep") });
    } catch (e) {
      ok = false;
      console.error(e.message);
      process.exitCode = 1;
    }
  }
  if (target.analytics) await cloudflareAfter(target.analytics, from, new Date());
  return ok;
}

/** Cloudflare's numbers for the run's window, once they've had time to arrive. */
async function cloudflareAfter(analytics, from, to) {
  log("\nWaiting two minutes for Cloudflare's analytics to catch up…");
  await sleep(120_000);
  const window = [new Date(+from - 60_000), new Date(+to + 60_000)];
  try {
    log((await cloudflareReport(analytics, ...window)).text);
  } catch (e) {
    log(`Cloudflare's numbers: not read (${e.message})`);
  }
  log(
    `Again later: node scripts/env-pull.mjs -- npm run load -- report --from ${window[0].toISOString()} --to ${window[1].toISOString()}`,
  );
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
