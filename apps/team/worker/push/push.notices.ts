// What's news to whom (ADR 0108): each route that makes news says so with one of these (Route.notify). Read before
// the change where it needs to compare, and after it, never in the way of the change itself.
import { all, first } from "@cougars/shared/d1";
import { formatDayDate } from "../../src/lib/dates";
import { id, type Ctx, type Notify } from "../api/api.route";
import { TABLES, type EntryKind } from "../entries/entries";
import { announcementSummary } from "../announcements/announcements";

/** An event as a notification names it, and where it is in the app. */
async function eventOf(db: D1Database, kind: EntryKind, eventId: number) {
  if (kind === "session") {
    const s = await first<{ heldOn: string; slug: string }>(
      db,
      `SELECT s.held_on heldOn, ts.slug FROM training_sessions s JOIN training_series ts ON ts.id = s.series_id
       WHERE s.id = ?`,
      [eventId],
    );
    return s && { name: formatDayDate(s.heldOn), path: `/training/${s.slug}` };
  }
  if (kind === "tournament") {
    const t = await first<{ name: string; slug: string }>(db, "SELECT name, slug FROM tournaments WHERE id = ?", [
      eventId,
    ]);
    return t && { name: t.name, path: `/tournaments/${t.slug}` };
  }
  const e = await first<{ title: string }>(db, "SELECT title FROM club_events WHERE id = ?", [eventId]);
  return e && { name: e.title, path: "/calendar" };
}

/** Who's in and who's waiting for an event: the route's first path number. */
const answers = (kind: EntryKind) => (c: Ctx) =>
  all<{ memberId: number; signup: string }>(
    c.env.DB,
    `SELECT member_id memberId, signup FROM ${TABLES[kind].table} WHERE ${TABLES[kind].key} = ?
       AND signup IN ('in', 'waitlist')`,
    [id(c)],
  );

/** A place came up (or the team maker let them in): whoever was waiting and is in now hears it. */
export const movedUp = (kind: EntryKind, why = "A place came up"): Notify<{ memberId: number; signup: string }[]> => ({
  before: answers(kind),
  after: async (c, before) => {
    const waiting = new Set(before.filter((a) => a.signup === "waitlist").map((a) => a.memberId));
    const up = (await answers(kind)(c)).filter((a) => a.signup === "in" && waiting.has(a.memberId));
    const event = up.length ? await eventOf(c.env.DB, kind, id(c)) : null;
    if (!event) return [];
    return [
      {
        to: up.map((a) => a.memberId),
        title: "You're in",
        body: `${why}: you're in for ${event.name}.`,
        path: event.path,
      },
    ];
  },
});

/** The night's teams are out: each player hears which team they're on. */
export const teamsOut: Notify = {
  after: async (c) => {
    const event = await eventOf(c.env.DB, "session", id(c));
    if (!event) return [];
    const teams = await all<{ name: string; players: string }>(
      c.env.DB,
      `SELECT t.name, (SELECT json_group_array(p.member_id) FROM session_team_players p WHERE p.team_id = t.id) players
       FROM session_teams t WHERE t.session_id = ? ORDER BY t.position`,
      [id(c)],
    );
    return teams.map((t) => ({
      to: JSON.parse(t.players) as number[],
      title: "Teams are out",
      body: `${event.name}: you're on ${t.name}.`,
      path: event.path,
    }));
  },
};

/** A session's off: everyone in or waiting then hears it (putting it back on isn't news to send). */
const cancelledAt = (c: Ctx) =>
  first<{ cancelled: string | null }>(c.env.DB, "SELECT cancelled_at cancelled FROM training_sessions WHERE id = ?", [
    id(c),
  ]);
export const sessionOff: Notify<{ cancelled: string | null; who: number[] }> = {
  before: async (c) => ({
    cancelled: (await cancelledAt(c))?.cancelled ?? null,
    who: (await answers("session")(c)).map((a) => a.memberId),
  }),
  after: async (c, before) => {
    if (before.cancelled || !before.who.length || !(await cancelledAt(c))?.cancelled) return [];
    const event = await eventOf(c.env.DB, "session", id(c));
    return event
      ? [{ to: before.who, title: `${event.name} is off`, body: "No training that night.", path: event.path }]
      : [];
  },
};

/** An announcement: everyone with the app hears it, as it's on Home. */
export const announced: Notify = {
  after: async (c, _before, reply) => {
    const a = (await announcementSummary(c.env.DB, reply.id as number)) as { title: string; body: string } | null;
    return a ? [{ to: "everyone", title: a.title, body: a.body.slice(0, 180), path: "/" }] : [];
  },
};
