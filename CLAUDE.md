# Conventions

Architecture follows gwenda-hackney/ark, simplified. Read README.md first.

**Decisions are recorded in [docs/adr/](docs/adr/README.md), one record per topic.** Read the relevant ADR before
changing how something works. Changing a decision means updating its topic's record in the same change, with a dated
History line, never a quiet edit; a new topic (a service, a rule, a pattern, a trade-off) gets a new ADR
([ADR 0001](docs/adr/0001-record-decisions.md)).

## One task, one worktree

- The main checkout (`/src`) stays on `main`; don't edit there, it's only for merging. Start each task in its own
  worktree: `npm run worktree -- add <area>/<topic>` (e.g. `web/gallery`), ready at once ([ADR 0115](docs/adr/0115-worktrees-and-the-show-switch.md)).
  Leave other sessions' files and worktrees alone; never `git stash` or `git add -A`.
- **To show the user: `npm run app`** in your worktree: 4500/4510 switch to it at once (4520 too with `studio`).
  **For your own checks: `npm run app -- --private`**, which prints your apps' own ports
  (`node scripts/dev-sign-in.mjs --port <team port>` to sign in). `npm run app status` lists what runs; the user sees
  and restarts apps at http://localhost:4500/__app. Apps share main's local D1; a branch that changes
  `db/schema.sql` uses `--own-db`.
- Never start a server with `&`, `nohup` or `setsid`, and never stop anything on 4500/4510/4520 except through
  `npm run app`. Stop only your own processes, by PID.
- Finishing: rebase on main, then the coordinator runs `npm run merge:check -- <area>/<topic>` in the main checkout,
  `git merge --ff-only`, and `npm run worktree -- remove <area>/<topic>`. Don't push unless asked.

## Hard rules

- **Code is for people to read** ([ADR 0105](docs/adr/0105-code-grouped-by-feature.md)): group it by feature, not by
  technique, a folder per component and flat inside (`apps/team/worker/dues/`); keep entry points short, like a table
  of contents; name files `{domain}.{kind}.ts` (`dues.ts`, `dues.routes.ts`, `dues.use-cases.test.ts`). A new route
  goes in its component's `.routes.ts`, never in `api.ts`. How code reads (one job per file and function, early exits,
  domain names; lint warns) is [ADR 0125](docs/adr/0125-how-code-reads.md).

- **Free tiers only.** Don't add a paid service or binding (Cloudflare Images, Durable Objects that store rows,
  paid Sanity features, card-payment providers) without asking. Check limits in [ADR 0003](docs/adr/0003-free-tiers-only.md). A Durable Object
  that stores nothing (the live hub, ADR 0072) is fine.
- **Secrets live only in Bitwarden Secrets Manager** ([ADR 0002](docs/adr/0002-secrets-in-bitwarden.md)).
  Never print secret values, never write them to files (`.env`, `.dev.vars`), never commit them. `.env` is for
  local non-secret overrides only. GitHub holds only the Bitwarden tokens (`BWS_ACCESS_TOKEN__PRODUCTION`, `__DEV`). Use
  `npm run secrets` to see what exists (names only).
- **Every secret is documented in [docs/secrets.md](docs/secrets.md)** (by system; README.md#secrets is the short
  overview), and a provider token is named exactly like its secret. Adding or renaming a secret means updating its
  entry and the Overview table there in the same change.
- **Never deploy to production by hand.** Production deploys only from the `release` branch via
  `.github/workflows/deploy.yml`; `main` and PRs deploy dev ([ADR 0010](docs/adr/0010-environments-and-deploys.md)).
  Dev is a separate Cloudflare account (workers `web` and `team`, at `web.cougars-dev.workers.dev` and `team.cougars-dev.workers.dev`) ([ADR 0010](docs/adr/0010-environments-and-deploys.md)). Your machine is dev; production secrets are `NAME__PRODUCTION`.
- **Not live yet: no migrations.** The database is `db/schema.sql` plus `db/seed/club.sql`; change them and run
  `npm run db:rebuild:local` (dev rebuilds on deploy), which keeps the data. Production starts fresh (schema, club
  seed, its admins from `TEAM_ROSTER__PRODUCTION`) and admins import the members; migrations start at launch ([ADR 0050](docs/adr/0050-schema-and-seed-until-launch.md), db/README.md).

## Web app (apps/web)

These rules are for the website only. The team app (`apps/team`) is a Svelte 5 SPA on its own
Worker ([ADR 0022](docs/adr/0022-team-app-svelte-pwa.md)); its permissions follow
[ADR 0024](docs/adr/0024-action-based-authorization.md). The roadmap is [GitHub milestones](https://github.com/battersea-cougars/ark/milestones): new work is an issue in one ([ADR 0006](docs/adr/0006-one-repo-two-projects.md)).

- Astro 7 + `@astrojs/cloudflare` 14 (Workers with static assets, not Pages).
- Pages are prerendered (`output: "static"`). Server routes opt out with `export const prerender = false`.
- Bindings: `import { env } from "cloudflare:workers"` (e.g. `env.DB`). Execution context: `Astro.locals.cfContext`.
  Run `npx wrangler types` in apps/web after changing `wrangler.jsonc`.
- Content comes from Sanity at build time via `src/lib/sanity/content.ts`. All GROQ lives in `queries.ts`,
  types in `types.ts`. Studio schema field names must match the GROQ projections.
- SQL: plain SQL through `packages/shared/d1.ts` helpers. One module per domain under `src/lib/server/`.
- Forms must work without JavaScript (POST + 303 redirect), enhanced with fetch + JSON.
- Dates: always format in Europe/London via `src/lib/dates.ts`.
- Images: Sanity CDN via `src/lib/sanity/images.ts`; local assets in `src/assets/` (no `public/` except favicons).

## Team app (apps/team)

- **Admin actions live on the thing's own page**, opening over it (sheet, drawer, editor panel), not buried under
  Settings; Settings is for setting up and reuses the same editors ([ADR 0065](docs/adr/0065-page-frame-and-admin-actions.md)).

## Team app dev server (apps/team)

- A library the browser imports goes in apps/team `package.json` **dependencies** (not devDependencies). Vite
  pre-bundles exactly that list at startup; `scripts/team-app-deps.test.mjs` enforces it ([ADR 0022](docs/adr/0022-team-app-svelte-pwa.md)).
- One dev server per checkout, run by the show switch: `npm run team` (or `npm run dev`, `npm run studio`) shows this
  checkout and starts that app afresh; to restart, just run it again, or `npm run app restart team`. Never `--force`.

## Tests

- **Use cases first** ([ADR 0031](docs/adr/0031-use-case-tests.md), [docs/testing.md](docs/testing.md)): tests
  describe what someone does, drive the real handlers, and fake outside services in one fake world. Unit tests only
  for tricky pure logic. Known bugs stay as `it.fails("… (known bug #N)")`.
- Vitest, colocated `*.test.ts`. D1 is in-memory SQLite with all migrations applied (`packages/shared/testing/d1-sqlite.ts`).
  Don't mock our own code.
- Before pushing: `npm run lint && npm test && npm run check -w @cougars/web && npm run check -w @cougars/team && npm run build && npm run build -w @cougars/team && npm run build -w @cougars/studio` (as `pr.yml`).
- **Signed in, headless**: `node scripts/dev-sign-in.mjs [email]` (no email: the first admin) writes a Playwright
  storage state to `.auth/team.json`. Use it for every screenshot or browser check; never ask for a code (ADR 0023,
  docs/testing.md).
- **Screenshots for testing go in `.shots/`** (git-ignored) or your scratchpad, never next to the code, never
  committed (docs/testing.md).

## Ports

4500 web, 4510 team app, 4520 studio: the show switch's, showing one checkout (ADR 0115). Apps run on private
ports the OS picks; never bind the three yourself. Don't use framework default ports.
