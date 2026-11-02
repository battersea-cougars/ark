# Pages

The rules for the team app's pages, in plain words. Each one is checked by the test it links; change the rule, the
test and this line together. Why a piece of code is the way it is stays in a comment beside it.

## Home

Home is a feed. From the top: a slim hello, the locker room, the hero (the club's next event), Coming up, what needs
you, For admins, and your tab at the foot. Later work keeps this order and adds no strips or blocks above the hero.

- The hello is one line, by the hour in London.
  [greetings.test.ts › "goes by the hour in London, not the device"](../lib/greetings.test.ts)
- While you owe something overdue, the hello has a pound with a red dot, opening your tab. Overdue is what's left on a
  charge whose day has passed, so paying on the night is never late.
  [dues.test.ts › "is what's left on charges whose day has passed: tonight's isn't late yet, a part paid one is what's to go"](../lib/dues.test.ts)
- Only whoever may post to the locker room has its megaphone in the hello.
  [calendar.journey.ts › "can't post to the locker room"](../../journeys/calendar.journey.ts)
- The locker room under the hello is the club's announcements only, two at a time
  ([announcements](../../worker/announcements/README.md)).
  [announcements.use-cases.test.ts › "two at a time, newest first: a third pushes the oldest off"](../../worker/announcements/announcements.use-cases.test.ts)
- The hero is the club's next event, whatever it is: your next match if you're playing in it, a captain's draft day,
  else the event's card with your part in it.
  [home-feed.lead.test.ts › "a Kumite fight before the next Friday leads, and Coming up has the Friday, not the Kumite again"](../lib/home-feed.lead.test.ts)
- A member not in this Friday's Kumite still gets the Kumite as the hero, saying they're out, not next week's training.
  [home-feed.lead.test.ts › "a member not in it: the Kumite is still the hero (they're out of it), not next week's training"](../lib/home-feed.lead.test.ts)
- Something you said you're out of still leads when it's the club's next; its card shows your Out.
  [home-feed.lead.test.ts › "what you've said you're out of still leads when it's the club's next: its card shows your Out"](../lib/home-feed.lead.test.ts)
- A cancelled one, one with no day yet, or one that's over never leads.
  [home-feed.lead.test.ts › "never a cancelled one, one with no day yet, or one that's over"](../lib/home-feed.lead.test.ts)
- The hero Home showed stays for the visit while it's still on, so nothing swaps under your thumb.
  [home-feed.lead.test.ts › "the hero Home showed stays this visit while it's still on: nothing swaps the card under your thumb"](../lib/home-feed.lead.test.ts)
- Coming up is the next things after the hero, never repeating it, in date order, each with its date on the left.
  [home-feed.test.ts › "is in date order, a date on the left of each"](../lib/home-feed.test.ts)
- Coming up looks six weeks ahead (a tournament series' next one however far off) and stops at seven, then See the
  calendar.
  [home-feed.test.ts › "looks a few weeks ahead and stops at a handful, for See the calendar"](../lib/home-feed.test.ts)
- Each row says where you stand, else how its sign-up stands; it asks "Are you in?" only when you can answer now.
  [home-feed.edge-cases.test.ts › "a training night before its sign-up opens says when, not Are you in?"](../lib/home-feed.edge-cases.test.ts)
- For admins is only for whoever each line is for: what the club is owed for whoever sees Unpaid fees, someone asking
  to join for whoever lets members in.
  [home-feed.test.ts › "nobody but whoever sees Unpaid fees has admin lines"](../lib/home-feed.test.ts)
  [home-feed.test.ts › "someone asking to join is an admin's line, naming them, opening The club"](../lib/home-feed.test.ts)
- While you owe anything, your tab is at Home's foot, opening it; it's not a row in the feed.
  [home-feed.test.ts › "a member who owes sees a notice opening their tab, and no row in the feed"](../lib/home-feed.test.ts)
