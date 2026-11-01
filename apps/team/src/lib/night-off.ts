// A training night called off, as its page shows it (ADR 0030, ADR 0065): the page is the series' next night that's
// on, and any night from today up to it that's cancelled shows above it, struck through, so a Friday off for the
// Kumite never just vanishes. Manage cancels the night shown, or puts one that's off back on. Each night has its own
// page too, at its date (/training/friday/2026-10-30), past ones included: that one alone, off or on.

interface Night {
  seriesId: number;
  heldOn: string;
  cancelledAt?: string | null;
  registerClosedAt?: string | null;
  going: number[];
  waitlist: number[];
}

/**
 * A training's page: `shown`, its next night that isn't cancelled (or the next at all, if they all are), and `off`,
 * the nights from `evening` to that one that are cancelled (the shown one too, if it is), in date order. A night is
 * still next until its register closes (lib/phase.ts): `evening` is London's evening (lib/dates.ts londonEvening), so
 * last night's is still it till 06:00, unless its register's closed. `on`: a night's own page, that night alone (the
 * next one's, if there's none that day).
 */
export function trainingNights<S extends Night>(sessions: S[], seriesId: number, evening: string, on?: string) {
  const that = on ? sessions.find((s) => s.seriesId === seriesId && s.heldOn === on) : undefined;
  if (that) return { shown: that, off: that.cancelledAt ? [that] : [] };
  const future = sessions
    .filter((s) => s.seriesId === seriesId && s.heldOn >= evening && !s.registerClosedAt)
    .sort((a, b) => a.heldOn.localeCompare(b.heldOn));
  const shown = future.find((s) => !s.cancelledAt) ?? future[0];
  const off = shown ? future.filter((s) => s.cancelledAt && s.heldOn <= shown.heldOn) : [];
  return { shown, off };
}

/** Who hears a night's off if it's cancelled: whoever's in or waiting. */
export const signedUp = (s: Night) => s.going.length + s.waitlist.length;

/** What the admin's told before a night goes off (the clash sheet's words too, ADR 0122). */
export const offWords = (n: number) =>
  n ? `${n} signed up ${n === 1 ? "hears" : "hear"} it's off if you cancel it.` : "Nobody's signed up yet.";

/** A night's own page: its series' address and its date. */
export const nightPath = (slug: string, heldOn: string) => `/training/${slug}/${heldOn}`;

/** The night a series' page is at (`/training/friday/2026-10-30` → "2026-10-30"), or undefined for its front page. */
export function nightOn(path: string, slug: string) {
  const base = `/training/${slug}/`;
  const rest = path.startsWith(base) ? path.slice(base.length) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(rest) ? rest : undefined;
}
