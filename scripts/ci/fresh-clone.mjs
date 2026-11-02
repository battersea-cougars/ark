// A fresh clone runs after `npm ci`, with no secrets, no vault and no .env (pr.yml's fresh-clone job): the local D1
// built and seeded, the three apps built, then the website and team app started as a developer would
// (`npm run app -- --private`), signed in headless, and the made-up club's members seen through the team app's API.
// Every outside service is faked or off without its secret; this fails the moment one isn't.
//
//   node scripts/ci/fresh-clone.mjs            all of it
//   node scripts/ci/fresh-clone.mjs --no-build the apps only (a quicker local run)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const npm = (...args) => execFileSync("npm", args, { cwd: root, stdio: "inherit" });
/** `npm run app` with its output kept, to read the apps' ports from, and shown. */
const app = (...args) => {
  try {
    const out = execFileSync("npm", ["run", "app", "--", ...args], { cwd: root, encoding: "utf8" });
    process.stdout.write(out);
    return out;
  } catch (error) {
    process.stdout.write(error.stdout ?? ""); // an app that didn't start: its log's last lines
    throw error;
  }
};
const step = (what, fn) => {
  console.log(`fresh clone: ${what}`);
  return fn();
};
const fail = (why) => {
  throw new Error(`fresh clone: ${why}`);
};

step("the local D1 (schema and club seed)", () => npm("run", "db:rebuild:local"));
step("the made-up club", () => npm("run", "db:seed:local"));
if (!process.argv.includes("--no-build")) {
  step("the website's build", () => npm("run", "build"));
  step("the team app's build", () => npm("run", "build", "-w", "@cougars/team"));
  step("the Studio's build", () => npm("run", "build", "-w", "@cougars/studio"));
}

const started = step("the website and team app, privately", () => app("--private"));
try {
  const port = (label) =>
    started.match(new RegExp(`app: ${label} up: http://localhost:(\\d+)/`))?.[1] ?? fail(`the ${label} didn't start`);
  await website(`http://localhost:${port("website")}`);
  await teamApp(`http://localhost:${port("team app")}`);
  console.log("fresh clone: everything runs with no secrets");
} finally {
  app("down");
}

async function website(url) {
  const home = await fetch(url);
  if (home.status !== 200) fail(`the website's home page said ${home.status}`);
  if (!(await home.text()).includes("Cougars")) fail("the website's home page doesn't say Cougars");
}

async function teamApp(url) {
  const headers = { "content-type": "application/json", origin: url };
  // The code a member would be emailed is shown on screen instead: no Gmail here
  const start = await fetch(`${url}/api/auth/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "admin@example.com" }),
  });
  if (!(await start.json()).devCode) fail("asking for a sign-in code showed none on screen");

  const dir = mkdtempSync(join(tmpdir(), "fresh-clone-"));
  try {
    const out = join(dir, "team.json");
    execFileSync("node", ["scripts/dev-sign-in.mjs", "--url", url, "--out", out], { cwd: root, stdio: "ignore" });
    const { cookies } = JSON.parse(readFileSync(out, "utf8"));
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await fetch(`${url}/api/slices?names=members`, { headers: { cookie } });
    if (res.status !== 200) fail(`the signed-in admin's members said ${res.status}`);
    const { members } = (await res.json()).slices;
    const seeded = JSON.parse(readFileSync(join(root, "db", "seed", "roster.example.json"), "utf8")).length;
    if (!Array.isArray(members) || members.length < seeded)
      fail(`the team app shows ${members?.length ?? 0} members, not the made-up club's ${seeded}`);
    console.log(`fresh clone: signed in as the made-up club's admin, ${members.length} members`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
