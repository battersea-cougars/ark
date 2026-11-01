# Docs

Everything written down about the website and the team app, by who it's for.

## For the club (no coding)

| Doc                            | What                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| [editing.md](editing.md)       | Editing the website: the Studio's club facts, videos on YouTube, photos on Instagram, enquiries |
| [club-facts.md](club-facts.md) | Every fact the website states about the club, as checked with the club, and what's open         |

## For whoever runs the accounts

| Doc                        | What                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| [accounts.md](accounts.md) | Every outside service the club runs on, who owns it, and which secrets it issues            |
| [setup.md](setup.md)       | One-time account setup, in order: Cloudflare, Sanity, Bitwarden, GitHub                     |
| [secrets.md](secrets.md)   | How secrets work, then every secret by system and environment: why, where, how to change it |

## For developers

| Doc                                              | What                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [development.md](development.md)                 | Running the apps, the ports, one worktree per task, break glass when admins are locked out |
| [testing.md](testing.md)                         | How we test: use cases first, the fake world, signed-in browsers, screenshots in `.shots/` |
| [testing-map.md](testing-map.md)                 | The team app's tests mapped: which level checks what, feature by feature                   |
| [load-testing.md](load-testing.md)               | Load and concurrency: how to run it, what D1 does, what the runs found, the headroom       |
| [team-app-data-model.md](team-app-data-model.md) | The team app's tables, by area                                                             |
| [../db/README.md](../db/README.md)               | Database conventions, the schema and seed until launch, backups and restoring              |
| [../db/seed/README.md](../db/seed/README.md)     | The seed: the public club seed and the roster, never in the repo                           |
| [../brand/README.md](../brand/README.md)         | Brand images for outside services, and the script that makes them                          |
| [adr/](adr/README.md)                            | Architecture decisions, one record per topic, and why                                      |
| [../CLAUDE.md](../CLAUDE.md)                     | Conventions for contributors and AI agents                                                 |

## Reviews

Dated snapshots: what a review found on the day, what was fixed and what was left. Decisions live in the ADRs.

| Doc                                                                          | What                                                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [reviews/security-review.md](reviews/security-review.md)                     | Security review, 2026-10-23: every route, what was found and fixed                                               |
| [reviews/accessibility-performance.md](reviews/accessibility-performance.md) | Accessibility (axe, the keyboard) and first load, 2026-10-23: how to check, what was fixed and left, the numbers |
| [reviews/code-style-audit.md](reviews/code-style-audit.md)                   | Code style audit, 2026-10-23: the code against ADR 0105 and 0125, file by file                                   |
| [reviews/kumite-editor-review.md](reviews/kumite-editor-review.md)           | The Kumite editor and the scheduling wizard where they overlap, 2026-10-23                                       |

What's planned: [GitHub milestones](https://github.com/battersea-cougars/ark/milestones).
