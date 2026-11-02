# Battersea Cougars: how it all works

The club runs three things, all from this repo, all on free plans (it costs £0 a month):

- **The website**, for anyone: who we are, Fridays, Kumites, results, photos, and the join form.
- **The team app**, for members only: sign-ups for each night, teams, the register, dues, Kumites, notifications.
- **The Studio**, for the club's editors: where the website's words, times, fees and pages are changed.

## The important links

|                   | Live                                                               | Practice copy (dev)                                                               |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Website           | <https://batterseacougars.com>                                     | <https://web.cougars-dev.workers.dev>                                             |
| Team app          | <https://team.batterseacougars.com>                                | <https://team.cougars-dev.workers.dev>                                            |
| Studio (CMS)      | <https://studio.batterseacougars.com>                              | <https://studio.cougars-dev.workers.dev>                                          |
| The code          | <https://github.com/battersea-cougars/ark>                         | What's planned: [milestones](https://github.com/battersea-cougars/ark/milestones) |
| Deploys           | [GitHub Actions](https://github.com/battersea-cougars/ark/actions) |                                                                                   |
| Hosting           | [Cloudflare](https://dash.cloudflare.com), account **Cougars**     | Account **Cougars Dev**                                                           |
| Content           | [Sanity](https://www.sanity.io/manage), project **Cougars**        | Project **Cougars Dev**                                                           |
| Errors and uptime | [Sentry](https://battersea-cougars.sentry.io)                      | The same, filtered to dev                                                         |
| Secrets           | [Bitwarden](https://vault.bitwarden.eu), the club's organisation   | The `cougars-dev` project                                                         |

Who has access to each, and where to change it: [accounts.md](accounts.md#whos-a-member-and-where-to-change-it).

## Where it's hosted

- **Cloudflare** runs everything: the website and the team app are each a Worker (a small server at Cloudflare's
  edge), and the club's data (members, nights, dues, Kumites) is in one Cloudflare **D1** database. Live and dev are
  two separate Cloudflare accounts, so nothing done on dev can touch the live club.
- **GitHub** holds the code. A change merged into `main` goes to dev by itself; going live is a pull request from
  `main` into `release`, which deploys the live site and app. Nobody deploys by hand.
- **Email** (sign-in codes, the join form's replies, reminders) is sent through the club's developer Gmail account.
  **Errors** are reported to Sentry, which emails when something breaks. **Secrets** (passwords, keys) live only in
  Bitwarden.

## How the content works

- **The website's words and settings** (times, fees, venues, what's on, page text) are edited in the **Studio**. Press
  **Publish**, and the change is on the website the next morning, when it rebuilds by itself; or, for something
  urgent, **Rebuild now** in the team app's Settings → Website puts it live in about five minutes. How to edit:
  [editing.md](editing.md).
- **Photos** come from the club's **Instagram**, and **videos** from its **YouTube** channel: post there, and the
  website picks them up.
- **The team app's data** (members, nights, teams, payments, Kumites) is edited in the team app itself, by its admins,
  and lives in the D1 database, not in the Studio.

## The docs

| For                  | Read                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The club's editors   | [editing.md](editing.md): changing the website in the Studio                                                                                                                                                           |
| Whoever runs things  | [accounts.md](accounts.md): every service, who owns it, who's a member · [secrets.md](secrets.md): every secret · [launch.md](launch.md): launch day and rolling back                                                  |
| Developers           | [development.md](development.md): running it locally (`npm ci` is all you need) · [testing.md](testing.md) · [load-testing.md](load-testing.md) · [../db/README.md](../db/README.md): the database, backups, restoring |
| Why it's built so    | [adr/](adr/README.md): the architecture decisions · each feature's rules are in its folder's `README.md`                                                                                                               |
| Contributors, agents | [../CLAUDE.md](../CLAUDE.md): the conventions                                                                                                                                                                          |
