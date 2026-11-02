# The join form

The rules for the website's "Try a session" form, its Turnstile check and the automatic reply, in plain words. Each
one is checked by the use-case test it links; change the rule, the test and this line together. Why a piece of code
is the way it is stays in a comment beside it.

## Who gets an automatic reply

- Someone Turnstile says is a person gets the session details by email, and the club's email says they have.
  [join.use-cases.test.ts › "a person gets the session details by email, and the club's email says they have"](join.use-cases.test.ts)
- Without Turnstile's say-so (a bot, or JavaScript off) the enquiry is still saved and the club emailed, with a note
  that no automatic reply went out; the club answers by hand.
  [join.use-cases.test.ts › "without Turnstile's say-so (a bot, or no JavaScript), it's still saved and the club told, with no automatic reply"](join.use-cases.test.ts)
- One automatic reply per address a week.
  [join.use-cases.test.ts › "asking again the same week, the club hears again but the person gets no second automatic reply"](join.use-cases.test.ts)
- At most 20 automatic replies a day across the site, whoever they're to.
  [enquiries.test.ts › "auto-replies in a day, whoever they're to"](enquiries.test.ts)
- A Turnstile token from the team app's forms doesn't count as a person here.
  [enquiries.turnstile.test.ts › "a token from the team app's Ask to join doesn't count as a person here"](enquiries.turnstile.test.ts)

## What the automatic reply says

- It goes to the enquirer, replies go to the club, and it states only the site's facts from the Studio.
  [auto-reply.test.ts › "goes to the enquirer, replies go to the club, and it states only the site's facts"](auto-reply.test.ts)
- It repeats nothing the sender wrote except a first name that looks like one; otherwise it says "there".
  [auto-reply.test.ts › "never repeats what the sender wrote, beyond the first name"](auto-reply.test.ts)
  [auto-reply.test.ts › "says 'there' for anything a spammer could use"](auto-reply.test.ts)

## The form

- It works without JavaScript: sent wrong, it goes back to the form saying so.
  [join.test.ts › "sent wrong, it goes back to the form saying so"](join.test.ts)
- Five enquiries a quarter-hour from one place; a form sent wrong uses up nobody's tries.
  [join.use-cases.test.ts › "a form sent wrong uses up nobody's tries: five a quarter-hour from one place count only real enquiries"](join.use-cases.test.ts)
  [join.test.ts › "sent too often from one place, it goes back to the form saying to wait"](join.test.ts)
- The club's email has the enquirer as Reply-To, and never lets what they typed become HTML.
  [enquiry-mail.test.ts › "goes to the club, with the enquirer as Reply-To"](enquiry-mail.test.ts)
  [enquiry-mail.test.ts › "never lets what the enquirer typed become HTML"](enquiry-mail.test.ts)
- Enquiries are deleted after 12 months, except from people who joined.
  [enquiries.test.ts › "deletes enquiries older than 12 months, except from people who joined"](enquiries.test.ts)
