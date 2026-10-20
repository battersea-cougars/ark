// What's on, for the home page: the next few training sessions, tournaments and one-off events from the club's
// agenda in D1, which the team app keeps (ADR 0042). Read live on the Worker, so a change in the app shows on the
// next page load. Only what's marked public; cancelled ones stay listed, marked, so nobody turns up to nothing.
import { readAgenda } from "@cougars/shared/agenda";
import { londonDay } from "../dates";
import { safeHref } from "../links";
import { cached, type CacheDeps, type CacheOptions } from "./cache";

export interface WhatsOnItem {
  key: string;
  kind: "training" | "tournament" | "event";
  /** The series ("Friday Training"), the tournament's own name, or the event's title. */
  title: string;
  startsAt: string;
  endsAt: string | null;
  /** Where (ADR 0030): the place's name, "" for nowhere yet. */
  venue: string;
  /** Opens the map: the venue's link, the one pasted for it, or a search for its name. */
  mapUrl: string | null;
  description: string;
  cancelled: boolean;
  /** A tournament whose date isn't fixed: its date only decides where it sorts. */
  dateTbc: boolean;
  /** A tournament that's just a season so far: "Summer 2027", shown instead of a date (ADR 0030). */
  season: string | null;
  /** The weekly sessions folded into this one row (weeklyRows): the weeks among them that are called off. */
  weekly?: { skipped: string[] };
}

/**
 * The weekly trainings as one row ("Every Friday"), so the list isn't the same session four times: at the next one
 * that's on, naming any week called off. A session somewhere else stays its own row, so nobody goes to the wrong
 * rink; so does a lone session, or a run that's all called off. Everything else is untouched, in order.
 */
export function weeklyRows(items: WhatsOnItem[]): WhatsOnItem[] {
  const series = (i: WhatsOnItem) => (i.kind === "training" ? `${i.title}|${i.venue}` : null);
  const groups = new Map<string, WhatsOnItem[]>();
  for (const i of items) {
    const key = series(i);
    if (key) groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const out: WhatsOnItem[] = [];
  const done = new Set<string>();
  for (const i of items) {
    const key = series(i);
    const group = key ? groups.get(key)! : [];
    const next = group.find((g) => !g.cancelled);
    if (!key || group.length < 2 || !next) {
      out.push(i);
      continue;
    }
    if (done.has(key)) continue;
    done.add(key);
    out.push({ ...next, weekly: { skipped: group.filter((g) => g.cancelled).map((g) => g.startsAt) } });
  }
  return out;
}

export const LIMITS = { trainings: 3, tournaments: 3, events: 4 };
/** The events page: a few trainings (they're every week), every tournament and event coming up. */
export const ALL_LIMITS = { trainings: 4, tournaments: 50, events: 50 };

/** Fresh for a minute, so a change in the team app shows soon; the last good list for an hour if D1 fails. */
export const CALENDAR_CACHE: CacheOptions = { ttlMs: 60_000, staleMs: 60 * 60_000 };

/** `whatsOn`, cached (ADR 0053): one D1 read a minute, however many people look. */
export const cachedWhatsOn = (db: D1Database, limits = LIMITS, deps?: CacheDeps) =>
  cached(`d1:whats-on:${Object.values(limits).join("-")}`, CALENDAR_CACHE, () => whatsOn(db, new Date(), limits), deps);

/** Upcoming public items, soonest first: at most `limits` of each kind. Read from the club's agenda (ADR 0042). */
export async function whatsOn(db: D1Database, now = new Date(), limits = LIMITS): Promise<WhatsOnItem[]> {
  const today = londonDay(now.toISOString());
  const cap = { training: limits.trainings, tournament: limits.tournaments, event: limits.events };
  const taken = { training: 0, tournament: 0, event: 0 };
  const items: WhatsOnItem[] = [];
  for (const r of await readAgenda(db, today)) {
    // The website: what's public and for everyone (not a draft night, not a sign-up deadline)
    if (!r.public || r.audience !== "everyone") continue;
    if (r.kind !== "training" && r.kind !== "tournament" && r.kind !== "event") continue;
    // An event that's over isn't on, even today
    if (r.kind === "event" && (r.endsAt ?? r.startsAt) < now.toISOString()) continue;
    if (taken[r.kind]++ >= cap[r.kind]) continue;
    items.push({
      key: `${r.kind}:${r.sourceId}`,
      kind: r.kind,
      title: r.title,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      venue: r.venue,
      mapUrl: safeHref(r.mapUrl),
      description: r.description,
      cancelled: r.cancelled,
      dateTbc: r.dateTbc,
      season: r.season,
    });
  }
  return items;
}
