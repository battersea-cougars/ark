# 0110. The apps log through scribe: one JSON line per event, nothing private in it

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

Both Workers wrote to the log with `console.*`, by convention one hand-built JSON line per event
(`{ event: "enquiry.created", … }`), but not always (a plain sentence in the web cron, a bare `console.error(e)` in the
team API). Errors were flattened with `String(e)`, which loses the stack and the cause. Nothing kept email addresses
out of a line. And to report errors (ADR 0111) every catch would have needed a second call.

The developer's decohere project has a logging facade, scribe, that we like: a named logger, levels, fields, and one
adapter deciding where lines go. Its packages need Node (Pino), so the Workers can't use them as they are.

## Decision

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
- **Every error or fatal line is also reported** to the reporter (Sentry, ADR 0111), with the Error it carries, if
  any, and its fields. Warnings aren't: they're the expected, degraded paths (a stale cache, a paused source,
  ADR 0055).
- **`no-console` is an error** in `apps/web/src`, `apps/team/src`, `apps/team/worker` and `packages/shared`.
  The scripts under `scripts/` print plain text: that's a person reading a terminal.
- **In a test**, `captureLogs()` (`packages/shared/testing/scribe.ts`) keeps the lines as entries and prints nothing.

## Consequences

- Logging an error is reporting it: there's no second call to forget.
- A log line can't carry a member's email address, even in an error message from Google.
- A new field name that's private (a new kind of secret) has to be added to scribe's list.
- Masking loses the address in the dev mail log (`mail.redirected`): it shows the domain, enough to tell who it was
  meant for.

## History

- 2026-10-17: Scribe, in decohere's shape, made for Workers; every `console.*` in the apps moved to it. The same day,
  the JSON console logger moved out of the facade into `scribe.console.ts`.
