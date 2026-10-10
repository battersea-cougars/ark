# Seed data

Data D1 starts with. `club.sql` is public, so it only seeds things that aren't about
people (roles, Friday Training, the Kumite). Anything personal comes from here, and never from this repo
([ADR 0029](../../docs/adr/0029-personal-data.md)).

## The team roster

The club's starting players. It lives in Secrets Manager as `TEAM_ROSTER` (dev) and `TEAM_ROSTER__PRODUCTION`
([README.md#team-roster](../../README.md#team-roster)), and on your machine as `db/seed/roster.local.json`, which
git ignores (`db/seed/*.local.*`).

```json
[
  {
    "name": "Pat Example",
    "position": "D",
    "rating": 75,
    "email": "pat@example.com",
    "roles": ["Admin"],
    "everyday": "Session lead"
  },
  { "name": "Sam Example", "position": "F", "rating": 40, "cougar": true }
]
```

- `position`: `F`, `D` or `G`. `rating`: 0–100, for balancing teams; only `read:Rating` sees it.
- `email`, `roles`, `everyday` and `cougar` are optional. Everyone gets Member; `roles` adds more (Admin, Contributor, Session lead).
- `everyday`: the role their app opens as day to day (ADR 0024), set when the seed adds them; after that it's theirs to
  change on Profile. Production's admins open as Session lead.
- `cougar: true`: on the club's official team, the Cougars. Teams are made with the Cougars together on one team.

`scripts/seed-roster.mjs` turns it into SQL that **only adds**: a player already in `members` (same name, any
case) is left alone (its rating, position and Cougar flag included), an email is filled in only where there's
none, and roles are added, never removed. So what admins change in the app always wins, and it's safe to run on every deploy.

- Local: `npm run db:rebuild:local && npm run db:seed:local` (local D1 is shared by the website and the team app).
- Dev and production: the "Seed the team roster" step in `.github/workflows/deploy.yml`, after the rebuild.

Changing the roster: edit the local copy, then put it back in Secrets Manager with the command in
[README.md#team-roster](../../README.md#team-roster). Production's roster (`TEAM_ROSTER__PRODUCTION`) is only its
admins; everyone else comes in through **Members → Manage → Import members** in the team app, which takes a CSV
(columns `name`, `email`, `position`, `rating`, `cougar`, `roles`) or this same JSON
([ADR 0069](../../docs/adr/0069-members.md)). After that, add and edit members in the app.
