// Which tournament the editor panel has open, from wherever an admin is: Settings → Tournaments, or a series' own
// pages (Games, Standings, Draft), where "New date", "Edit" and "Add the captains" open it in place. A new date in a
// series opens on its questions, a step at a time (ADR 0074, lib/Wizard); Advanced shows every field in the same
// steps (#163).
import type { EditorTab as Tab } from "./TournamentDateEditor.svelte";
export const tournamentPanel = $state<{
  open: number | "new" | null;
  typeId?: number;
  tab: Tab;
  /** The wizard's Advanced: every field, each on its step */
  advanced: boolean;
  /** The wizard's step in view */
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
