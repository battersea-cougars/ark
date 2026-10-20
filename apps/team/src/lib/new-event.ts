// What "New event" on the Calendar offers (ADR 0065): each kind of date the club puts on, opening the same editor
// Settings uses. Which kinds show is your full role's say, not the role you're in now: in your everyday role the
// button still shows, and picking a kind switches you up on the way (app/settings-entry).
import { can, type Action } from "../access/actions";
import type { IconName } from "../app/shell/icons";
import type { Tone } from "../demo/model";

export interface NewEventKind {
  id: "one-off" | "training" | "series" | "tournament";
  /** What it takes to create one. */
  action: Action;
  /** The series whose next date this is (`series`). */
  typeId?: number;
  icon: IconName;
  tone?: Tone;
  label: string;
  sub: string;
}

interface Series {
  id: number;
  shortName: string;
  icon: IconName;
  tone: Tone;
  kind: string;
  active: boolean;
}

/** The kinds these actions can create, in the sheet's order: a one-off, a training, each running series' next one,
 * then a tournament with every setting. */
export function newEventKinds(perms: ReadonlySet<Action>, series: readonly Series[]): NewEventKind[] {
  const kinds: NewEventKind[] = [];
  if (can(perms, "create:Event"))
    kinds.push({
      id: "one-off",
      action: "create:Event",
      icon: "glass",
      tone: "amber",
      label: "One-off event",
      sub: "A social, a kit day: one date on the calendar",
    });
  if (can(perms, "manage:Training"))
    kinds.push({
      id: "training",
      action: "manage:Training",
      icon: "skate",
      label: "Training",
      sub: "Repeats on its days, with its own page",
    });
  if (can(perms, "manage:Tournament")) {
    for (const s of series.filter((x) => x.active))
      kinds.push({
        id: "series",
        typeId: s.id,
        action: "manage:Tournament",
        icon: s.icon,
        tone: s.tone,
        label: `Next ${s.shortName}`,
        sub: s.kind === "draft" ? "When it is, sign-up, the draft and captains" : "When it is and sign-up",
      });
    kinds.push({
      id: "tournament",
      action: "manage:Tournament",
      icon: "trophy",
      label: "Tournament",
      sub: "On its own or in a series, with every setting",
    });
  }
  return kinds;
}
