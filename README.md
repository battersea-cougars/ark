# Battersea Cougars

The website and the team app of the Battersea Cougars, an inline hockey club in south London: two projects in one
repo ([ADR 0006](docs/adr/0006-one-repo-two-projects.md)), on free tiers only, so it runs for £0
([ADR 0003](docs/adr/0003-free-tiers-only.md)). What's planned is in
[GitHub milestones](https://github.com/battersea-cougars/ark/milestones).

| Part              | What                                                                                         | Locally               |
| ----------------- | -------------------------------------------------------------------------------------------- | --------------------- |
| `apps/web`        | The public website, batterseacougars.com: Astro on a Cloudflare Worker, content from Sanity  | http://localhost:4500 |
| `apps/team`       | The team app, team.batterseacougars.com: a Svelte PWA on its own Worker, and its store shell | http://localhost:4510 |
| `apps/studio`     | The Sanity Studio, studio.batterseacougars.com, where the club edits the website's facts     | http://localhost:4520 |
| `packages/shared` | Code both apps use (`@cougars/shared`): D1 helpers, email, logging, test fixtures            |                       |
| `db/`             | The D1 (SQLite) schema and seed, shared by both apps                                         |                       |
| `scripts/`        | The show switch and worktrees, secrets (Bitwarden), database, CI and setup scripts           |                       |

## Start

```sh
npm ci
npm run db:rebuild:local   # the local D1 database: db/schema.sql and the club seed
npm run db:seed:local      # a made-up club to work with, its admin Ada Admin
npm run dev                # the website, http://localhost:4500
npm run team               # the team app, http://localhost:4510 (sign in as admin@example.com: the code shows on screen)
npm test
```

A clean clone needs nothing else: no private files, no Sanity, no secrets. More (the ports, one worktree per task,
secrets on your machine, break glass): [docs/development.md](docs/development.md).

## Docs

[docs/](docs/README.md) has every doc, by who it's for: editing the website, the club's accounts and secrets, and
for developers how it runs and is tested. Decisions and why: [docs/adr/](docs/adr/README.md). Conventions for
contributors and AI agents: [CLAUDE.md](CLAUDE.md).
