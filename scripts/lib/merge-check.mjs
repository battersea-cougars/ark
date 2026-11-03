// What a branch's diff asks of `npm run merge:check` (scripts/merge-check.mjs, ADR 0115): pure, tested beside it.
// Every non-docs change runs lint, knip (ADR 0105) and the whole test suite; the checks and builds are the pre-push
// list (CLAUDE.md, as pr.yml), narrowed to the apps the diff can reach.

export const STEPS = {
  lint: { name: "lint", cmd: ["npm", "run", "lint"] },
  knip: { name: "unused code (knip)", cmd: ["npm", "run", "knip"] },
  test: { name: "test", cmd: ["npm", "test"] },
  checkWeb: { name: "check website", cmd: ["npm", "run", "check", "-w", "@cougars/web"] },
  checkTeam: { name: "check team app", cmd: ["npm", "run", "check", "-w", "@cougars/team"] },
  buildWeb: { name: "build website", cmd: ["npm", "run", "build"] },
  buildTeam: { name: "build team app", cmd: ["npm", "run", "build", "-w", "@cougars/team"] },
  buildStudio: { name: "build Studio", cmd: ["npm", "run", "build", "-w", "@cougars/studio"] },
};

/**
 * Every tier, docs too, scans the branch's own commits for secrets first: once pushed, the public repo has them.
 * The same scan as pr.yml's, with findings redacted (scripts/secrets-scan.mjs).
 */
export const SECRETS = { name: "secrets (gitleaks)", cmd: ["npm", "run", "secrets:scan", "--", "--since", "main"] };

/**
 * What a change to each app reaches. The team app imports the website's code (its tests and checks read
 * apps/web/src), so a website change checks both; nothing imports the team app or the Studio. Anything outside the
 * apps (packages/, scripts/, db/, root config, CI) reaches every app.
 */
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

/** The tier a diff runs: none, docs (a format check), or the steps it reaches (always lint, knip and test first). */
export function plan(files) {
  if (!files.length) return { tier: "none", steps: [] };
  const code = files.filter((f) => !isDocs(f));
  if (!code.length) return { tier: "docs", steps: [] };
  const areas = new Set(code.map(areaOf));
  const keys = areas.has("shared") ? Object.keys(STEPS).slice(3) : [...areas].flatMap((a) => REACHES[a]);
  const steps = ["lint", "knip", "test", ...Object.keys(STEPS).filter((k) => keys.includes(k))];
  return { tier: areas.has("shared") ? "full" : [...areas].sort().join("+"), steps };
}
