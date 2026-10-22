// The draft's own jobs (ADR 0060), as items in the page's one Manage (the header's gear, and the draft room's): no
// menu inside a menu. Which apply, and what each says, while the tournament's at the draft; lib/DraftJobs.svelte does
// them (the add sheet, the confirms), lib/TournamentHead and pages/DraftRoom list them.
import type { IconName } from "../app/shell/icons";
import { draftTurn } from "./draft";

export type DraftJob = "undo" | "add" | "leaveOut" | "reset";

export interface DraftJobItem {
  job: DraftJob;
  icon: IconName;
  label: string;
  sub: string;
  /** Can't be taken back: said in red. */
  danger?: boolean;
}

/** Enough of a tournament to say what can be done to its draft. */
interface Drafting {
  kind: string;
  draftState?: string;
  teams: {
    captainMemberId: number | null;
    players: { memberId: number | null; name?: string; pick?: number | null }[];
  }[];
  going: number[];
}

/**
 * What can be done to the draft, most often needed first: undo the last pick (naming it), add a player, close it
 * leaving the rest out (the Seal card closes it once everyone's picked; this is only for closing early), start again.
 * `runs`: run:Draft; `adds`: update:Event. Nothing once it's closed: Back a step reopens it.
 */
export function draftJobsOf(
  t: Drafting | undefined,
  { runs, adds }: { runs: boolean; adds: boolean },
  names: { player: (memberId: number | null, name?: string) => string; team: (index: number) => string },
): DraftJobItem[] {
  if (!t || t.kind !== "draft" || t.draftState === "closed") return [];
  const open = t.draftState === "open";
  const { picks, left } = draftTurn(t);
  const last = t.teams
    .flatMap((x, team) => x.players.flatMap((p) => (typeof p.pick === "number" ? [{ ...p, pick: p.pick, team }] : [])))
    .sort((a, b) => b.pick - a.pick)[0];
  const list: DraftJobItem[] = [];
  if (runs && open && last)
    list.push({
      job: "undo",
      icon: "undo",
      label: "Undo the last pick",
      sub: `${names.team(last.team)} → ${names.player(last.memberId, last.name)}`,
    });
  if (adds)
    list.push({ job: "add", icon: "userPlus", label: "Add a player", sub: "Put in someone who didn't sign up" });
  if (runs && open && left > 0)
    list.push({
      job: "leaveOut",
      icon: "check",
      label: "Close it now",
      sub: `${left} still to pick, left out`,
    });
  if (runs && picks > 0)
    list.push({
      job: "reset",
      icon: "x",
      label: "Reset the draft",
      sub: "Every pick comes off, and the order",
      danger: true,
    });
  return list;
}
