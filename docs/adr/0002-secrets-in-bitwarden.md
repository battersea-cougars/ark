# 0002. Secrets live in Bitwarden, in two projects shared by every app; `.env` is local overrides only

- **Status:** Accepted
- **Date:** 2026-10-05 · updated 2026-10-24
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

1. **Bitwarden Secrets Manager is the only store for the secrets our code reads.** CI and scripts load them at run
   time (`scripts/lib/bitwarden.mjs`, `scripts/env-pull.mjs`), including one a provider lets us download only once.
   **A recovery copy of a key no code reads** (the Apple push key, which only Firebase uses) is kept too, but in the
   club's Bitwarden **vault** (Password Manager, an organisation item), not Secrets Manager: env-pull exports every
   Secrets Manager value into every CI job, and a key nothing reads has no business there. Either way it's
   documented in docs/secrets.md, its _Used by_ saying it's a backup.
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
7. **Every secret is documented in [docs/secrets.md](../secrets.md)**, by system (as Ark's
   `docs/env-reference.md`), and within each system by environment (production, dev, both): why it exists (what
   breaks without it), where it comes from (the provider and the account or page it's made or found in; "we make it"
   for our own keys), its permissions, who uses it (_Used by_ records which app, since project names don't), how it
   gets there, whether it expires, and how to change it; then one Overview table of every name. It opens with how secrets work, in short
   ([How secrets work](../secrets.md#how-secrets-work)); the README only links to it. A secret that isn't in
   docs/secrets.md shouldn't exist.
8. **One exception: a token a Worker has to write.** A Worker can't write to Bitwarden, so a token that the app
   itself makes or renews is kept in D1 (`sealed_tokens`), sealed in the Worker (AES-GCM, `packages/shared/sealed-tokens.ts`)
   with a key of its own that is itself a Bitwarden secret. Its first value is in Bitwarden; if the sealed one won't
   open, the Worker falls back to that and logs an error. Two tokens, and only these, may be kept this way:
   - Instagram's, which lasts 60 days and is swapped for a fresh one by the website's cron
     ([ADR 0016](0016-photos-and-videos-read-live.md)): read-only, for public content.
   - Gmail's send-only token, which an admin reconnects in the team app when Google cancels it
     ([ADR 0027](0027-email-through-gmail-api.md)). It can send mail as the developer account (not read it), so it
     is the more powerful of the two; it's allowed because otherwise sign-in stops until a developer runs a script
     and deploys. Bitwarden keeps the client and the first token, which is how a developer gets back in.

   Anything else a Worker would write stays out: ask first.

9. **A value that isn't secret is committed, not stored.** An ID that is on a dashboard, in a URL or in browser code
   anyway (an account's ID, an API key's ID, the team app's Sentry DSN) lives in committed config, one copy:
   `scripts/lib/settings.mjs`, which env-pull hands to every command and CI job beside the secrets under the same
   names, or a Worker var. One that is personal data (an email address) stays in Secrets Manager though it isn't
   secret, because this repo is public.
10. **Every commit is scanned for secrets** with [gitleaks](https://github.com/gitleaks/gitleaks) (#104), so one
    that slips into a commit is caught before the public repo has it: a PR's commits in `pr.yml`, a branch's in
    `npm run merge:check` (before it reaches `main`), the whole history on every push to `main` and weekly
    (`secrets.yml`), and `npm run secrets:scan` by hand. Its rules are gitleaks' own plus ours for formats they miss
    (Bitwarden access tokens, Sanity tokens, Google's refresh tokens and client secrets, Turnstile's secret key);
    what it lets through is in `.gitleaks.toml`, each with why. It always redacts what it finds. The binary is a
    pinned release checked against its checksum (`scripts/secrets-scan.mjs`), not `gitleaks-action`, which needs a
    licence key for an organisation's repo. A find means rotating the secret first, then taking it out of history.

## Consequences

- No secret files to leak. Running something that needs secrets locally is `node scripts/env-pull.mjs -- <command>`,
  which defaults to dev. `npm run secrets` lists what exists, names only.
- Adding a secret is three steps, every time: create the token with the SM name, add it to SM, add its entry to
  docs/secrets.md.
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
- 2026-10-20: One exception: Instagram's self-renewing token is kept in D1, sealed with a Bitwarden key ([ADR 0016](0016-photos-and-videos-read-live.md)).
- 2026-10-21: Bitwarden is also the recovery store: every secret we make goes in, even one only a provider uses (the APNs
  key Firebase holds), not only those our code reads.
- 2026-10-22: The exception widens to one more token: Gmail's, reconnected by an admin in the team app and sealed in
  D1 with `GMAIL_TOKEN_KEY`, so email can be fixed without a terminal or a deploy (#101, [ADR 0027](0027-email-through-gmail-api.md)).
- 2026-10-22: The documentation moves from the README to docs/secrets.md, grouped by system as Ark does it, each
  entry with its owner and expiry, plus an Overview table and the not-secret values listed apart; the README keeps a
  short overview.
- 2026-10-23: docs/secrets.md is laid out by system, then by environment, each entry saying where it comes from
  (not an "owner"); the README keeps only how secrets work and a link per system.
- 2026-10-23: The recovery copy of a key no code reads (the Apple push key) moves from Secrets Manager to an item in
  the club's Bitwarden vault, so env-pull stops exporting it into every CI job; point 1 covers only what code reads.
- 2026-10-23: IDs that aren't secret leave Bitwarden for committed config (`scripts/lib/settings.mjs`, exported by
  env-pull): both Cloudflare account IDs, the Apple team ID, the App Store Connect key's ID and issuer, and the team
  app's Sentry DSN (point 9). The Gmail Desktop client goes: the Web client makes and refreshes both tokens
  ([ADR 0027](0027-email-through-gmail-api.md)).
- 2026-10-23: How secrets work, in short, moves from the README into docs/secrets.md, so the README is only what
  the project is and how to start (#148).
- 2026-10-24: Every commit is scanned for secrets with gitleaks: a PR's, a branch's before merging, the whole history
  on every push to `main` and weekly; the full history was clean, with three kinds of public values let through
  (#104).
