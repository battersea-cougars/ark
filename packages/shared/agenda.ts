// The club's agenda (ADR 0042): one list of what's on and when. Each part of the club pushes its own rows when it
// changes: a training's sessions (syncSeries), a tournament's day, draft night and sign-up deadline (syncTournament),
// a one-off event (syncClubEvent). The website's What's on and the app's calendar read it, so they can't disagree.
// The rules for each kind of row live here, once: where it is (its own place, else its series'), TBC and seasons,
// what's public, what's cancelled, who sees it.
import { all, batch, first, statement, type Param } from "./d1";
import { afterOf, placeOf, type After, type AfterMode, type OwnPlace, type Venue } from "./places";
import { seasonLabel, type Season } from "./seasons";
import { londonDay, londonISO } from "./london";

export type AgendaKind = "training" | "tournament" | "draft" | "signup_closes" | "event";
type Source = "session" | "tournament" | "club_event";

export interface AgendaItem {
  key: string;
  source: Source;
  sourceId: number;
  kind: AgendaKind;
  /** The calendar's filter: series:1, type:1, tournament (no series), social. */
  group: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  /** Its London date. */
  day: string;
  allDay: boolean;
  dateTbc: boolean;
  /** "Summer 2027" for a tournament that's only a season so far (ADR 0030). */
  season: string | null;
  venue: string;
  mapUrl: string;
  description: string;
  public: boolean;
  cancelled: boolean;
  audience: "everyone" | "captains";
}

type SeriesPlace = { seriesVenueId: number | null; seriesName: string; seriesMapUrl: string };

const VENUES = "SELECT id, name, address, map_url mapUrl, active FROM venues";

/** Its own place wins, else its series' (ADR 0030). */
function where(own: OwnPlace, venues: Venue[], series?: SeriesPlace) {
  const usual = series
    ? placeOf({ venueId: series.seriesVenueId, name: series.seriesName, mapUrl: series.seriesMapUrl }, venues)
    : null;
  const place = placeOf(own, venues, usual);
  return { venue: place?.name ?? "", mapUrl: place?.mapUrl ?? "" };
}

const item = (i: Omit<AgendaItem, "key">): AgendaItem => ({ ...i, key: `${i.source}:${i.sourceId}:${i.kind}` });

// ─── Training sessions ───

type SessionRow = OwnPlace &
  SeriesPlace & {
    id: number;
    seriesId: number;
    title: string;
    heldOn: string;
    startTime: string;
    endTime: string;
    note: string | null;
    cancelledAt: string | null;
    public: number;
    active: number;
  };

// A session's own time and place, where it differs from its series
const sessionRows = (filter: string) =>
  `SELECT s.id, s.series_id seriesId, r.name title, s.held_on heldOn, COALESCE(s.start_time, r.start_time) startTime,
          COALESCE(s.end_time, r.end_time) endTime, s.venue_id venueId, COALESCE(s.venue, '') name,
          COALESCE(s.map_url, '') mapUrl, r.venue_id seriesVenueId, r.venue seriesName, r.map_url seriesMapUrl,
          s.note, s.cancelled_at cancelledAt, r.public, r.active
   FROM training_sessions s JOIN training_series r ON r.id = s.series_id ${filter}`;

function sessionItems(rows: SessionRow[], venues: Venue[]) {
  return {
    ids: rows.map((r) => r.id),
    items: rows
      // A paused training's sessions aren't on
      .filter((s) => s.active)
      .map((s) =>
        item({
          source: "session",
          sourceId: s.id,
          kind: "training",
          group: `series:${s.seriesId}`,
          title: s.title,
          startsAt: londonISO(s.heldOn, s.startTime),
          endsAt: londonISO(s.heldOn, s.endTime),
          day: s.heldOn,
          allDay: false,
          dateTbc: false,
          season: null,
          ...where(s, venues, s),
          description: s.note ?? "",
          public: !!s.public,
          cancelled: !!s.cancelledAt,
          audience: "everyone",
        }),
      ),
  };
}

// ─── Tournaments: the day, the draft night, the sign-up deadline ───

type TournamentRow = OwnPlace &
  SeriesPlace & {
    id: number;
    typeId: number | null;
    title: string;
    heldOn: string;
    startTime: string;
    endTime: string;
    season: Season | null;
    public: number;
    status: string;
    kind: string;
    signupClosesOn: string | null;
    signupClosedAt: string | null;
    draftOn: string | null;
    draftState: string;
    afterMode: AfterMode;
    afterVenueId: number | null;
    afterTime: string | null;
    afterNote: string;
    seriesAfterVenueId: number | null;
    seriesAfterTime: string | null;
    seriesAfterNote: string | null;
  };

const tournamentRows = (filter: string) =>
  `SELECT t.id, t.type_id typeId, t.name title, t.venue_id venueId, t.location name, t.map_url mapUrl,
          y.venue_id seriesVenueId, COALESCE(y.location, '') seriesName, COALESCE(y.map_url, '') seriesMapUrl,
          t.held_on heldOn, t.start_time startTime, t.end_time endTime, t.season,
          t.public, t.status, t.kind, t.signup_closes_on signupClosesOn, t.signup_closed_at signupClosedAt, t.draft_on draftOn,
          t.draft_state draftState, t.after_mode afterMode, t.after_venue_id afterVenueId, t.after_time afterTime,
          t.after_note afterNote, y.after_venue_id seriesAfterVenueId, y.after_time seriesAfterTime,
          y.after_note seriesAfterNote
   FROM tournaments t LEFT JOIN tournament_types y ON y.id = t.type_id ${filter}`;

function tournamentItems(rows: TournamentRow[], venues: Venue[]) {
  const items: AgendaItem[] = [];
  for (const t of rows) {
    // A finished tournament is history, not what's on
    if (t.status === "finished") continue;
    const base = {
      source: "tournament" as const,
      sourceId: t.id,
      group: t.typeId ? `type:${t.typeId}` : "tournament",
      ...where(t, venues, t),
      description: "",
      cancelled: false,
    };
    // Where everyone goes afterwards (ADR 0074): its own, else its series', said on the day's entry
    const after = afterOf(
      t.afterMode,
      { venueId: t.afterVenueId, time: t.afterTime, note: t.afterNote },
      { venueId: t.seriesAfterVenueId, time: t.seriesAfterTime, note: t.seriesAfterNote ?? "" },
      venues,
    );
    items.push(
      item({
        ...base,
        description: after ? afterwardsLine(after) : "",
        kind: "tournament",
        title: t.title,
        startsAt: londonISO(t.heldOn, t.startTime),
        endsAt: londonISO(t.heldOn, t.endTime),
        day: t.heldOn,
        allDay: false,
        // Just a season: no day yet
        dateTbc: !!t.season,
        season: t.season ? seasonLabel(t.season, t.heldOn) : null,
        public: !!t.public,
        audience: "everyone",
      }),
    );
    // The last day to say you're in: for members, not the website (none once an admin's closed it)
    if (t.signupClosesOn && !t.signupClosedAt && (t.status === "planned" || t.status === "open"))
      items.push(
        item({
          ...base,
          kind: "signup_closes",
          title: `${t.title}: sign-up closes`,
          startsAt: londonISO(t.signupClosesOn, "00:00"),
          endsAt: null,
          day: t.signupClosesOn,
          allDay: true,
          dateTbc: false,
          season: null,
          public: false,
          audience: "everyone",
        }),
      );
    // The draft's day: a reminder for its captains (and whoever runs it), with no time (an admin says when it opens),
    // until it's closed
    if (t.kind === "draft" && t.draftOn && t.draftState !== "closed")
      items.push(
        item({
          ...base,
          kind: "draft",
          title: `${t.title}: the draft`,
          startsAt: londonISO(t.draftOn, "00:00"),
          endsAt: null,
          day: t.draftOn,
          allDay: true,
          dateTbc: false,
          season: null,
          public: false,
          audience: "captains",
        }),
      );
  }
  return { ids: rows.map((r) => r.id), items };
}

/** The day's entry says where everyone goes after: "Afterwards: The Anchor, from 9:45pm. Celebration and awards." */
export function afterwardsLine(after: After) {
  const [h, m] = (after.time ?? "").split(":").map(Number);
  const at = after.time
    ? `, from ${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`
    : "";
  const note = after.note && (/[.!?]$/.test(after.note) ? after.note : `${after.note}.`);
  return `Afterwards: ${after.name}${at}.${note ? ` ${note}` : ""}`;
}

// ─── One-off events ───

type EventRow = OwnPlace & {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string;
  description: string;
  public: number;
  cancelledAt: string | null;
};

const eventRows = (filter: string) =>
  `SELECT id, title, starts_at startsAt, ends_at endsAt, venue_id venueId, venue name, map_url mapUrl, description,
          public, cancelled_at cancelledAt
   FROM club_events ${filter}`;

function eventItems(rows: EventRow[], venues: Venue[]) {
  return {
    ids: rows.map((r) => r.id),
    items: rows.map((e) =>
      item({
        source: "club_event",
        sourceId: e.id,
        kind: "event",
        group: "social",
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        day: londonDay(e.startsAt),
        allDay: false,
        dateTbc: false,
        season: null,
        ...where(e, venues),
        description: e.description,
        public: !!e.public,
        cancelled: !!e.cancelledAt,
        audience: "everyone",
      }),
    ),
  };
}

// ─── Writing ───

// The agenda's columns, in order, as each row goes to D1 (a JSON array per row)
const COLUMNS = [
  "source",
  "source_id",
  "kind",
  "group_key",
  "title",
  "starts_at",
  "ends_at",
  "day",
  "all_day",
  "date_tbc",
  "season",
  "venue",
  "map_url",
  "description",
  "public",
  "cancelled",
  "audience",
] as const;

/**
 * Replace these sources' rows with what they are now: two statements, to send in one batch, each taking the whole
 * list (JSON), however many rows (ADR 0059).
 */
function writes(db: D1Database, source: Source, ids: number[], items: AgendaItem[]) {
  const rows = items.map((i) => [
    i.source,
    i.sourceId,
    i.kind,
    i.group,
    i.title,
    i.startsAt,
    i.endsAt,
    i.day,
    i.allDay ? 1 : 0,
    i.dateTbc ? 1 : 0,
    i.season,
    i.venue,
    i.mapUrl,
    i.description,
    i.public ? 1 : 0,
    i.cancelled ? 1 : 0,
    i.audience,
  ]);
  return [
    statement(db, "DELETE FROM agenda WHERE source = ? AND source_id IN (SELECT value FROM json_each(?))", [
      source,
      JSON.stringify(ids),
    ]),
    statement(
      db,
      `INSERT INTO agenda (${COLUMNS.join(", ")})
       SELECT ${COLUMNS.map((_, n) => `value ->> ${n}`).join(", ")} FROM json_each(?)`,
      [JSON.stringify(rows)],
    ),
  ];
}

/**
 * What a sync reads, in one round trip: whether the agenda has anything yet, the venues, and the rows it's about. Null
 * when the agenda was empty (a fresh database): it's been filled whole, which covers what was asked for too.
 */
async function readForSync<T>(db: D1Database, sql: string, params: Param[]) {
  const [filled, venues, rows] = await batch(db, [
    statement(db, "SELECT 1 FROM agenda LIMIT 1"),
    statement(db, VENUES),
    statement(db, sql, params),
  ]);
  if (!filled.results.length) {
    await syncAll(db);
    return null;
  }
  return { venues: venues.results as Venue[], rows: rows.results as T[] };
}

/** Trainings' sessions, after the series (one or several) or one of their sessions changed: two round trips. */
export async function syncSeries(db: D1Database, ...seriesIds: number[]) {
  const read = await readForSync<SessionRow>(db, sessionRows("WHERE s.series_id IN (SELECT value FROM json_each(?))"), [
    JSON.stringify(seriesIds),
  ]);
  if (!read) return;
  const { ids, items } = sessionItems(read.rows, read.venues);
  await batch(db, [
    // Sessions the series no longer has (a weekday dropped) go too
    statement(
      db,
      `DELETE FROM agenda WHERE source = 'session' AND source_id NOT IN (SELECT id FROM training_sessions)`,
    ),
    ...writes(db, "session", ids, items),
  ]);
}

/** A tournament's rows: its day, its draft night, its sign-up deadline. */
export async function syncTournament(db: D1Database, id: number) {
  const read = await readForSync<TournamentRow>(db, tournamentRows("WHERE t.id = ?"), [id]);
  if (!read) return;
  await batch(db, writes(db, "tournament", [id], tournamentItems(read.rows, read.venues).items));
}

/** Every tournament in a series: its place is their fallback. */
export async function syncTournamentsOf(db: D1Database, typeId: number) {
  const read = await readForSync<TournamentRow>(db, tournamentRows("WHERE t.type_id = ?"), [typeId]);
  if (!read) return;
  const { ids, items } = tournamentItems(read.rows, read.venues);
  await batch(db, writes(db, "tournament", ids, items));
}

export async function syncClubEvent(db: D1Database, id: number) {
  const read = await readForSync<EventRow>(db, eventRows("WHERE id = ?"), [id]);
  if (!read) return;
  await batch(db, writes(db, "club_event", [id], eventItems(read.rows, read.venues).items));
}

/** Everything, from scratch: after a venue changes (it's everyone's place), or on an empty agenda. Two round trips. */
export async function syncAll(db: D1Database) {
  const [venueRows, sessionRead, tournamentRead, eventRead] = await batch(db, [
    statement(db, VENUES),
    statement(db, sessionRows("")),
    statement(db, tournamentRows("")),
    statement(db, eventRows("")),
  ]);
  const venues = venueRows.results as Venue[];
  const sessions = sessionItems(sessionRead.results as SessionRow[], venues);
  const tournaments = tournamentItems(tournamentRead.results as TournamentRow[], venues);
  const events = eventItems(eventRead.results as EventRow[], venues);
  await batch(db, [
    statement(db, "DELETE FROM agenda"),
    ...writes(db, "session", [], sessions.items),
    ...writes(db, "tournament", [], tournaments.items),
    ...writes(db, "club_event", [], events.items),
  ]);
}

/** A fresh database (just rebuilt) has an empty agenda: fill it once, from what's there. True if it did. */
async function filledFromScratch(db: D1Database) {
  if (await first(db, "SELECT 1 FROM agenda LIMIT 1")) return false;
  await syncAll(db);
  return true;
}

export const ensureAgenda = async (db: D1Database) => void (await filledFromScratch(db));

// ─── Reading ───

export interface AgendaRow {
  source: Source;
  source_id: number;
  kind: AgendaKind;
  group_key: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  day: string;
  all_day: number;
  date_tbc: number;
  season: string | null;
  venue: string;
  map_url: string;
  description: string;
  public: number;
  cancelled: number;
  audience: "everyone" | "captains";
}

export const fromRow = (r: AgendaRow): AgendaItem =>
  item({
    source: r.source,
    sourceId: r.source_id,
    kind: r.kind,
    group: r.group_key,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    day: r.day,
    allDay: !!r.all_day,
    dateTbc: !!r.date_tbc,
    season: r.season,
    venue: r.venue,
    mapUrl: r.map_url,
    description: r.description,
    public: !!r.public,
    cancelled: !!r.cancelled,
    audience: r.audience,
  });

/** What's on from a London day, soonest first. Who sees what is up to the reader (captains' rows, the website). */
export async function readAgenda(db: D1Database, from: string) {
  await ensureAgenda(db);
  return (await all<AgendaRow>(db, "SELECT * FROM agenda WHERE day >= ? ORDER BY starts_at, id", [from])).map(fromRow);
}
