// Pure merge rules for Sanity content: each club-facts singleton over its fallback (fallback.ts). Apart from
// content.ts (which needs Astro's env) so they can be tested.
import type { Club, Fridays, Kumite, Pub, Team, TrainingSlot } from "./types";

type Doc = Record<string, unknown>;

const blank = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
const isObject = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Merge a singleton document over its fallback: no document, the fallback whole; else field by field. A missing or
 * blank required field falls back, so a half-filled venue never blanks the venue name. Optional fields stay empty
 * when empty: an editor clearing "Kit for first-timers" or "Fees" means "say nothing". `optional` names the fields (dotted for nested ones, e.g.
 * "venue.address") that are optional in the Studio: those come from the document only.
 */
export function mergeFacts<T extends object>(fallback: T, doc: unknown, optional: readonly string[] = []): T {
  if (!isObject(doc)) return fallback;
  return mergeObject(fallback as Doc, doc, optional, "") as T;
}

function mergeObject(fallback: Doc, doc: Doc, optional: readonly string[], prefix: string): Doc {
  const out: Doc = {};
  for (const key of new Set([...Object.keys(fallback), ...Object.keys(doc)])) {
    const path = prefix + key;
    const [fb, v] = [fallback[key], doc[key]];
    if (optional.includes(path)) out[key] = blank(v) ? (isObject(fb) ? {} : null) : v;
    else if (isObject(fb) && !optional.some((o) => o.startsWith(`${path}.`)) && blank(v)) out[key] = fb;
    else if (isObject(fb)) out[key] = mergeObject(fb, isObject(v) ? v : {}, optional, `${path}.`);
    else out[key] = blank(v) ? fb : v;
  }
  return out;
}

// Which fields are optional in each Studio singleton (apps/studio/schemaTypes/settings.ts).
export const OPTIONAL = {
  club: [
    "socials.instagram",
    "socials.facebook",
    "socials.youtube",
    "youtubeChannelId",
    "youtubePlaylists",
    "heroImage",
  ],
  fridays: ["firstSessionKit", "feesText"],
  pub: ["mapUrl"],
  team: ["league", "photo"],
  kumite: [],
} as const;

const complete = (s: Partial<TrainingSlot> | null) => Boolean(s?.title && s.day && s.start && s.end);

export const mergeClub = (fallback: Club, doc: unknown) => mergeFacts(fallback, doc, OPTIONAL.club);
export const mergePub = (fallback: Pub, doc: unknown) => mergeFacts(fallback, doc, OPTIONAL.pub);
export const mergeTeam = (fallback: Team, doc: unknown) => mergeFacts(fallback, doc, OPTIONAL.team);
export const mergeKumite = (fallback: Kumite, doc: unknown) => mergeFacts(fallback, doc, OPTIONAL.kumite);

/** Like the others, and a session missing its name, day or times is left out (all of them gone: the fallback). */
export function mergeFridays(fallback: Fridays, doc: unknown): Fridays {
  const merged = mergeFacts(fallback, doc, OPTIONAL.fridays);
  const training = (merged.training as (Partial<TrainingSlot> | null)[]).filter(complete) as TrainingSlot[];
  return { ...merged, training: training.length ? training : fallback.training };
}

/** A list from Sanity, or the demo list when there's nothing in Sanity and demo content is on. */
export const listOr = <T>(items: T[] | null | undefined, demo: T[] | null): T[] =>
  items?.length ? items : (demo ?? []);
