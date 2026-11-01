# The Kumite editor: a review

The tournament editor (`lib/TournamentDateEditor.svelte`, in `lib/TournamentEditorPanel.svelte`) and the quick
questions (`lib/TournamentQuickCreate.svelte`) where they overlap. Decisions stay in ADR
[0030](../adr/0030-training-and-tournament-schedule.md), [0065](../adr/0065-page-frame-and-admin-actions.md) and
[0074](../adr/0074-tournament-home-and-scheduling.md); this is where it stood, what was changed and what's left to decide.

## 2026-10-23

The user: "do a whole review of the Kumite settings form", after "I don't like how you made these fields editable. We
have an edit UI for the teams" (the captains) and "This form is a mess" (the awards).

### Findings

1. **Save stayed off after scheduling** (fixed). A Kumite scheduled from the full editor gives way to its saved
   editor in the same panel; the old form's teardown cleared the new one's watch (lib/dirty.svelte.ts read reactive
   state as it was before the swap), so adding a captain never lit Save. See ADR 0065's History.
2. **Captains were inline inputs** (fixed): the captain's name turned into a search on click, an always-on team-name
   input, a ✕ beside each. Now a row each that reads as text and opens the team's sheet.
3. **Awards were a wall of inputs** (fixed): a name, a line, a "decided by" drop-down, sometimes a tie-break, a hint
   and a ✕ per award. Now a row each with a quiet tag for how it's decided, opening a short sheet.
4. **A team that entered was a card of inline fields** (fixed, same pattern): its name, logo, captain or outside
   captain and contact, and its players are in its sheet; the row says its name, captain and how many players.
5. **Where and Afterwards** (fixed): each was a section whose only field had its own name again ("Where / Where",
   "Afterwards / Afterwards"). One section, Venue, with Where and Afterwards.
6. **Sign-up on a phone** (fixed): six fields one under another. Now in pairs, two to a row everywhere: opens and
   closes, places and fee, then the website (the status has gone, below). Its line was two sentences about the
   status; now one.
7. **The fee's lock said why only on hover** (fixed): once anyone's paid, "Already charged: the fee is fixed" shows
   under it, on a phone too.
8. **Break between periods with one period** (fixed): it's off (disabled) while there's one period; its value is kept.
9. **Wording** (fixed): the draft's line said "pick"; it says choose (Kumite wording). Awards' choices are shorter
   (the explanation moved to the sheet's hint).
10. **Two warnings for too few teams for the playoffs**, one on Rules & awards, one on Teams. Kept: each is where the
    thing it asks you to change is.
11. **The tabs don't fit a phone** (fixed, below): four tabs in italic caps scrolled sideways at 390px, so the first
    was cut ("S" of Details) once you were on a later one.

### Questions for the user

Answered the same day; what was done is under **The answers**.

- **Status on the Sign-up tab** (Coming up, Sign-up open, Live, Finished) duplicates the Kumite's own page, where
  Manage moves it on (Close sign-up, Open draft, …, ADR 0065, 0074). Keep it here as an override, or take it out?
- **Type (Teams enter / Captains draft) on every edition**: a series sets it, and changing it on one Kumite after
  captains are in changes what the Teams tab holds. Lock it once there are teams, or only on the series?
- **Two ways to rename a team**: the team's page (Edit the team, its captain or an admin, saves at once) and this
  editor's team sheet (saved with the editor's Save). Both use the same fields. If an admin has the editor open while a
  captain renames their team, the editor's Save puts back the old name. Keep both (the editor for setting up, the page
  for the captain), or make the editor's team sheet the team page's sheet, saving at once and refreshing the editor?
- **Tab order**: Details, Rules & awards, Sign-up, Draft & teams. For a series' edition the rules and awards are
  copied from the series and rarely change; Details, Sign-up, Draft & teams, Rules & awards puts first what's set
  first. Reorder?
- **A Kumite's awards vs the series'**: the website shows the series' awards (ADR 0030), so a change here shows only
  in the app. Say so in the Awards line, or edit them only on the series?
- **Phone tabs**: shorten the labels (Details, Rules, Sign-up, Teams), or keep the scroll?

### The answers (2026-10-23)

- **Status**: taken out. A Kumite's stage moves on only from its own page (Manage: Close sign-up, Move to…). The
  app's save no longer sends a status (`lib/tournament-body.ts`), and the Worker keeps the one it has when a save
  leaves it out, so an editor opened at Sign-up open and saved after the night doesn't put it back.
- **Two ways to rename a team**: one. A team's name and logo are edited only on its page (Edit the team). In the
  editor, a team's sheet shows its captain, and its crest and name as text with **Edit the team**, which closes the
  editor (asking first if anything's unsaved: Keep editing or Discard) and goes to the team's page; no sheet opens over
  the editor. A team with no page yet (not saved, or a tournament on its own) says its captain names it once it's
  saved. The editor adds and removes captains and changes a team's captain. The app sends a saved team without its
  name or logo and the Worker keeps them, so an editor left open while a captain renames their team no longer puts
  the old name back.
  - **Teams enter**: a team new in the editor still has its name and logo fields in its sheet, as it can't be
    registered without a name (Save opens the sheet of one with none). Once saved, it's like any other: its name and
    logo on its page, its captain and players in the editor.
- **Tab order**: Details, Sign-up, Draft & teams (Teams when teams enter), Rules & awards. Deep links
  (`editTournament(id, { tab: "teams" })`) are by the tab's id, unchanged.
- **Awards**: each Kumite keeps its own, and the website shows that Kumite's own: the next public one's, else the
  last public one held's; the series' only before there's been any (`scripts/lib/kumite-sql.mjs`, ADR 0044). The
  series' awards stay the defaults a new Kumite copies. The Awards line says so.
- **Phone tabs**: shorter where four in full don't fit: Details, Sign-up, Teams, Rules (the full name is still each
  tab's label, for a screen reader).
- **Type locked once there are teams**: not decided yet; unchanged (it's locked once the draft has started).

### Where each edit happens now

- A team: its row on Draft & teams opens its sheet (its captain; a team that entered, its players; its name and crest
  as text, with Edit the team to its page). Remove is in the sheet, asking once if it loses a name, a logo or
  players. A new captain: Add a captain, as before. A team's name and logo: its page, Edit the team.
- A Kumite's stage: its page, Manage.
- An award: its row on Rules & awards opens its sheet (name, line, decided by, tie-break for a vote, what it means).
  Add an award opens the same sheet empty; closed with no name, it goes.
- Both save with the editor's Save ("No changes" until something changes, then "Unsaved changes").

## 2026-10-23: one form for scheduling and editing (#163)

The wizard said "Change them for this one here, or the usual ones in the series' settings" with no field for the fee,
and Advanced threw you into the full editor, a different, busier form. Now:

- **One wizard, Advanced a mode of it** (a switch at its foot). Its steps are the editor's tabs by the same names:
  **Details · Sign-up · Teams · Rules · Check** (Teams only for a draft without Advanced; Rules only in Advanced).

  | Step    | Without Advanced                                            | Advanced adds, in place                      |
  | ------- | ----------------------------------------------------------- | -------------------------------------------- |
  | Details | When: season, day, starts, ends; the place line · change it | Venue (where, afterwards); What (name, type) |
  | Sign-up | Sign-up opens; the fee, places and website line · change it | Sign-up closes, Places, Fee (£), Website     |
  | Teams   | Draft (the draft day) and Captains (a draft series)         | Teams for a series whose teams enter         |
  | Rules   | (a line on Check: as the series has them · change them)     | Rules, Playoffs, Awards                      |

- "change it" turns Advanced on at that field (the fee's focused), so the fee for this one is one tap from the line
  that names it. The series' usual values stay in the series' settings.
- **The editor shares the fields**: each group is one component both show (When, Venue, What, Sign-up, Draft, Rules
  & awards: `lib/Tournament*Fields.svelte`, `lib/TournamentDraftDay.svelte`), on one form (`lib/tournament-form.ts`),
  so the labels, hints and order within a section are the same in both. The editor keeps its four tabs (Details,
  Sign-up, Draft & teams, Rules & awards) and its captains' rows (lib/TeamsField); the wizard keeps its captain search.
- The draft's day moved in the wizard from Sign-up to Teams, beside the captains, as the editor has it.
- Scheduled, the wizard closes on the Kumite's page; its editor is Manage → Kumite settings, where Save lights up on a
  change (the journey adds a captain there).
- The wizard takes its answers once, as it opens: a refresh of the club's data while it's open keeps what's typed.
