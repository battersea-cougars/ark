# Battersea Cougars: Copilot instructions

See [CLAUDE.md](../CLAUDE.md) for conventions and [README.md](../README.md) for the repo layout.
Architecture decisions are in [docs/adr/](../docs/adr/README.md): read the relevant one before changing how something
is built, and rewrite its record (or add one for a new topic) when a decision changes; no History lines, git is the
trail. Product rules live with their feature: a use-case test for each, and a line in the feature folder's `README.md`
linking it. Secrets: [docs/secrets.md](../docs/secrets.md).
The old team-manager app (Next.js, Airtable, a Python solver) is gone; it's in git history before 2026-10-09 if ever needed.
