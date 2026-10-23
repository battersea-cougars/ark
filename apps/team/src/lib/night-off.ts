// A training night called off, as its page shows it (ADR 0030, ADR 0065): the page is the series' next night that's
// on, and any night from today up to it that's cancelled shows above it, struck through, so a Friday off for the
// Kumite never just vanishes. Manage cancels the night shown, or puts one that's off back on.

interface Night {
  seriesId: number;
  heldOn: string;
  cancelledAt?: string | null;
  going: number[];
  waitlist: number[];
}

/**
 * A training's page: `shown`, its next night that isn't cancelled (or the next at all, if they all are), and `off`,
 * the nights from today to that one that are cancelled (the shown one too, if it is), in date order.
 */
export function trainingNights<S extends Night>(sessions: S[], seriesId: number, today: string) {
  const future = sessions
    .filter((s) => s.seriesId === seriesId && s.heldOn >= today)
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
