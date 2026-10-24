# 0110. The apps log through scribe, one JSON line per event; errors and down alerts go to Sentry; nothing private in either

- **Status:** Accepted
- **Date:** 2026-10-17 · updated 2026-10-24
- **Merges:** 0111

## Context

Both Workers wrote to the log with `console.*`, by convention one hand-built JSON line per event
(`{ event: "enquiry.created", … }`), but not always (a plain sentence in the web cron, a bare `console.error(e)` in the
team API). Errors were flattened with `String(e)`, which loses the stack and the cause. Nothing kept email addresses
out of a line. And to report errors every catch would have needed a second call.

The developer's decohere project has a logging facade, scribe, that we like: a named logger, levels, fields, and one
adapter deciding where lines go. Its packages need Node (Pino), so the Workers can't use them as they are.

Nothing told us when something broke: an error was a line in Workers Logs that nobody read, and a member would be the
first to notice the site or the app was down. We want an email for a new error in production, from the servers and
from the browsers, and another when the website or the team app stops answering. It has to be free (ADR 0003), simple
enough that whoever opens it sees at once what's wrong and who's told, and it must never carry a member's details.

Better Stack was tried first (100k errors and 10 monitors free) and dropped: who gets an alert hangs on on-call
schedules that lead to paid plans, and the error tracking sits under an AI product. Sentry's free Developer plan is
smaller (5k errors a month, one user) but plain about it.

## Decision

### Logging: scribe

- **`packages/shared/scribe.ts`** is ours, in decohere's shape: `scribe.logger("join")` gives a logger with
  `fatal | error | warn | info | debug | trace`; `scribe.configure({ adapter, level, report })` sets where lines go.
  A logger reads the configuration on every line, so one made at module level follows a later `configure()`.
- **The facade has no logger of its own** (decohere's rule: the consumer picks one). The apps' logger is
  `packages/shared/scribe.console.ts`, configured at each app's entry (`apps/web/src/worker.ts`,
  `apps/team/worker/index.ts`) and in tests (`testing/setup.ts`). Unconfigured, a line still goes to the console as is,
  with one warning. When decohere's facade runs outside Node and is public
  ([typesmiths/decohere#659](https://github.com/typesmiths/decohere/issues/659)), ours gives way to it.
- **Its argument rules are decohere's:** `log.error(err)`, `log.info("msg")`, `log.error("msg", err, { fields })`,
  `log.info("msg", { fields })`, and a plain value goes under `data`. Ours adds `log.with({ fields })` for fields
  every line of a job carries.
- **A line** is one JSON object, `{ level, name, msg, …fields }`, through the console method of its level, so
  Workers Logs shows errors as errors and can filter on any field. The message is a dotted event name
  (`enquiry.created`, `cron.failed`); the details are fields.
- **An error** is kept whole under `err`: name, message, stack, and its cause the same way.
- **Nothing private in a line:** a field named password, secret, token, otp, pw, code, authorization, cookie or
  phone is `[redacted]`, at any depth; an email address anywhere in the text is masked to its first letter and
  domain (`a…@club.org`). The mail module still redacts a mail's own secrets (a sign-in code) before it logs a mail.
- **Every error or fatal line is also reported** to the reporter (Sentry, below), with the Error it carries, if
  any, and its fields. Warnings aren't: they're the expected, degraded paths (a stale cache, a paused source,
  ADR 0055). A warning that's a failure says why it isn't reported, where that isn't plain; a read behind a circuit
  breaker logs through `logFailure` (below), a warning only while the service is paused.
- **`no-console` is an error** in `apps/web/src`, `apps/team/src`, `apps/team/worker` and `packages/shared`.
  The scripts under `scripts/` print plain text: that's a person reading a terminal.
- **In a test**, `captureLogs()` (`packages/shared/testing/scribe.ts`) keeps the lines as entries and prints nothing.

### Errors and down alerts: Sentry

- **Sentry**, organisation `battersea-cougars` in the **EU region**, free Developer plan. Its one user is the developer
  Gmail account, which forwards the alerts to whoever needs them. `scripts/sentry-setup.mjs` makes everything through
  the API, and running it again changes nothing that's right: projects `web` and `team`, the alerts, the cron
  monitor, the DSNs into Secrets Manager (not the repo), and with `--uptime` the uptime monitors.
- **Three alerts,** each an email to the organisation's members, in either project: a **new issue in production**, a
  **new issue in dev** (caught before a release takes it to members), and a **spike in production**, an issue seen more
  than 10 times in 5 minutes, new or not (at most one email an hour per issue). They go by the event's `environment`
  tag. Sentry's own default alert is never made.
- **A cron that stops is noticed:** the team Worker's hourly run checks in with a Sentry cron monitor (`team-hourly`,
  `Sentry.withMonitor` in `apps/team/worker/index.ts`); an hour without a check-in opens an issue, so the alerts email.
  The free plan has one cron monitor, so it's the hourly run (dues, the allowance check); the five-minutely run stops
  with it if the Worker's crons stop. A job that fails inside a run is reported by its own `cron.failed` line.
- **Servers:** each Worker is wrapped in `@sentry/cloudflare`'s `withSentry` (`apps/web/src/worker.ts`,
  `apps/team/worker/index.ts`), so an error nothing caught is reported, and every `error` or `fatal` log line is
  reported through scribe's reporter (`packages/shared/scribe.sentry.ts`). Environment from `SITE_ENV`,
  release from the deploy's build version (`BUILD_VERSION`, set by `scripts/ci/target.mjs`). No DSN (your machine,
  tests): Sentry is off.
- **The team app in the browser** (and the store app, which loads it): `@sentry/svelte`, loaded beside the club's data
  only in a build with a DSN. It sends through the team Worker's `/api/errors` (`packages/shared/sentry-tunnel.ts`): the
  app's CSP allows only its own origin, ad blockers leave that address alone, and the tunnel passes on only envelopes
  for our project, only from our pages. Old code after a deploy (it reloads itself) isn't reported.
- **From the first moment:** Sentry stays off the first-paint path, so `src/app/errors.early.ts`, main.ts's first import
  and a few lines with no imports, listens for errors and rejections until Sentry is up and hands them over then (20 at
  most). A start-up that fails (the "Can't reach the club's data" screen) is reported the same way, except sign-in
  (401), resting (429, ADR 0055) and old code that reloads. The same `beforeSend` sees each. A failure the app catches
  and carries on past, where carrying on would hide it (the clash question it couldn't ask, ADR 0122), goes the same
  way through `reportCaught` (handled, phase `caught`), and to the console on your machine, which the dev strip shows.
- **What a member feels is an error, not a warning**: the live hub not hearing of a change (phones stay
  stale until their next check), the free allowance unreadable (nobody would be warned before it runs out). A 500 says
  its method, path, route and the member's number (never their name or email).
- **The website in the browser** loads no SDK (it would add about 25 KB to every page for three small scripts). A
  catcher of a few lines, the first script in `<head>` (`src/scripts/head.js`, a file so the content security policy
  needs no inline exception, [0036](0036-api-security.md)), posts each distinct uncaught error once, by
  `sendBeacon`, to `/api/client-error`. The Worker keeps only reports with a frame from our own `/_astro/` scripts
  (not an extension, another site's script, or a cross-origin "Script error."), ten per visitor per ten minutes, and
  sends each as a Sentry event under the deploy's release (`lib/server/client-errors.ts`). What the content security
  policy refuses arrives at `/api/csp-report` and goes to Sentry as a warning, one issue per kind of refusal
  (`lib/server/csp-reports.ts`).
- **Nothing about a person:** Sentry 11's `dataCollection` is all off (`DATA_COLLECTION`): no request bodies (the join
  form), cookies, headers, query strings (the team app's `?email=`), SQL values or stack variables, no user. Every event
  is cleaned by `beforeSend` the same way as a log line: secrets and phones by key, email addresses masked anywhere.
  No tracing, no session replay.
- **Seen in the app, too: Settings → Errors** (`read:Errors`; admins through `manage:all`), in System beside Usage,
  not in Dev tools, which production doesn't have (ADR 0123). For each project, team app and website, the open issues
  in this environment from the last 14 days, newest first, ten at most: the title, how often and to how many, when
  last, where (Sentry's culprit: the route or function), each a link to it in Sentry. The team Worker reads them
  (`settings/errors.ts`, `GET /api/sentry/issues`) with a read-only token, `SENTRY_ISSUES_TOKEN` (Issue & Event: Read),
  never the deploy's. Sentry is asked at most every five minutes, whoever opens the page: its answer, or that it
  failed, is kept in one D1 row (`sentry_issues`), so a page opened costs about 4 D1 calls and, every five minutes,
  two subrequests. Down or refusing, the page says so calmly and keeps the last answer on show (ADR 0055); that's a
  warning in the log, as an error would go to the Sentry that just didn't answer. Titles are masked again on the way.
  A push to admins on a new issue or a spike belongs with the admins' usage pushes
  ([#157](https://github.com/battersea-cougars/ark/issues/157)); until then the alerts email.
- **Every caught failure is an error or deliberately not**: an error line is reported; a warning says why
  it isn't where that's not plain (a limit or a check working, a stale copy served, an event Sentry gets by itself).
  A read through a circuit breaker logs with `logFailure` (`packages/shared/breaker.ts`): an error, but a warning when
  it failed only because the service is paused, since the failures that paused it were reported and the pause was
  logged once; the website's Sanity, YouTube and Instagram reads no longer send an event per visitor while paused.
- **Readable stacks:** both builds write hidden source maps; the deploy uploads them for the build's release
  (`sentry-cli`, `SENTRY_AUTH_TOKEN`) and deletes every `.map` before the files go live. A PR preview only deletes them.
- **Down alerts:** Sentry uptime monitors, every 10 minutes, on the website's `/health` and the team app's `/api/health`
  (`sentry-setup.mjs --uptime`), once both answer past the Access gate (#105). A failure opens an issue in production,
  so the same alert emails.

## Consequences

- Logging an error is reporting it: there's no second call to forget.
- A log line can't carry a member's email address, even in an error message from Google.
- A new field name that's private (a new kind of secret) has to be added to scribe's list.
- Masking loses the address in the dev mail log (`mail.redirected`): it shows the domain, enough to tell who it was
  meant for.
- An error in production is an email within minutes, with a stack that points at our code.
- 5k errors a month is plenty once quiet; a loop that throws could use it up, after which Sentry drops events until the
  month turns (the log still has them).
- One user: anyone else who needs to look signs in as the developer account, or reads the forwarded email.
- The website's catcher sees uncaught errors only; code that catches its own error and wants it known calls
  `reportError(e)`.

## History

- 2026-10-17: Scribe, in decohere's shape, made for Workers; every `console.*` in the apps moved to it. The same day,
  the JSON console logger moved out of the facade into `scribe.console.ts`.
- 2026-10-18: Sentry for errors and down alerts, EU region, one alert for production; Better Stack tried and dropped
  (was 0111).
- 2026-10-18: Uptime checks every 10 minutes, not every minute: about 290 requests a day instead of 2,900 (#16).
- 2026-10-20: The browser catcher moved into `src/scripts/head.js`; policy refusals are reported too (#78).
- 2026-10-21: Start-up failures reported, and errors before Sentry is up held for it (`errors.early.ts`); alerts for a
  new issue in dev and a spike in production; a cron monitor on the hourly run (#32). The live hub's failure and an
  unreadable allowance are errors; a 500 names its route and member (#75).
- 2026-10-23: Settings → Errors shows each project's open issues, read at most every five minutes with a read-only
  token and kept in D1. Every warn and error line checked (#148): warnings say why they aren't reported, a breaker's
  read reports through `logFailure`, YouTube's failure is an error.
- 2026-10-24: `reportCaught` for a failure the app catches and carries on past (the clash question it couldn't ask):
  to Sentry as handled, phase `caught`, and the console (the dev strip) on your machine (was in 0111).
- 2026-10-24: ADR 0111 (errors and uptime) merged in.
