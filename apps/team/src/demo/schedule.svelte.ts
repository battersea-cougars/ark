// Reading the schedule: sessions resolved against their series, the next session or tournament, and the
// calendar as one list. Everything here reads `db`, so pages that use it update when an admin edits a series.
import { nightOpen, nightOpensOn, opensWords, signupOpen, signupOver } from "../lib/signup";
import { atAfters, currentOf, editionState, hasStarted, latestOf } from "../lib/edition";
import { clockRange, formatDayDate, formatTime, londonEvening, londonISO, londonToday } from "../lib/dates";
import type { AgendaRow, Bookable, OneOff, Tournament, TournamentType, TrainingSeries, TrainingSession } from "./model";
import { db } from "./store.svelte";
import { nightPath, trainingNights } from "../lib/night-off";
import { registerClosed, registerClosedWords } from "../lib/register-closes";
import { nightPhase, timedPhase, tournamentPhase, type Phase } from "../lib/phase";
import { seasonLabel, seasonYear } from "@cougars/shared/seasons";
import { afterOf, placeOf, type Place } from "@cougars/shared/places";

export const seriesById = (id: number) => db.series.find((s) => s.id === id);
export const typeById = (id: number | null) => db.tournamentTypes.find((t) => t.id === id);

/**
 * When a tournament is, for a line of text: "Sat 12 June · 11am to 4pm", or "Summer 2027" while it's just a season.
 */
export const whenOf = (t: Tournament) =>
  t.season
    ? seasonLabel(t.season, t.heldOn)
    : `${formatDayDate(londonISO(t.heldOn, t.startTime))} · ${clockRange(t.startTime, t.endTime)}`;

// Where each thing really is (ADR 0030): its saved venue, else its own name and map link, else its series' place
export const seriesPlace = (s: TrainingSeries) =>
  placeOf({ venueId: s.venueId, name: s.venue, mapUrl: s.mapUrl }, db.venues);
export const typePlace = (t: TournamentType | undefined) =>
  t ? placeOf({ venueId: t.venueId, name: t.location, mapUrl: t.mapUrl }, db.venues) : null;
export const tournamentPlace = (t: Tournament) =>
  placeOf({ venueId: t.venueId, name: t.location, mapUrl: t.mapUrl }, db.venues, typePlace(typeById(t.typeId)));
/** A series' afterwards (ADR 0074): where everyone goes after each of its dates, unless one says otherwise. */
export const typeAfter = (t: TournamentType | undefined) =>
  t ? afterOf("own", { venueId: t.afterVenueId, time: t.afterTime, note: t.afterNote }, null, db.venues) : null;
/** Where everyone goes after this one (ADR 0074): its own, its series', or none this time. */
export const tournamentAfter = (t: Tournament) => {
  const type = typeById(t.typeId);
  return afterOf(
    t.afterMode ?? "usual",
    { venueId: t.afterVenueId ?? null, time: t.afterTime ?? null, note: t.afterNote ?? "" },
    type ? { venueId: type.afterVenueId, time: type.afterTime, note: type.afterNote } : null,
    db.venues,
  );
};
export const oneOffPlace = (o: OneOff) => placeOf({ venueId: o.venueId, name: o.venue, mapUrl: o.mapUrl }, db.venues);

/** A Bookable's where: the name, the address and the map link. */
const where = (p: Place | null) => ({ venue: p?.name ?? "", address: p?.address ?? "", mapUrl: p?.mapUrl ?? "" });

/** A session with the series filled in where it doesn't override. */
export function resolve(session: TrainingSession, series = seriesById(session.seriesId)!) {
  return {
    session,
    series,
    heldOn: session.heldOn,
    startTime: session.startTime ?? series.startTime,
    endTime: session.endTime ?? series.endTime,
    place: placeOf(
      { venueId: session.venueId ?? null, name: session.venue ?? "", mapUrl: session.mapUrl ?? "" },
      db.venues,
      seriesPlace(series),
    ),
    capacity: session.capacity ?? series.capacity,
    goalieCapacity: series.goalieCapacity ?? null,
    cancelled: Boolean(session.cancelledAt),
  };
}

export function sessionBookable(session: TrainingSession): Bookable {
  const r = resolve(session);
  // Not open yet (ADR 0030): when it opens, where In would be
  const today = londonToday();
  const opensOn = nightOpensOn(r.heldOn, r.series.signupOpensDays);
  const opens =
    opensOn && !nightOpen(r.heldOn, r.series.signupOpensDays, today) ? opensWords(opensOn, today, true) : undefined;
  // Once it's started, who's in is the register's (ADR 0131, #167): the server refuses a member's own In or Out
  const startsAt = londonISO(r.heldOn, r.startTime);
  const endsAt = londonISO(r.heldOn, r.endTime);
  const started = !r.cancelled && Date.now() >= Date.parse(startsAt);
  return {
    key: `session:${session.id}`,
    kind: "training",
    filter: `series:${r.series.id}`,
    icon: r.series.icon,
    tone: r.series.tone,
    title: r.series.name,
    startsAt,
    endsAt,
    ...where(r.place),
    signup: !r.cancelled,
    started,
    // Over, then (06:00 the morning after, #11) the register's closed: what it says is the record
    startedWords: !started
      ? undefined
      : registerClosed(r.heldOn)
        ? registerClosedWords(r.heldOn)
        : Date.now() >= Date.parse(endsAt)
          ? "Over: the register says who came"
          : "Started: the register says who's in",
    capacity: r.capacity,
    goalieCapacity: r.goalieCapacity,
    cancelled: r.cancelled,
    href: nightPath(r.series.slug, r.heldOn),
    opens,
    // Held once its register closes, not when its time's up (lib/phase.ts)
    phase: nightPhase({ heldOn: r.heldOn, startsAt, registerClosedAt: session.registerClosedAt }),
    entries: session,
  };
}

export function tournamentBookable(t: Tournament): Bookable {
  // One on its own, in no series: a trophy in the club's red, with no section of its own to link to
  const type = typeById(t.typeId);
  return {
    key: `tournament:${t.id}`,
    kind: "tournament",
    filter: type ? `type:${type.id}` : "tournaments",
    icon: type?.icon ?? "trophy",
    tone: type?.tone ?? "red",
    title: t.name,
    startsAt: londonISO(t.heldOn, t.startTime),
    endsAt: londonISO(t.heldOn, t.endTime),
    ...where(tournamentPlace(t)),
    // Started (or played early), nobody's signing up, whatever its sign-up's dates say
    signup: signupOpen(t, londonToday()) && !hasStarted(t),
    started: hasStarted(t),
    // By its games, never its date (lib/phase.ts): played early is past, its day gone by unplayed still next
    phase: tournamentPhase(t),
    capacity: t.capacity,
    dateTbc: !!t.season,
    season: t.season ? { name: t.season, year: seasonYear(t.season, t.heldOn) } : undefined,
    href: type ? `/tournaments/${type.slug}` : undefined,
    entries: t,
  };
}

/** Past the last day to say you're in (London), for a tournament with one, or an admin closed it. */
export const signupClosed = (t: Tournament, today = londonToday()) => signupOver(t, today);

/**
 * The next session of a series that isn't cancelled (or the next at all, if they all are): from London's evening, so
 * last night's is still it till its register closes at 06:00 (lib/phase.ts).
 */
export const nextSession = (series: TrainingSeries, evening = londonEvening()): TrainingSession | undefined =>
  trainingNights(db.sessions, series.id, evening).shown;

/** A training's page: its next night that's on, and those off from then to it, or one night's own (lib/night-off.ts). */
export const seriesNights = (series: TrainingSeries, evening = londonEvening(), on?: string) =>
  trainingNights(db.sessions, series.id, evening, on);

/** A series' latest (lib/edition.ts latestOf): what the app's Home teases. */
export const latestTournament = (typeId: number) => latestOf(db.tournaments.filter((t) => t.typeId === typeId));

/** What a series' pages show: the one on or coming up, else none (lib/edition.ts currentOf). */
export const currentTournament = (typeId: number, evening = londonEvening()) =>
  currentOf(
    db.tournaments.filter((t) => t.typeId === typeId),
    evening,
  );

/** Its past ones, played: newest first (History, or the front page when nothing's on). Not tonight's, at its
 * after-party: it's still on, till the morning (lib/edition.ts atAfters). */
export const pastTournaments = (typeId: number, evening = londonEvening()) =>
  db.tournaments
    .filter((t) => t.typeId === typeId && editionState(t) === "done" && !atAfters(t, evening))
    .sort((a, b) => b.heldOn.localeCompare(a.heldOn));

const oneOffBookable = (o: OneOff): Bookable => ({
  key: `oneoff:${o.id}`,
  kind: "social",
  filter: "social",
  icon: "glass",
  tone: "amber",
  title: o.title,
  startsAt: o.startsAt,
  endsAt: o.endsAt,
  ...where(oneOffPlace(o)),
  description: o.description,
  signup: o.signup && !o.cancelledAt,
  capacity: o.capacity,
  cancelled: !!o.cancelledAt,
  // A social has no status: its time is all there is
  phase: timedPhase(o.startsAt, o.endsAt),
  entries: o,
});

/**
 * A reminder's: past with its tournament, or (a sign-up's last day) once it's started; else by its own day, all day.
 */
function reminderPhase(row: AgendaRow, t: Tournament): Phase {
  if (tournamentPhase(t) === "past") return "past";
  if (row.kind === "signup_closes" && hasStarted(t)) return "past";
  return row.day < londonToday() ? "past" : "next";
}

/** A tournament's draft night or sign-up deadline: a reminder on the calendar, linking to where to act. */
function reminderBookable(row: AgendaRow, t: Tournament): Bookable {
  const type = typeById(t.typeId);
  return {
    key: row.key,
    kind: "tournament",
    filter: type ? `type:${type.id}` : "tournaments",
    icon: row.kind === "draft" ? "draft" : (type?.icon ?? "trophy"),
    tone: type?.tone ?? "red",
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt ?? row.startsAt,
    venue: row.kind === "draft" ? "" : row.venue,
    timeText:
      row.kind === "signup_closes"
        ? "Last day to say you're in"
        : row.allDay
          ? "Time to be set"
          : `From ${formatTime(row.startsAt)}`,
    signup: false,
    href: type ? `/tournaments/${type.slug}${row.kind === "draft" ? "/draft" : ""}` : undefined,
    phase: reminderPhase(row, t),
    entries: { going: [], waitlist: [] },
  };
}

/**
 * Everything not past, in date order, as the club's agenda has it (ADR 0042): the server sends what's on (and a draft
 * night only for its captains); each one's sign-up and whether it's past comes from its session, tournament or event,
 * by its status, never its date (lib/phase.ts, #182): a Kumite played early isn't on it, one whose day went by unplayed
 * still is, and so is last night's training till its register closes.
 */
export function calendar(): Bookable[] {
  return db.agenda.flatMap(bookableOf).filter((ev) => ev.phase !== "past");
}

/** An agenda row as the calendar shows it, from its session, tournament or event; none for one the app doesn't hold. */
function bookableOf(r: AgendaRow): Bookable[] {
  if (r.source === "session") {
    const s = db.sessions.find((x) => x.id === r.sourceId);
    return s && seriesById(s.seriesId) ? [sessionBookable(s)] : [];
  }
  if (r.source === "club_event") {
    const o = db.oneOffs.find((x) => x.id === r.sourceId);
    return o ? [oneOffBookable(o)] : [];
  }
  const t = db.tournaments.find((x) => x.id === r.sourceId);
  if (!t) return [];
  return [r.kind === "tournament" ? tournamentBookable(t) : reminderBookable(r, t)];
}
