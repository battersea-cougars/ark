// The Kumite's fighters (ADR 0074): its sign-up is an invitation (lib/motif.ts invitationOnly), and whoever accepts is
// a fighter with a number, their place in the sign-up order (the number Who's in has always counted). The waitlist
// are the reserves, numbered in theirs. Said out: you declined. Shown on the fighter's pass (lib/KumiteInvite), The
// fighters (lib/WhosIn) and the header's answer (lib/TournamentHead).

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

/** Said in a line or a badge: "Fighter No. 7", "Reserve No. 3", "Declined". */
export function fighterLabel(f: Fighter) {
  if (!f) return "";
  if (f.is === "declined") return "Declined";
  return `${f.is === "fighter" ? "Fighter" : "Reserve"} No. ${f.no}`;
}
