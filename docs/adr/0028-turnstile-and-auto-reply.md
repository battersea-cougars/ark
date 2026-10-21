# 0028. Auto-replies only to people Turnstile verified, and capped

- **Status:** Accepted
- **Date:** 2026-10-06 · updated 2026-10-21

## Context

The "Try a session" form should send the enquirer an automatic reply with the session details. That email goes to
whatever address is typed in, from the club's Gmail account ([ADR 0027](0027-email-through-gmail-api.md)). A bot
could use it to make the club email strangers (form relay abuse, "backscatter"): recipients mark it as spam, the
club's mail starts landing in spam, and Gmail can suspend the account, which is also the club's public contact.

The form's existing defences don't separate people from scripts: the honeypot and validation stop only careless
bots, the per-IP rate limit is beaten by rotating addresses (and is off on workers.dev), and Astro's origin check
stops cross-site request forgery, not scripts. A session or signed token proves only that the page was fetched first.
The form must still work without JavaScript.

## Decision

- **Cloudflare Turnstile** (free, unlimited, no cookies) on `/join`. The server checks its token once with
  Cloudflare (`packages/shared/turnstile.ts`) and saves the answer on the enquiry (`enquiries.verified`). One widget per
  Cloudflare account: dev's workers.dev address, and batterseacougars.com.
- A failed or missing check (a bot, or JavaScript off) **doesn't block** the enquiry: it's saved and the club is
  emailed, with a note that no automatic reply went out. The club answers those by hand.
- **The auto-reply** (`lib/server/auto-reply.ts`) goes only to verified enquiries, and only within **caps**, whatever
  gets past Turnstile: at most 20 a day across the site, and one per address per 7 days (`auto_replied_at`).
- It repeats nothing the sender wrote except a first name that looks like a name (otherwise "there"), and states only
  the site's facts from the Studio (session day and times, venue, kit notes). Replies go to the club inbox.

## Consequences

- Worst case, a determined spammer (for example with a paid captcha-solving service) makes the club send 20 harmless
  emails a day. Raising the caps is a code change.
- The club's notification email says whether the person has had the automatic reply.
- Two new secrets (`TURNSTILE_SECRET_KEY`, `__PRODUCTION`) and two public site keys in `deploy.yml`. Without the
  secret, nobody counts as verified and no auto-replies are sent; enquiries and the club's email carry on.
- The privacy page mentions Turnstile and the confirmation email.

**The team app** (#13) puts the same widgets (the account's one, whose hostnames cover `team.`) in front of the two
things anyone can do there without signing in: asking for a sign-in code and asking to join. Unlike the website's
form, those need JavaScript anyway, so a failed check **refuses** (403, nothing stored or sent):

- The widget is managed and **interaction-only**: invisible unless Cloudflare wants a tap. It renders as the form
  shows (`apps/team/src/lib/turnstile.ts`), the token goes in the body as `turnstile`, and it's reset after each
  send. Each is rendered for its own action (`sign-in`, `join`), checked on the server, so one form's token can't be
  spent on the other.
- The Worker checks it (`worker/auth/auth.turnstile.ts`, the shared `verifyTurnstile`) with the visitor's address.
  Cloudflare unreachable: refused, as a failed check. **No secret** (your machine, the tests, no site key either): no
  check, as on the website; a deployed production server without one refuses sign-in and logs an error to Sentry,
  since that's a deploy gone wrong.
- **App Review's address** ([0108](0108-store-apps.md)) skips it: its code is fixed and never emailed, so there's no
  inbox to protect, and a reviewer in a simulator shouldn't meet a challenge.
- The CSP allows Turnstile's script and frame from `challenges.cloudflare.com`, nothing else
  ([0036](0036-api-security.md)); the iPhone app lists that domain among its app-bound domains so the frame loads.
- `TURNSTILE_SECRET_KEY` (and `__PRODUCTION`) is pushed to the `team` Worker too, and the site key is built into the
  app (`VITE_TURNSTILE_SITE_KEY`, deploy.yml).
- Asking to join: a full list (50 waiting) is a 429 for everyone, member's email or not, so it gives no one away;
  a request nobody answers is forgotten after 30 days (the hourly cron, `retention.ts`), so the list never fills for
  good.

## History

- 2026-10-06: Auto-replies only to people Turnstile verified, and capped.
- 2026-10-21: The team app's sign-in and Ask to join use the same widgets, refusing a failed check; App Review's
  address skips it; a full join list is the same for everyone and unanswered requests go after 30 days (#13).
