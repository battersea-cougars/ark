# 0027. Email goes through the Gmail API; outside production it reaches only the safe inbox, admins and a dev list

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-10-17
- **Merges:** 0077

## Context

The club should hear about each "Try a session" enquiry by email, and the team app emails sign-in codes, invites and
usage warnings. The club can't spend money and has no Google Workspace: its inbox is the consumer account
batterseahockey@gmail.com, and until 2026-10-06 there was no domain. The free options (researched 2026-10-06):
Cloudflare Email Routing only sends to verified addresses; Resend, Brevo and MailChannels need a domain; Cloudflare's
outbound Email Service needs Workers Paid; SMTP from Workers was unreliable for Gwenda, who moved to the Gmail API.

Gwenda (gwenda-hackney/ark) also learned that a non-production environment must never email a real person, and that
the environment check must fail safe. But if every email on dev goes to one safe inbox, nobody can sign in on dev
with their own inbox, and changing a secret to fix that needs a deploy each time.

## Decision

**Sending**

- Email is sent with the **Gmail API** over HTTPS (`packages/shared/email.ts`, for the website and the team app), authorised by
  an **OAuth refresh token** with the send-only scope, from the club's Google Cloud project _Battersea Cougars_ (owned
  by the developer account cougars.dev). Setup and the four secrets: [README.md#gmail](../../README.md#gmail). Gmail
  sits behind a circuit breaker ([0055](0055-degrade-instead-of-break.md)).
- **One sending account, two faces.** Every environment sends from the developer account cougars.dev@gmail.com, with
  one token (`GMAIL_REFRESH_TOKEN`). Production's From is the club's address, batterseahockey@gmail.com, a verified
  "Send mail as" alias of that account, so emails read as the club and replies go to its inbox; elsewhere the
  account is its own sender. Nothing holds a token for the club account, so resetting its password breaks nothing.
  `scripts/gmail-auth.mjs` refuses the club account ([0002](0002-secrets-in-bitwarden.md)).
- Every email has a plain-text body; it may carry an HTML version too (`multipart/alternative`), with inline styles
  and no images.
- The enquiry is saved first; the email goes out after the response (`waitUntil`). A failed email is logged and never
  loses the enquiry.

**Who receives it** (`safeMail`, run on every send)

- Production means `SITE_ENV` is exactly `production`, set only by `target.mjs` on `release`; `wrangler.jsonc`
  defaults to `dev`, and unset is not production ([0010](0010-environments-and-deploys.md)). In production real
  recipients always get their email.
- Anywhere else, an email goes to its real recipients only when **every one** of them is allowed. Otherwise the whole
  email goes to one safe address: `MAIL_SAFE_TO`, or the sending account itself (dev sends to cougars.dev). Either way
  the subject names the environment and the real recipients, and `X-Cougars-Original-To` carries them.
- Allowed outside production, for the team app's emails only: every active Admin (so they can sign in and get to Dev
  tools), plus the addresses in `dev_mail_recipients`. The website's emails still go to the safe inbox only.
- A sign-in code that goes to its member outside production also goes to the safe inbox as a copy, just in case
  (one already sent there isn't sent twice).
- The club's inbox is never allowed, and is refused as the safe address and as the sending account outside
  production.
- With no Gmail secrets (a laptop, tests) the email is logged, not sent.

**Dev tools**

- **Settings → Dev tools** exists only outside production, for whoever holds `manage:Settings`: add and take off
  addresses on the list; it takes effect at once, with no deploy. The bootstrap says whether it's there (`devTools`).
  Changes are on the audit log as `dev_mail.changed` ([0095](0095-audit-log.md)).
- **In production none of this exists:** the routes answer 404 and the list is never read.

## Consequences

- Free, about 500 emails a day, no domain needed, and replies go from an address members know.
- The app is unverified (Google warns on the consent screen), which is fine for one account. It must stay
  **In production** in Google Auth Platform: in Testing, tokens expire after 7 days.
- A password change on cougars.dev, removing its access, or 6 months unused cancels the token: emails then fail
  (logged, e.g. `enquiry.email_failed`) until `gmail-auth.mjs` is re-run. Enquiries are still saved. Sign-in stops
  everywhere until then ([0023](0023-sign-in-and-sessions.md)). The club account's password can change freely.
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
  cougars.dev as the club's address (a Gmail alias), so a reset of the club account's password can't stop sign-in.
- 2026-10-17: The auto-reply to someone who asks to try a session comes in the club's frame too, with a map button.
