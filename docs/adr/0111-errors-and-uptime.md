# 0111. Errors and down alerts go to Sentry, with nothing about a person in them

- **Status:** Accepted
- **Date:** 2026-10-18 · updated 2026-10-18

## Context

Nothing told us when something broke: an error was a line in Workers Logs that nobody read, and a member would be the
first to notice the site or the app was down. We want an email for a new error in production, from the servers and
from the browsers, and another when the website or the team app stops answering. It has to be free (ADR 0003), simple
enough that whoever opens it sees at once what's wrong and who's told, and it must never carry a member's details.

Better Stack was tried first (100k errors and 10 monitors free) and dropped: who gets an alert hangs on on-call
schedules that lead to paid plans, and the error tracking sits under an AI product. Sentry's free Developer plan is
smaller (5k errors a month, one user) but plain about it.

## Decision

- **Sentry**, organisation `battersea-cougars` in the **EU region**, free Developer plan. Its one user is the developer
  Gmail account, which forwards the alerts to whoever needs them. `scripts/sentry-setup.mjs` makes everything through
  the API, and running it again changes nothing that's right: projects `web` and `team`, the alert, the DSNs into
  Secrets Manager (not the repo), and with `--uptime` the monitors.
- **One alert:** an email on a new issue whose event says `environment: production`, in either project. Sentry's own
  default alert is never made. Dev's errors are kept and visible, but tell nobody.
- **Servers:** each Worker is wrapped in `@sentry/cloudflare`'s `withSentry` (`apps/web/src/worker.ts`,
  `apps/team/worker/index.ts`), so an error nothing caught is reported, and every `error` or `fatal` log line is
  reported through scribe's reporter (`packages/shared/scribe.sentry.ts`, ADR 0110). Environment from `SITE_ENV`,
  release from the deploy's build version (`BUILD_VERSION`, set by `scripts/ci/target.mjs`). No DSN (your machine,
  tests): Sentry is off.
- **The team app in the browser** (and the store app, which loads it): `@sentry/svelte`, loaded beside the club's data
  only in a build with a DSN. It sends through the team Worker's `/api/errors` (`packages/shared/sentry-tunnel.ts`): the
  app's CSP allows only its own origin, ad blockers leave that address alone, and the tunnel passes on only envelopes
  for our project, only from our pages. Old code after a deploy (it reloads itself) isn't reported.
- **The website in the browser** loads no SDK (it would add about 25 KB to every page for three small scripts). A
  catcher of a few lines, first in `<head>` (`layouts/Base.astro`), posts each distinct uncaught error once, by
  `sendBeacon`, to `/api/client-error`. The Worker keeps only reports with a frame from our own `/_astro/` scripts
  (not an extension, another site's script, or a cross-origin "Script error."), ten per visitor per ten minutes, and
  sends each as a Sentry event under the deploy's release (`lib/server/client-errors.ts`).
- **Nothing about a person:** Sentry 11's `dataCollection` is all off (`DATA_COLLECTION`): no request bodies (the join
  form), cookies, headers, query strings (the team app's `?email=`), SQL values or stack variables, no user. Every event
  is cleaned by `beforeSend` the same way as a log line: secrets and phones by key, email addresses masked anywhere.
  No tracing, no session replay.
- **Readable stacks:** both builds write hidden source maps; the deploy uploads them for the build's release
  (`sentry-cli`, `SENTRY_AUTH_TOKEN`) and deletes every `.map` before the files go live. A PR preview only deletes them.
- **Down alerts:** Sentry uptime monitors, every 10 minutes, on the website's `/health` and the team app's `/api/health`
  (`sentry-setup.mjs --uptime`), once both answer past the Access gate (#105). A failure opens an issue in production,
  so the same alert emails.

## Consequences

- An error in production is an email within minutes, with a stack that points at our code.
- 5k errors a month is plenty once quiet; a loop that throws could use it up, after which Sentry drops events until the
  month turns (the log still has them).
- One user: anyone else who needs to look signs in as the developer account, or reads the forwarded email.
- The website's catcher sees uncaught errors only; code that catches its own error and wants it known calls
  `reportError(e)`.

## History

- 2026-10-18: Sentry for errors and down alerts, EU region, one alert for production; Better Stack tried and dropped.
- 2026-10-18: Uptime checks every 10 minutes, not every minute: a down site is known soon enough, and it's about 290
  requests a day instead of 2,900 (#16).
