// The Kumite's fighters (apps/team/worker/tournaments/README.md): its sign-up is an invitation, and whoever accepts is
// a fighter numbered by their place in the sign-up order (as Who's in counts it). The waitlist are the reserves,
// numbered in theirs. Said out: you declined.

interface Entries {
  going: readonly number[];
  waitlist: readonly number[];
  out?: readonly number[];
}

export type Fighter = { is: "fighter" | "reserve"; no: number } | { is: "declined" } | null;

/** Where this member stands: fighter or reserve with their number, declined, or not answered (null). */
export function fighterOf(t: Entries, memberId: number): Fighter {
  const at = t.going.indexOf(memberId);
  if (at >= 0) return { is: "fighter", no: at + 1 };
  const waiting = t.waitlist.indexOf(memberId);
  if (waiting >= 0) return { is: "reserve", no: waiting + 1 };
  return t.out?.includes(memberId) ? { is: "declined" } : null;
}

/** The number as the pass prints it: two figures ("07"). */
export const fighterNo = (n: number) => String(n).padStart(2, "0");

/** Said in a line or a badge: "Admitted · No. 7", "Reserve No. 3", "Declined" (never "fighter": the user's call). */
export function fighterLabel(f: Fighter) {
  if (!f) return "";
  if (f.is === "declined") return "Declined";
  return f.is === "fighter" ? `Admitted · No. ${f.no}` : `Reserve No. ${f.no}`;
}
