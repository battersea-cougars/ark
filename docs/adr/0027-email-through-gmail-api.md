# 0027. Email goes through the Gmail API, reaching only the safe inbox outside production; Turnstile guards what anyone can do signed out

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-11-02
- **Merges:** 0028, 0077

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
  tool ([0010](0010-environments-and-deploys.md)), for whoever holds `manage:Settings`: add and take off
  addresses on the list; it takes effect at once, with no deploy. The bootstrap says whether it's there (`devTools`).
  Changes are on the audit log as `dev_mail.changed` ([0024](0024-action-based-authorization.md)).
- **In production none of this exists,** nor on a deploy that doesn't say where it is: the routes answer 404. In
  production the list is never read.

**Turnstile guards what anyone can do without signing in**

- **Cloudflare Turnstile** (free, no cookies) is in front of the website's join form and the team app's two open
  doors: asking for a sign-in code and asking to join. One widget per Cloudflare account. Each form's token is
  rendered and checked on the server for its own action (`enquiry`, `sign-in`, `join`; `packages/shared/turnstile.ts`),
  so one form's token can't be spent on another.
- **On the website a failed check doesn't block**: the form must work without JavaScript, so the enquiry is saved and
  the club emailed, but an automatic reply goes only to someone Turnstile verified, and only within caps, so the
  worst a spammer can do is make the club send a few harmless emails a day
  ([the join form notes](../../apps/web/src/lib/server/README.md)).
- **In the team app a failed check refuses** (403, nothing stored or sent): those forms need JavaScript anyway. The
  widget is interaction-only, invisible unless Cloudflare wants a tap. App Review's fixed address skips it
  ([ADR 0108](0108-store-apps.md)).
- **No secret, no check**: on your machine and in the tests nobody counts as verified on the website and the team
  app doesn't check ([ADR 0134](0134-a-fresh-clone-runs-after-npm-install.md)); a deployed production team app
  without one refuses sign-in and reports it, since that's a deploy gone wrong.

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
