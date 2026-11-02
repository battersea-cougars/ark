# Docs

How the live website and team app run, by who it's for. A doc here describes things as they are now; a dated
review, audit or plan doesn't stay (what's still to do is a GitHub issue, and decisions are ADRs).

## For the club (no coding)

| Doc                      | What                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| [editing.md](editing.md) | Editing the website: the Studio's club facts, videos on YouTube, photos on Instagram, enquiries |

## For whoever runs the accounts

| Doc                        | What                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| [accounts.md](accounts.md) | Every outside service: who owns it, where to sign in, how it's set up, the domain         |
| [secrets.md](secrets.md)   | How secrets work, then every secret by system: where it's kept, its scopes, what reads it |

## For developers

| Doc                                          | What                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [development.md](development.md)             | Running the apps, the ports, one worktree per task, break glass when admins are locked out |
| [testing.md](testing.md)                     | How we test: use cases, signed-in browsers, screenshots, journeys, cost and accessibility  |
| [load-testing.md](load-testing.md)           | Requests at once and load runs: how to run them, locally or on dev                         |
| [../db/README.md](../db/README.md)           | The database: schema and seed until launch, conventions, backups and restoring             |
| [../db/seed/README.md](../db/seed/README.md) | The seed: the public club seed and the roster, never in the repo                           |
| [../brand/README.md](../brand/README.md)     | Brand images for outside services, and the script that makes them                          |
| [adr/](adr/README.md)                        | Architecture decisions, one record per topic, and why                                      |
| [../CLAUDE.md](../CLAUDE.md)                 | Conventions for contributors and AI agents                                                 |

What's planned: [GitHub milestones](https://github.com/battersea-cougars/ark/milestones).
