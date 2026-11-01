// What a charge was for, in words, and what each member owes as the club read sends it (ADR 0007, #177).
import type { IconName } from "../app/shell/icons";
import { londonISO } from "../lib/dates";
import type { Charge } from "../lib/dues";
import type { Tone } from "./model";
import { db } from "./store.svelte";

export interface ChargeLabel {
  title: string;
  /** When it was held, as an instant for formatting. */
  at: string;
  icon: IconName;
  tone: Tone;
}

export function labelFor(c: Charge): ChargeLabel {
  if (c.kind === "session") {
    const series = db.series.find((s) => s.id === c.seriesId);
    return {
      title: c.title ?? "Training",
      at: londonISO(c.dueOn, c.startTime ?? "19:30"),
      icon: series?.icon ?? "stick",
      tone: series?.tone ?? "blue",
    };
  }
  if (c.kind === "tournament") {
    const type = db.tournamentTypes.find((x) => x.id === c.typeId);
    return {
      title: c.title ?? "Tournament",
      at: londonISO(c.dueOn, c.startTime ?? "11:00"),
      icon: type?.icon ?? "trophy",
      tone: type?.tone ?? "red",
    };
  }
  // An admin's adjustment, by its reason
  if (c.kind === "adjustment")
    return { title: c.title ?? "Adjustment", at: londonISO(c.dueOn, "12:00"), icon: "settings", tone: "amber" };
  // "2026-Q4" → "Quarterly membership, Q4 2026"
  const [year, q] = (c.quarter ?? "").split("-");
  return { title: `Quarterly membership, ${q} ${year}`, at: londonISO(c.dueOn, "12:00"), icon: "pound", tone: "green" };
}

/** Your own charges with something left to pay, newest first (all the club read sends, #177). */
export const unpaidCharges = (memberId: number) =>
  db.charges.filter((c) => c.memberId === memberId).sort((a, b) => b.dueOn.localeCompare(a.dueOn));

/** What someone owes, as the server added it up (yours, or anyone's for who sees Unpaid fees). */
export const owedBy = (memberId: number) => db.dues.find((d) => d.memberId === memberId)?.owed ?? 0;

/** Money they've paid that no charge has used yet. */
export const creditOf = (memberId: number) => db.dues.find((d) => d.memberId === memberId)?.credit ?? 0;
