#!/usr/bin/env node
// Load tests on your own machine (docs/load-testing.md): the club's busy moments against a team Worker of the run's
// own (the built Worker under wrangler dev, its own D1 in a temp folder, ~120 members), never dev or production.
//
//   npm run load -- baseline             one phone at a time: what each request costs on its own
//   npm run load -- friday-rush          120 members open the app and tap In within 10 s; the crons; teams published
//   npm run load -- live-draft           8 captains picking, 60 players watching the draft room live
//   npm run load -- scoring              1 scorekeeper, 80 members following the game live
//   npm run load -- all                  each, one after another, each on a fresh Worker
//   npm run load -- cpu                  the Worker's own CPU a request (the fake world, D1's time taken off)
//
//   --members 120     the club's size        --one-address   everyone on one address (the rink's wifi)
//   --no-build        use the last build      --keep          keep the run's D1 folder
import { spawnSync } from "node:child_process";
import { Stats } from "./load.client.mjs";
import { report } from "./load.report.mjs";
import { SCENARIOS } from "./load.scenarios.mjs";
import { startServer } from "./load.server.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const asked = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
// The Worker's own CPU a request, measured in the fake world (D1's time taken off): api.cpu.use-cases.test.ts
if (asked === "cpu") {
  const r = spawnSync("npx", ["vitest", "run", "apps/team/worker/api/api.cpu.use-cases.test.ts"], {
    stdio: "inherit",
    env: { ...process.env, LOAD_CPU: "1" },
  });
  process.exit(r.status ?? 1);
}
const names = asked === "all" ? Object.keys(SCENARIOS) : [asked];
if (!names.every((n) => n in SCENARIOS)) {
  console.error(`Which scenario? ${Object.keys(SCENARIOS).join(", ")} or all`);
  process.exit(2);
}

let build = !flag("--no-build");
for (const name of names) {
  const server = await startServer({ members: Number(value("--members", 120)), build });
  build = false;
  const stats = new Stats();
  const notes = [];
  try {
    await server.d1(true);
    const cpu = server.cpu();
    const t = performance.now();
    await SCENARIOS[name]({
      url: server.url,
      roster: server.roster,
      stats,
      shared: flag("--one-address"),
      notes,
      cpu: server.cpu,
      d1: server.d1,
    });
    const usage = {
      seconds: (performance.now() - t) / 1000,
      cpuMs: server.cpu() - cpu,
      d1: await server.d1(),
      notes,
    };
    console.log(report(`${name}${flag("--one-address") ? " (one address)" : ""}`, stats, usage));
    if (flag("--server-log")) console.log(`\nwrangler dev said:\n${server.output().slice(0, 6000)}`);
  } catch (e) {
    console.error(`${name} failed: ${e.stack ?? e}\n${server.output().slice(-3000)}`);
    process.exitCode = 1;
  } finally {
    await server.stop({ keep: flag("--keep") });
  }
}
