# Settings

The rules for the admins' Settings jobs (Usage, the audit log, Dev tools, Errors) and for how long the club keeps
things, in plain words. Each one is checked by the use-case test it links; change the rule, the test and this line
together. Why a piece of code is the way it is stays in a comment beside it.

## Usage

- The Usage page shows today's Worker requests, database rows read and written, and the live hub's requests and time,
  against the free limits, with when they reset in London time.
  [usage.use-cases.test.ts › "sees today's Worker requests, database reads and writes, and the live hub's use against the free limits, and when they reset"](usage.use-cases.test.ts)
- It shows each Worker's typical and slowest CPU time per request against the free plan's 10 ms, and how many requests
  were stopped for going over.
  [usage.use-cases.test.ts › "sees each Worker's typical and slowest CPU time per request against the free plan's 10 ms, and any stopped"](usage.use-cases.test.ts)
- It's for admins, and anyone whose role can see Usage; a member is refused.
  [usage.use-cases.test.ts › "a member is refused, and Cloudflare isn't asked"](usage.use-cases.test.ts)
- Without the read-only analytics token it says how to set it up; when Cloudflare can't be read it says so, rather
  than failing.
  [usage.use-cases.test.ts › "says how to set it up when there's no analytics token"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "says Cloudflare can't be read right now, rather than failing"](usage.use-cases.test.ts)
- It shows this month's Sanity requests as we count them, through the API and its CDN, for this environment's project,
  against the free plan and where the month's pace ends up. It needs no Cloudflare token.
  [usage.use-cases.test.ts › "sees this environment's month so far, through the API and its CDN, against the free plan, and where it's heading"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "on production, sees production's project"](usage.use-cases.test.ts)
- At 70% of a limit, and again at 90% ("Nearly spent"), each admin gets an email and a notification on their phone,
  once per limit and level that day; a member hears nothing.
  [usage.use-cases.test.ts › "at 70% each admin is emailed and their phone told, once that day; a member hears nothing"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "at 90% they're told again, once, that it's nearly spent"](usage.use-cases.test.ts)
- Passing 90% at once is one email and one notification, not 70%'s as well. Back under 70% says nothing, and the next
  day's crossing tells them again.
  [usage.use-cases.test.ts › "past 90% at once, one email and one notification, not 70%'s as well"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "back under 70% says nothing; the next day's crossing tells them again"](usage.use-cases.test.ts)
- A request stopped for using too much CPU tells them too, once that day.
  [usage.use-cases.test.ts › "a request stopped for its CPU time tells them too, once that day"](usage.use-cases.test.ts)
- A Sanity quota emails at 50% of the month, and emails and notifies at 70% and 90%, once a month each; past a higher
  level at once is the one email.
  [usage.use-cases.test.ts › "emails the admins once a month when a Sanity quota passes 50%, and again at 70%"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "past 70% at once, sends the one email, not 50% as well"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "a Sanity quota at 70% and at 90% of the month, once a month each"](usage.use-cases.test.ts)
- A Sanity quota whose pace would run out before the 1st gets one email, judged from the month's fourth day.
  [usage.use-cases.test.ts › "emails the admins once when this month's pace would run out before the 1st"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "doesn't judge the pace in a month's first three days"](usage.use-cases.test.ts)
- In quiet hours the email goes at once and the phone waits for 08:00; a day's limit that resets before then is only
  emailed. An admin who switched Free limits off still gets the email.
  [usage.use-cases.test.ts › "in quiet hours the email goes at once and the phone waits for 08:00"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "late at night, a day's limit that resets before quiet hours end is only emailed: by 08:00 it's a new day"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "an admin who switched Free limits off isn't told on their phone, and still gets the email"](usage.use-cases.test.ts)
- An email that fails is reported and the rest still go; two checks at once tell them once.
  [usage.use-cases.test.ts › "an email that fails is reported, and the rest still go, phones too"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "two checks at once tell them once"](usage.use-cases.test.ts)
- When Cloudflare can't be read the check tells nobody, and the developer hears of it, since nobody would be warned.
  [usage.use-cases.test.ts › "tells the developer when Cloudflare can't be read, since nobody would be warned before the allowance ran out"](usage.use-cases.test.ts)
- The admins' Home says the nearest limit past 70% in one line, with when it resets; past 90% it says so. All fine,
  no line; a member never sees one.
  [usage.use-cases.test.ts › "an admin sees a limit past 70%, with today's reset; a member sees none"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "past 90% says so, nearest first, with Sanity's month and a request stopped for its CPU time"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "all fine, there's nothing to say"](usage.use-cases.test.ts)
- A limit back under 70% leaves Home at the next check, and yesterday's isn't today's; when Cloudflare can't be read,
  Home keeps what the last check found.
  [usage.use-cases.test.ts › "a limit back under 70% goes at the next check, and yesterday's isn't today's"](usage.use-cases.test.ts),
  [usage.use-cases.test.ts › "when Cloudflare can't be read, keeps what the last check found rather than saying all's fine"](usage.use-cases.test.ts)
- Near the month's Sanity CDN quota (90%), the website's live reads stop until the 1st, so builds keep their share.
  [sanity-live.test.ts › "stops live reads at 90% of the month's CDN requests, until the quota resets on the 1st, so builds keep their share"](../../../web/src/lib/server/sanity-live.test.ts)

## The audit log

- Every change made with more than being signed in goes on the record: anything an admin, a team maker, a scorer or a
  treasurer does. Only a member's own sign-ups (and the email's reconnect and test, recorded by their handlers) stay
  off it, each saying why.
  [api.security.test.ts › "puts every change made with more than being signed in on the record, but for the few that say why"](../api/api.security.test.ts),
  [audit.coverage.use-cases.test.ts › "the register on the night: who was there, which makes the charges"](audit.coverage.use-cases.test.ts),
  [audit.coverage.use-cases.test.ts › "a member's own sign-up stays off it"](audit.coverage.use-cases.test.ts)
- Each entry says who did it, and what it was before and after. A change refused, failed or that changes nothing
  writes nothing.
  [api.security.test.ts › "every change to who can do what, and every refused request, says who did it, before and after"](../api/api.security.test.ts),
  [api.security.test.ts › "writes nothing when a change is refused or fails"](../api/api.security.test.ts)
- Goals and the game clock aren't one entry each: a game's result goes on the record at full time, and again with
  each fix after.
  [scoring.use-cases.test.ts › "they're on the record with the result, as goals are: at full time, and with each fix after"](../tournaments/scoring.use-cases.test.ts)
- A member trying a page their role can't open is refused every time, and on the record at most once a minute.
  [api.abuse.use-cases.test.ts › "is refused every time, on the record once a minute and in the log every time"](../api/api.abuse.use-cases.test.ts)
- An admin changing a team's name or crest is on the record; its captain changing it isn't.
  [tournaments.edge-cases.use-cases.test.ts › "an admin changing a team's look is on the record; its captain changing it is their own (#201)"](../tournaments/tournaments.edge-cases.use-cases.test.ts)
- Settings → Audit log shows the newest first, a page at a time (at most 200), naming who acted and whoever it's
  about.
  [audit.use-cases.test.ts › "sees who did what, newest first, with the people and roles named"](audit.use-cases.test.ts),
  [audit.use-cases.test.ts › "reads it a page at a time, from the newest back"](audit.use-cases.test.ts),
  [audit.use-cases.test.ts › "a page is at most 200 entries, however many are asked for"](audit.use-cases.test.ts)
- Whoever an entry is about is named as they're called now.
  [audit.use-cases.test.ts › "names whoever an entry is about as they're called now, not as they were"](audit.use-cases.test.ts)
- Admins read it, and so does any role given See the audit log; a member is refused, and the try is on it.
  [audit.use-cases.test.ts › "a role given See the audit log reads it too; nobody else does"](audit.use-cases.test.ts)
- Something undone that can't be put back (a session reset) says what it took away.
  [audit.use-cases.test.ts › "sees what was undone that can't be put back: a session reset, with what it took away"](audit.use-cases.test.ts)

## Dev tools

- Dev tools, and every dev-only tool, exist only where the environment says dev, or on your own machine. In production,
  or where the deploy never said, they aren't there at all: a 404 for anyone, admins too, and the app doesn't show them.
  [devtools.use-cases.test.ts › "doesn't exist in production"](devtools.use-cases.test.ts),
  [devtools.use-cases.test.ts › "doesn't exist on a deploy that never said where it is"](devtools.use-cases.test.ts)
- Outside production, admins always get their own email, and an admin keeps a list of anyone else who does; everyone
  else's goes to the safe inbox. Never the club's own inbox; a member can't see or change the list.
  [devtools.use-cases.test.ts › "admins always get their own email here, so they can sign in and open Dev tools; the list adds anyone else"](devtools.use-cases.test.ts),
  [devtools.use-cases.test.ts › "never the club's own inbox"](devtools.use-cases.test.ts),
  [devtools.use-cases.test.ts › "a member can't see or change it"](devtools.use-cases.test.ts)
- Play out the Kumite takes a Kumite from wherever it is to the after-party: drafted, every match played, standings
  and the awards provisional for the admin to confirm and reveal.
  [simulate.use-cases.test.ts › "from the teams set to the after-party: drafted, every match played, standings and provisional awards"](../tournaments/simulate.use-cases.test.ts)
- It signs nobody up: with too few signed up it says so. Stopped part way it carries on from there; run again at the
  end, it says there's nothing left. It takes over a match someone else is scoring.
  [simulate.use-cases.test.ts › "too few signed up: it says so, and signs nobody up"](../tournaments/simulate.use-cases.test.ts),
  [simulate.use-cases.test.ts › "run again, it says there's nothing left; stopped part way, it carries on from there"](../tournaments/simulate.use-cases.test.ts),
  [simulate.use-cases.test.ts › "takes over a match someone else is scoring, and plays it on from where they left it"](../tournaments/simulate.use-cases.test.ts)
- Each request makes one move you'd see (a pick, a goal, a period's end) and says which; Spin kick makes a few a
  request, within the request's database budget.
  [simulate.use-cases.test.ts › "each request makes exactly one move you'd see, says which, and says when that's all"](../tournaments/simulate.use-cases.test.ts),
  [simulate.use-cases.test.ts › "reaches the after-party in far fewer requests than a move a request, each well inside its D1 queries"](../tournaments/simulate.use-cases.test.ts)
- The app waits each move out so it can be watched, at three speeds (Kata, Sparring, Spin kick), none faster than a
  member's 60 changes a minute; Pause holds after the move in flight, Stop ends it.
  [simulation.test.ts › "the paces fit what the page shows, and no speed beats a member's 60 changes a minute"](../../src/lib/simulation.test.ts),
  [simulation.test.ts › "pause holds after the move in flight; resume carries on"](../../src/lib/simulation.test.ts)
- It needs Manage tournaments: a member who doesn't run them is refused.
  [simulate.use-cases.test.ts › "on dev, a member who doesn't run tournaments is refused; an admin is told it's there"](../tournaments/simulate.use-cases.test.ts)
- A Kumite on a past day is made, signed up for and played out on that evening to its last award, so it's history;
  a day still to come is refused.
  [past-day.use-cases.test.ts › "made, signed up for, and played out on that evening to its last award: history, with a whole evening behind it"](../tournaments/past-day.use-cases.test.ts),
  [past-day.use-cases.test.ts › "refuses a day that hasn't gone by, and won't play a Kumite on its day while that's to come"](../tournaments/past-day.use-cases.test.ts)

## Errors

- Settings → Errors shows each app's open issues in this environment, newest first, ten at most: what, how often, when
  last, where, and a link to Sentry.
  [errors.use-cases.test.ts › "sees each app's open issues in this environment, newest first: what, how often, when last, where, and a link"](errors.use-cases.test.ts),
  [errors.use-cases.test.ts › "sees the ten most recent of a project, and that there are more"](errors.use-cases.test.ts)
- A title never shows an email address.
  [errors.use-cases.test.ts › "never sees an email address in a title, even if one got past Sentry's own cleaning"](errors.use-cases.test.ts)
- Sentry is asked at most every five minutes, whoever opens the page.
  [errors.use-cases.test.ts › "a second admin a minute later sees the same answer, and Sentry isn't asked again; after five minutes it is"](errors.use-cases.test.ts)
- When Sentry can't be read the page says so calmly and keeps the last answer on show, saying when it was from.
  [errors.use-cases.test.ts › "says so calmly, logs a warning (not an error, which would go to the Sentry that's down), and asks again only after a few minutes"](errors.use-cases.test.ts),
  [errors.use-cases.test.ts › "keeps showing the last answer, saying when it was from"](errors.use-cases.test.ts)
- A member is refused.
  [errors.use-cases.test.ts › "a member is refused, and Sentry isn't asked"](errors.use-cases.test.ts)

## Keeping data

- Sign-in codes are forgotten after 30 days.
  [retention.use-cases.test.ts › "sign-in codes after 30 days"](retention.use-cases.test.ts)
- A session is forgotten 30 days after it was signed out or ran out, never while it's in use.
  [retention.use-cases.test.ts › "a session 30 days after it ended, never one still in use"](retention.use-cases.test.ts),
  [retention.use-cases.test.ts › "an expired session 30 days after it expired"](retention.use-cases.test.ts)
- The audit log keeps two years.
  [retention.use-cases.test.ts › "audit entries after 2 years"](retention.use-cases.test.ts)
- A request to join that nobody answers is forgotten after 30 days.
  [auth.turnstile.use-cases.test.ts › "a request nobody answers is forgotten after 30 days, so the list never fills for good"](../auth/auth.turnstile.use-cases.test.ts)
- A website enquiry is deleted after 12 months, unless the person joined.
  [enquiries.test.ts › "deletes enquiries older than 12 months, except from people who joined"](../../../web/src/lib/server/enquiries.test.ts)
