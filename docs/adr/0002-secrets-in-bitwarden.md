# 0002. Secrets live in Bitwarden, in two projects shared by every app; `.env` is local overrides only

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-10-20
- **Merges:** 0012

## Context

We use API tokens for Cloudflare, Sanity, Google and GitHub, across local machines, CI and preview deploys. Secrets
scattered across `.env` files, GitHub secrets and provider dashboards get leaked, go stale, and nobody knows which
token is which or what breaks when one is revoked. gwenda-hackney/ark solved this with Bitwarden Secrets Manager and
one documented naming rule; we follow it.

Ark gives each app its own pair of Secrets Manager projects (`ark` / `ark-dev`, `ark/web` / `ark/web-dev`, …), so
ownership is visible in Bitwarden. We have two apps, the website and the team app, but Bitwarden's free plan allows
**3 projects** and **3 machine accounts**, and we stay on free tiers ([ADR 0003](0003-free-tiers-only.md)).

## Decision

1. **Bitwarden Secrets Manager is the only store for secrets.** CI and scripts load them at run time
   (`scripts/lib/bitwarden.mjs`, `scripts/env-pull.mjs`).
2. **Two projects, for every app:** `cougars` (production, `NAME__PRODUCTION`) and `cougars-dev` (dev `NAME__DEV`
   and shared plain `NAME` values). The production/dev split ([ADR 0010](0010-environments-and-deploys.md)) is the
   one that keeps production safe, so that is the one we keep. The third project slot stays free.
3. **One naming rule.** `NAME` applies to both environments; `NAME__PRODUCTION` / `NAME__DEV` override it for that
   one. Code only ever reads `NAME`. A production-only secret is always `NAME__PRODUCTION`, never a plain `NAME`, so
   the dev token can't see it.
4. **Three machine accounts, shared by every app:**

   | Machine account  | Reads                           | Token                          | Lives in                           |
   | ---------------- | ------------------------------- | ------------------------------ | ---------------------------------- |
   | `cougars-ci`     | both projects                   | `BWS_ACCESS_TOKEN__PRODUCTION` | GitHub environment `production`    |
   | `cougars-ci-dev` | `cougars-dev` only              | `BWS_ACCESS_TOKEN__DEV`        | GitHub environment `preview`       |
   | `cougars-local`  | both, and writes (CI read-only) | `COUGARS_LOCAL_BW_TOKEN`       | the maintainer's vault, not GitHub |

   GitHub holds only the two `BWS_ACCESS_TOKEN__*` tokens, one per environment.

5. **`.env` is for local overrides only**: non-secret settings for your own machine (for example
   `DEMO_CONTENT=true`). Never a secret. It is gitignored; `.env.example` lists what you may set.
6. **A token is named the same as its secret.** When you create a token at a provider (Cloudflare, Sanity, GitHub,
   a Bitwarden machine account), give it the exact Secrets Manager name, for example
   `CLOUDFLARE_API_TOKEN__PRODUCTION`. The provider's token list then maps one-to-one onto Secrets Manager, and
   revoking or rotating the right one is obvious.
7. **Every secret is documented in the README** ([README.md#secrets](../../README.md#secrets)): why it exists, where
   it was issued, its permissions, who uses it (the _Used by_ column records which app, since project names don't),
   how it gets there, and how to rotate it. A secret that isn't in the README shouldn't exist.
8. **One exception: a token that renews itself.** Instagram's lasts 60 days and must be swapped for a fresh one by
   something that runs by itself, which can't write to Bitwarden. Its first value is in Bitwarden; the renewed one is
   kept in D1, sealed in the Worker with a key that is itself a Bitwarden secret
   ([ADR 0113](0113-photos-from-instagram.md)). Only a read-only token for public content may be kept this way.

## Consequences

- No secret files to leak. Running something that needs secrets locally is `node scripts/env-pull.mjs -- <command>`,
  which defaults to dev. `npm run secrets` lists what exists, names only.
- Adding a secret is three steps, every time: create the token with the SM name, add it to SM, add its entry to the
  README.
- Any CI job with the production token can read every app's production secrets, not just its own. Acceptable for a
  two-app club project.
- Moving later (Teams plan) to Ark's per-app pairs is moving secrets between projects: the loader merges every project
  its token can read and looks secrets up by name, so code and secret names don't change.
- Agents must never print, write or commit secret values; they report names only.

## History

- 2026-10-05: Bitwarden is the only store, one naming rule, `.env` for local overrides, GitHub holds one
  `BWS_ACCESS_TOKEN` (0002).
- 2026-10-05: Two projects and three machine accounts shared by every app, instead of Ark's per-app pairs, to fit
  the free plan; GitHub holds one token per environment (0012).
- 2026-10-20: One exception: Instagram's self-renewing token is kept in D1, sealed with a Bitwarden key ([ADR 0113](0113-photos-from-instagram.md)).
