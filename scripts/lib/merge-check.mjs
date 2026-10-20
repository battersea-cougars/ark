// What a branch's diff asks of `npm run merge:check` (scripts/merge-check.mjs, ADR 0115): pure, tested beside it.
//
// Every non-docs change runs lint and the whole test suite (one fake world, and fast). The checks and builds are the
// pre-push list (CLAUDE.md, Tests, as pr.yml), narrowed to the apps a diff can reach: the team app imports the
// website's code (its tests and checks read apps/web/src), so a website change checks both; nothing imports the team
// app or the Studio, so a change inside one checks that one. Anything outside the apps (packages/, scripts/, db/,
// root config, CI) reaches every app and runs everything.

export const STEPS = {
  lint: { name: "lint", cmd: ["npm", "run", "lint"] },
  test: { name: "test", cmd: ["npm", "test"] },
  checkWeb: { name: "check website", cmd: ["npm", "run", "check", "-w", "@cougars/web"] },
  checkTeam: { name: "check team app", cmd: ["npm", "run", "check", "-w", "@cougars/team"] },
  buildWeb: { name: "build website", cmd: ["npm", "run", "build"] },
  buildTeam: { name: "build team app", cmd: ["npm", "run", "build", "-w", "@cougars/team"] },
  buildStudio: { name: "build Studio", cmd: ["npm", "run", "build", "-w", "@cougars/studio"] },
};

/** What a change to each app reaches. */
const REACHES = {
  web: ["checkWeb", "buildWeb", "checkTeam", "buildTeam"],
  team: ["checkTeam", "buildTeam"],
  studio: ["buildStudio"],
};

/** A file that holds no code: docs, and Markdown anywhere but the apps' source. */
export const isDocs = (file) =>
  file.startsWith("docs/") || (file.endsWith(".md") && !file.startsWith("apps/") && !file.startsWith("packages/"));

/** The app a file belongs to, or "shared" when it reaches every app. */
export const areaOf = (file) => file.match(/^apps\/(web|team|studio)\//)?.[1] ?? "shared";

/** The tier a diff runs: none, docs (a format check), or the steps it reaches (always lint and test first). */
export function plan(files) {
  if (!files.length) return { tier: "none", steps: [] };
  const code = files.filter((f) => !isDocs(f));
  if (!code.length) return { tier: "docs", steps: [] };
  const areas = new Set(code.map(areaOf));
  const keys = areas.has("shared") ? Object.keys(STEPS).slice(2) : [...areas].flatMap((a) => REACHES[a]);
  const steps = ["lint", "test", ...Object.keys(STEPS).filter((k) => keys.includes(k))];
  return { tier: areas.has("shared") ? "full" : [...areas].sort().join("+"), steps };
}
