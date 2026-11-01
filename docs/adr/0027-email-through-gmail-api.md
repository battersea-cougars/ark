# 0027. Email goes through the Gmail API; outside production it reaches only the safe inbox, admins and a dev list

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-10-24
- **Merges:** 0077

## Context

The club should hear about each "Try a session" enquiry by email, and the team app emails sign-in codes, invites and
usage warnings. The club can't spend money and has no Google Workspace: its inbox is a consumer Gmail
account, and until 2026-10-06 there was no domain. The free options (researched 2026-10-06):
Cloudflare Email Routing only sends to verified addresses; Resend, Brevo and MailChannels need a domain; Cloudflare's
outbound Email Service needs Workers Paid; SMTP from Workers was unreliable for Gwenda, who moved to the Gmail API.

Gwenda (gwenda-hackney/ark) also learned that a non-production environment must never email a real person, and that
the environment check must fail safe. But if every email on dev goes to one safe inbox, nobody can sign in on dev
with their own inbox, and changing a secret to fix that needs a deploy each time.

## Decision

**Sending**

- Email is sent with the **Gmail API** over HTTPS (`packages/shared/email.ts`, for the website and the team app), authorised by
  an **OAuth refresh token** with the send-only scope, from the club's Google Cloud project _Battersea Cougars_ (owned
  by the developer Gmail account). Setup and its secrets: [docs/secrets.md#gmail](../secrets.md#gmail). Gmail
  sits behind a circuit breaker ([0055](0055-degrade-instead-of-break.md)).
- **One sending account, two faces.** Every environment sends from the developer Gmail account, with
  one token (`GMAIL_REFRESH_TOKEN`). Production's From is the club's address (the Studio's Club → Contact email), a verified
  "Send mail as" alias of that account, so emails read as the club and replies go to its inbox; elsewhere the
  account is its own sender. Nothing holds a token for the club account, so resetting its password breaks nothing.
  `scripts/gmail-auth.mjs` refuses the club account ([0002](0002-secrets-in-bitwarden.md)).
- Every email has a plain-text body; it may carry an HTML version too (`multipart/alternative`), with inline styles
  and no images.
- The enquiry is saved first; the email goes out after the response (`waitUntil`). A failed email is logged and never
  loses the enquiry.

**When Google cancels the token** (#101)

- Google cancels the refresh token when the developer account's password changes, its access is removed, or it goes
  unused for 6 months. Then every email fails, sign-in codes too. An admin fixes it from the team app, in a minute,
  with no terminal, no Bitwarden and no deploy.
- **Status: Settings → Email** (`manage:Settings`): the sending account, the From address (the club's alias in
  production), how the token got there (at set-up, or reconnected when and by whom), and the last send or the first
  failure since, with why. Both Workers write it as they send (`packages/shared/mail-health.ts`, one row,
  `mail_health`; a working send at most every 5 minutes). A cancelled token (Google's `invalid_grant`) is told
  apart from Gmail being busy or rate-limiting (the breaker, [0055](0055-degrade-instead-of-break.md)), which passes
  by itself, and from any other failure.
- **Telling the admins:** the send that first finds the token cancelled sends the holders of `manage:Settings` a
  notification ([0108](0108-store-apps.md), topic `email`, shown only to them), and while it stays cancelled Home's
  _For admins_ leads with "Email has stopped". It comes with the club (the bootstrap's `forAdmins`, only to them), so
  it's there on first paint rather than pushing the page down; a change to the failure moves the club's data version
  on in the same round trip (`packages/shared/mail-health.ts`), so the next open reads it rather than a 304.
- **Reconnect email**, on that page: OAuth's code flow with PKCE, for a _Web application_ client
  (`GMAIL_WEB_CLIENT_ID`), whose redirect URIs are the team app's `/api/mail/callback` in production and dev. The
  state and verifier go in a 10-minute cookie, so Google's answer counts only in the browser that asked, and once.
  It must grant _Send email on your behalf_ and must not be the club's account; otherwise nothing is saved and the
  page says why. The new token is kept in D1 (`sealed_tokens`, row `gmail`), sealed with `GMAIL_TOKEN_KEY`
  ([0002](0002-secrets-in-bitwarden.md) point 8), and it wins over the deployed `GMAIL_REFRESH_TOKEN` in both
  Workers from the next email (`packages/shared/gmail-token.ts`). If it won't open, the deployed one is used and an
  error is logged. Each environment has its own D1 and key, so reconnecting dev can't touch production. On the audit
  log as `mail.reconnected`. Google won't sign in inside the store app's web view, so it's done from a browser.
- **Signing in while email is down:** passkeys are the way in (team/passkeys); the admin needs no code to reach
  the button. With no admin able to sign in, `scripts/gmail-auth.mjs` is the terminal fallback, then a deploy.
  `gmail-auth.mjs` otherwise stays only for the first token. It uses the same Web client as reconnecting (its
  redirect `http://localhost:4590/` is one of that client's authorised redirect URIs), so there's one client, and
  the deployed token refreshes with it too.

**Who receives it** (`safeMail`, run on every send)

- Production means `SITE_ENV` is exactly `production`, set only by `target.mjs` on `release`; `wrangler.jsonc`
  defaults to `dev`, and unset is not production ([0010](0010-environments-and-deploys.md)). In production real
  recipients always get their email.
- Anywhere else, an email goes to its real recipients only when **every one** of them is allowed. Otherwise the whole
  email goes to one safe address: `MAIL_SAFE_TO`, or the sending account itself (dev sends to the developer account). Either way
  the subject names the environment and the real recipients, and `X-Cougars-Original-To` carries them.
- Allowed outside production, for the team app's emails only: everyone active who can do everything (a role holding
  `manage:all`, whatever it's called, ADR 0024; so they can sign in and get to Dev tools), plus the addresses in
  `dev_mail_recipients`. The website's emails still go to the safe inbox only.
- A sign-in code that goes to its member outside production also goes to the safe inbox as a copy, just in case
  (one already sent there isn't sent twice).
- The club's inbox is never allowed, and is refused as the safe address and as the sending account outside
  production.
- With no Gmail secrets (a laptop, tests) the email is logged, not sent.

**Dev tools**

- **Settings → Dev tools** exists only where the environment says dev or local, failing closed like every dev-only
  tool ([0123](0123-dev-only-tools.md)), for whoever holds `manage:Settings`: add and take off
  addresses on the list; it takes effect at once, with no deploy. The bootstrap says whether it's there (`devTools`).
  Changes are on the audit log as `dev_mail.changed` ([0095](0095-audit-log.md)).
- **In production none of this exists,** nor on a deploy that doesn't say where it is: the routes answer 404. In
  production the list is never read.

## Consequences

- Free, about 500 emails a day, no domain needed, and replies go from an address members know.
- The app is unverified (Google warns on the consent screen), which is fine for one account. It must stay
  **In production** in Google Auth Platform: in Testing, tokens expire after 7 days.
- A password change on the developer account, removing its access, or 6 months unused cancels the token: emails then fail
  (logged, e.g. `enquiry.email_failed`) until an admin reconnects (or `gmail-auth.mjs` is re-run and deployed).
  Enquiries are still saved. Code sign-in stops until then ([0023](0023-sign-in-and-sessions.md)); the admins hear of
  it from the app. The club account's password can change freely.
- The token that sends as the developer account can live in D1, sealed. Someone with both the database and the
  Worker's key could send mail as that account (not read it); revoking it is one click in the account's third-party
  access, and the next reconnect replaces it.
- One OAuth client, the Web one, for both `gmail-auth.mjs` and reconnecting. A refresh token works only with the
  client that made it, so changing the client means making the deployed token again (`gmail-auth.mjs`).
- Production's mail depends on the developer account, so it's kept for sending only and the team account co-owns its
  Google Cloud project.
- An admin on dev can make dev email a real person, by adding them. That's the point; it's limited to
  `manage:Settings`.
- Dev's data becomes production's at launch ([0050](0050-schema-and-seed-until-launch.md)); the list comes with it but
  is ignored there.
- Once there's a domain, the club notification could move to Cloudflare Email Routing and auto-replies to Resend,
  behind the same `sendMail`.

## History

- 2026-10-06: Email goes through the Gmail API from two accounts, and outside production every recipient is replaced
  by one safe inbox (was 0027).
- 2026-10-08: Outside production, active admins and a list kept on Dev tools get their own team app email, so people
  can sign in on dev without a deploy (was 0077).
- 2026-10-09: An email may carry an HTML version beside its text, first for the sign-in code.
- 2026-10-09: The club's enquiry email gets the same branded HTML; the frame is shared (`packages/shared/email-html.ts`), and
  everything a person typed is escaped in it.
- 2026-10-09: Outside production, a sign-in code sent to its member is copied to the safe inbox.
- 2026-10-17: One sending account for every environment, as it had been in practice: production sends from
  the developer account as the club's address (a Gmail alias), so a reset of the club account's password can't stop sign-in.
- 2026-10-17: The auto-reply to someone who asks to try a session comes in the club's frame too, with a map button.
- 2026-10-17: Neither address is in the repo: the club's comes from the Studio (Club → Contact email,
  `packages/shared/club-contact.ts`), the developer account's from its token. While the club's isn't known, dev ignores
  its allow list and production sends as the developer account.
- 2026-10-17: Every website deploy smoke-tests the form for real: an enquiry marked with that deploy's own key
  (`SMOKE_TOKEN`, made at random, spent after the test, never stored) is saved, both emails go to the sending account
  only (in production too), and the row is deleted; the deploy fails unless both sent.
- 2026-10-22: An admin reconnects email from the team app when Google cancels the token: Settings → Email shows
  whether it works (a cancelled token apart from Gmail being busy), the admins hear on Home and their phones, and
  "Reconnect email" keeps a new token sealed in D1, used at once by both Workers, with no deploy. Passkeys get an
  admin in while email is down; `gmail-auth.mjs` is for the first token and the terminal fallback (#101).
- 2026-10-22: Settings → Email has "Send a test email": one email, the way every email goes (the reconnected token,
  else the deployed one, with its outcome recorded), to the admin who pressed it and nobody else (outside production
  their own address is let through for it), saying which account and token sent it and how production's From line
  reads; 5 an hour per admin, each try on the record (`mail.test_sent`). Every reconnect try is on the record too
  (`mail.reconnect_tried` with how it ended, never anything from Google's answer), and the page says the last one
  from there, not only from its address.
- 2026-10-22: The test email reads as the club's address outside production too (`Mail.asClub`, that email alone,
  which only ever goes to the admin who asked), so the "Send mail as" alias is checked before launch; it says what
  a From line showing the sending account means.
- 2026-10-23: One OAuth client: `gmail-auth.mjs` uses the Web client (redirect `http://localhost:4590/`), and the
  deployed token refreshes with it, so the Desktop client and its two secrets go (`GMAIL_CLIENT_ID`,
  `GMAIL_CLIENT_SECRET`). The deployed token is made again with the Web client before the Desktop one is deleted.
- 2026-10-23: Home's "Email has stopped" comes with the club's first read instead of a request after Home opens, so
  nothing moves when it arrives (#148); recording a change to the failure, or a reconnect, moves the data version on.
- 2026-10-23: Outside production, "the admins" who get their own email are everyone whose roles hold `manage:all`,
  not members of the role named Admin, so a custom or renamed role that can do everything can sign in on dev too (#44).
- 2026-10-24: Dev tools exist only where `SITE_ENV` says dev or on your own machine, not wherever it doesn't say
  production: a deploy that skipped `target.mjs` showed them (#81, [0123](0123-dev-only-tools.md)).
- 2026-10-24: The privacy page says which emails go through Gmail (the enquiry reply and the club's copy, sign-in
  codes, welcomes, what members owe, admins' notices) and exactly what the apps get from Google: permission to send and
  the account's address, the permission kept encrypted until it's replaced or withdrawn; nothing read, sold or shared,
  as Google's verification of the `gmail.send` scope asks (#156).
- 2026-10-28: The form's smoke test (the real enquiry and its emails) runs on production deploys only; dev and PR
  previews check the pages and the join API without it, and the use cases cover the form. Its emails' subject names the
  environment ("[production smoke test, for …]"), so the inbox says which deploy sent them. The user's call.
