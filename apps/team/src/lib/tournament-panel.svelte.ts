// Which tournament the editor panel has open, from Settings → Tournaments or a series' own pages, where New date, Edit
// and Add the captains open it in place. A new date opens on its questions, a step at a time
// (apps/team/worker/tournaments/README.md, lib/Wizard); Advanced shows every field in the same steps.
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
