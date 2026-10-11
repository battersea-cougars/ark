#!/usr/bin/env node
// Point the native shell at its server and copy it into the platform projects (ADR 0108):
//   CAP_SERVER_URL=https://team.batterseacougars.com npm run native:sync -w @cougars/team
// The offline screen needs the same address to try again, so it's written beside it from the one config.
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SERVER_URL } from "../capacitor.config.ts";

writeFileSync(new URL("server.js", import.meta.url), `window.SERVER_URL = ${JSON.stringify(SERVER_URL)};\n`);
const platforms = process.argv.slice(2).length ? process.argv.slice(2) : ["ios"];
for (const platform of platforms) {
  const res = spawnSync("npx", ["cap", "sync", platform], { stdio: "inherit" });
  if (res.status) process.exit(res.status);
}
