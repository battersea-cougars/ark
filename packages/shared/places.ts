// Where something is held (ADR 0030). A place the club goes again and again is a saved venue: a name, an address
// and its map link, set once and picked, so moving it fixes every event that uses it. A one-off (a social) needn't
// make one: it has its own name and the map link pasted for it. Nothing set: its series' place, if it has one.

/** A saved venue. */
export interface Venue {
  id: number;
  name: string;
  address: string;
  /** Pasted from Google Maps (Share → Copy link); empty: a map search for the name and address. */
  mapUrl: string;
  /** Offered when picking; an old one stays on the events that have it. */
  active: boolean;
}

/** What something stores about where it is: a saved venue, or a name and map link of its own. */
export interface OwnPlace {
  venueId: number | null;
  name: string;
  mapUrl: string;
}

/** Where it really is. */
export interface Place {
  name: string;
  address: string;
  /** Always a link that opens the map. */
  mapUrl: string;
}

/** Google Maps' search link: works on any phone, no key. */
export const mapSearch = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

/** Its saved venue, else the name and link it has, else the fallback (its series'); null when nothing says. */
export function placeOf(own: OwnPlace, venues: readonly Venue[], fallback: Place | null = null): Place | null {
  const venue = own.venueId == null ? undefined : venues.find((v) => v.id === own.venueId);
  if (venue) return toPlace(venue.name, venue.address, venue.mapUrl);
  const name = own.name.trim();
  if (name || own.mapUrl) return toPlace(name || "On the map", "", own.mapUrl);
  return fallback;
}

const toPlace = (name: string, address: string, mapUrl: string): Place => ({
  name,
  address,
  mapUrl: mapUrl || mapSearch([name, address].filter(Boolean).join(", ")),
});

/** A pasted map link, tidied: "" for none, null if it isn't a web link (so never javascript: in an href). */
export function cleanMapUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return "";
  try {
    const url = new URL(v);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Where a tournament goes afterwards (ADR 0074): its series' ("usual", what every one gets without retyping), its own,
 * or none this time.
 */
export const AFTER_MODES = ["usual", "own", "none"] as const;
export type AfterMode = (typeof AFTER_MODES)[number];

/** What a series or a tournament stores about its afterwards: a saved venue, an optional time, what it's for. */
export interface OwnAfter {
  venueId: number | null;
  /** HH:MM, or null: no time said. */
  time: string | null;
  note: string;
}

/** Where everyone goes afterwards: the venue, and when and what for if said. */
export interface After extends Place {
  time: string | null;
  note: string;
}

/**
 * Its afterwards: its own, its series' (usual), or none. Only a saved venue counts (a pub the club goes to every
 * time); a venue that's gone, or none picked, is nowhere.
 */
export function afterOf(
  mode: AfterMode,
  own: OwnAfter,
  usual: OwnAfter | null,
  venues: readonly Venue[],
): After | null {
  const chosen = mode === "none" ? null : mode === "own" ? own : usual;
  const venue = chosen?.venueId == null ? undefined : venues.find((v) => v.id === chosen.venueId);
  if (!chosen || !venue) return null;
  return { ...toPlace(venue.name, venue.address, venue.mapUrl), time: chosen.time || null, note: chosen.note.trim() };
}
