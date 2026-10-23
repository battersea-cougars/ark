// Which tournament the editor panel has open, from wherever an admin is: Settings → Tournaments, or a series' own
// pages (Games, Standings, Draft), where "New date", "Edit" and "Add the captains" open it in place. A new date in a
// series opens on its questions, a step at a time (ADR 0074, lib/Wizard); Advanced opens the full editor with the
// answers filled in.
type Tab = "details" | "rules" | "signup" | "teams";
export const tournamentPanel = $state<{
  open: number | "new" | null;
  typeId?: number;
  tab: Tab;
  advanced: boolean;
  /** The quick questions' step, kept while Advanced is open so Back returns to it */
  step: number;
}>({
  open: null,
  tab: "details",
  advanced: false,
  step: 0,
});
/** Open a tournament's editor (on a tab), or a new one (in a series). */
export function editTournament(open: number | "new", { typeId, tab = "details" }: { typeId?: number; tab?: Tab } = {}) {
  Object.assign(tournamentPanel, { open, typeId, tab, advanced: false, step: 0 });
}
