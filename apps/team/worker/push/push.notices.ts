// What's news to whom (ADR 0108): each route that makes news says so with one of these (Route.notify). Read before
// the change where it needs to compare, and after it, never in the way of the change itself.
import { all, batch, first, statement } from "@cougars/shared/d1";
import { formatDayDate } from "../../src/lib/dates";
import { id, type Ctx, type Notify } from "../api/api.route";
import { TABLES, aheadIn, type EntryKind } from "../entries/entries";
import type { Notice } from "./push";
import { announcementSummary } from "../announcements/announcements";
import { nth } from "../../src/lib/draft";

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
    const t = await first<{ name: string; slug: string | null }>(
      db,
      `SELECT t.name, ty.slug FROM tournaments t LEFT JOIN tournament_types ty ON ty.id = t.type_id WHERE t.id = ?`,
      [eventId],
    );
    return t && { name: t.name, path: t.slug ? `/tournaments/${t.slug}` : "/" };
  }
  const e = await first<{ title: string }>(db, "SELECT title FROM club_events WHERE id = ?", [eventId]);
  return e && { name: e.title, path: "/calendar" };
}

/** Who's in and who's waiting for an event (the route's first path number), in its one order (aheadIn). */
const answers = (kind: EntryKind) => (c: Ctx) =>
  all<{ memberId: number; signup: string }>(
    c.env.DB,
    `SELECT e.member_id memberId, e.signup FROM ${TABLES[kind].table} e WHERE e.${TABLES[kind].key} = ?
       AND e.signup IN ('in', 'waitlist') ORDER BY ${aheadIn(kind)} DESC, e.signed_up_at, e.id`,
    [id(c)],
  );

/** One who moved up off a waiting list and hasn't been told yet (`moved_up`), with what they moved up into. */
interface MovedUp {
  memberId: number;
  why: "place" | "let-in";
  kind: EntryKind;
  eventId: number;
  name: string;
  heldOn: string | null;
  path: string;
}

/**
 * Off the waiting list (topic `places`): everyone who moved up into a place and hasn't been told, wherever they moved
 * up (someone out, an admin taking someone off, a limit raised, an account deleted, the register, the team maker's
 * Let in). Each move marked itself (`moved_up`, entries.ts); here they're read and cleared in one batch, so however
 * many requests finish at once (a double tap, two leaving together) each move is told once, by whichever comes first
 * (ADR 0121). Only someone still in hears it.
 */
async function movedUpNotices(c: Ctx): Promise<Notice[]> {
  const db = c.env.DB;
  const [taken] = await batch<MovedUp>(db, [
    statement(
      db,
      `SELECT a.member_id memberId, a.moved_up why, 'session' kind, s.id eventId, ts.name, s.held_on heldOn,
         '/training/' || ts.slug path
       FROM attendance a JOIN training_sessions s ON s.id = a.session_id JOIN training_series ts ON ts.id = s.series_id
       WHERE a.moved_up IS NOT NULL AND a.signup = 'in'
       UNION ALL
       SELECT e.member_id, e.moved_up, 'tournament', t.id, t.name, NULL, COALESCE('/tournaments/' || ty.slug, '/')
       FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id
         LEFT JOIN tournament_types ty ON ty.id = t.type_id
       WHERE e.moved_up IS NOT NULL AND e.signup = 'in'
       UNION ALL
       SELECT e.member_id, e.moved_up, 'event', t.id, t.title, NULL, '/calendar'
       FROM club_event_entries e JOIN club_events t ON t.id = e.event_id
       WHERE e.moved_up IS NOT NULL AND e.signup = 'in'
       ORDER BY kind, eventId, why, memberId`,
      [],
    ),
    ...Object.values(TABLES).map((t) =>
      statement(db, `UPDATE ${t.table} SET moved_up = NULL WHERE moved_up IS NOT NULL`, []),
    ),
  ]);
  const told = new Map<string, Notice>();
  for (const m of taken.results) {
    const key = `${m.kind} ${m.eventId} ${m.why}`;
    const notice = told.get(key) ?? { to: [], topic: "places", title: "You're in", body: youreIn(m), path: m.path };
    (notice.to as number[]).push(m.memberId);
    told.set(key, notice);
  }
  return [...told.values()];
}

/** What "You're in" says: a training with its day, and a nudge; who let them in, if it was the team maker. */
function youreIn(m: MovedUp) {
  const what = m.heldOn ? `${m.name}, ${formatDayDate(m.heldOn)}` : m.name;
  if (m.why === "let-in") return `The team maker let you into ${what}. Don't make them regret it.`;
  return m.heldOn
    ? `A place came up for ${what}. Off the bench, skates on.`
    : `A place came up for ${what}. It's yours.`;
}

/** A change that may move people up off a waiting list (a limit raised, an account deleted): they hear it. */
export const movedUp: Notify = { after: movedUpNotices };

/**
 * Places changed hands (topic `places`): whoever moved up off the waiting list hears they're in (movedUp). Whoever was
 * in and is waiting now had their place taken by a Quarterly Member signing up for a full training, the only thing
 * that does that (ADR 0030, entries.ts bump): they hear it, and where they are in line, before they turn up (#97).
 */
export const places = (kind: EntryKind): Notify<{ memberId: number; signup: string }[]> => ({
  before: answers(kind),
  after: async (c, before) => {
    const up = await movedUpNotices(c);
    const was = new Map(before.map((a) => [a.memberId, a.signup]));
    const waiting = (await answers(kind)(c)).filter((a) => a.signup === "waitlist").map((a) => a.memberId);
    const down = waiting.filter((m) => was.get(m) === "in");
    const event = down.length ? await eventOf(c.env.DB, kind, id(c)) : null;
    if (!event) return up;
    return [
      ...up,
      ...down.map((m): Notice => {
        const place = waiting[0] === m ? "first in line" : `number ${waiting.indexOf(m) + 1} in line`;
        return {
          to: [m],
          topic: "places",
          title: "On the waitlist",
          body: `You're on the waitlist for ${event.name}, ${place}: a Quarterly Member took the last place.`,
          path: event.path,
        };
      }),
    ];
  },
});

/** Each player's team on the night, by member id. */
async function teamOf(c: Ctx) {
  const rows = await all<{ name: string; players: string }>(
    c.env.DB,
    `SELECT t.name, (SELECT json_group_array(p.member_id) FROM session_team_players p WHERE p.team_id = t.id) players
     FROM session_teams t WHERE t.session_id = ? ORDER BY t.position`,
    [id(c)],
  );
  return new Map(rows.flatMap((t) => (JSON.parse(t.players) as number[]).map((m) => [m, t.name] as const)));
}

/**
 * The night's teams are out: each player hears which team they're on. Published again (an admin moving people
 * about), only a player whose team changed hears, that they're now on another.
 */
export const teamsOut: Notify<Map<number, string>> = {
  before: teamOf,
  after: async (c, before) => {
    const event = await eventOf(c.env.DB, "session", id(c));
    if (!event) return [];
    const now = await teamOf(c);
    const out = !before.size;
    const byTeam = new Map<string, number[]>();
    for (const [member, team] of now) {
      if (before.get(member) === team) continue;
      byTeam.set(team, [...(byTeam.get(team) ?? []), member]);
    }
    return [...byTeam].map(([team, to]) => ({
      to,
      topic: "teams" as const,
      title: out ? "Teams are out" : "Team change",
      body: out ? `${event.name}: you're on ${team}.` : `${event.name}: you're now on ${team}.`,
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
      ? [
          {
            to: before.who,
            topic: "sessionOff",
            title: `${event.name} is off`,
            body: "No training that night.",
            path: event.path,
          },
        ]
      : [];
  },
};

/** An announcement: everyone with the app hears it, as it's on Home. */
export const announced: Notify = {
  after: async (c, _before, reply) => {
    const a = (await announcementSummary(c.env.DB, reply.id as number)) as { title: string; body: string } | null;
    return a ? [{ to: "everyone", topic: "announcements", title: a.title, body: a.body.slice(0, 180), path: "/" }] : [];
  },
};

/**
 * The draft's open (ADR 0060): each captain hears it on their phone, with their place in the order ("Winter Cup 2026
 * Draft Open", "You pick 2nd"), and a tap opens the Draft page. Only the first time: a closed draft reopening isn't
 * news (topic `draft`).
 */
export const draftOpen: Notify<string | undefined> = {
  before: async (c) =>
    (await first<{ state: string }>(c.env.DB, "SELECT draft_state state FROM tournaments WHERE id = ?", [id(c)]))
      ?.state,
  after: async (c, before) => {
    if (before !== "none") return [];
    const captains = await all<{ name: string; slug: string | null; memberId: number; pick: number }>(
      c.env.DB,
      `SELECT t.name, ty.slug, tt.captain_member_id memberId, tt.pick FROM tournaments t
       JOIN tournament_teams tt ON tt.tournament_id = t.id LEFT JOIN tournament_types ty ON ty.id = t.type_id
       WHERE t.id = ? AND t.draft_state = 'open' AND tt.captain_member_id IS NOT NULL AND tt.pick IS NOT NULL`,
      [id(c)],
    );
    return captains.map((x) => ({
      to: [x.memberId],
      topic: "draft" as const,
      title: `${x.name} Draft Open`,
      body: `You pick ${nth(x.pick)}`,
      path: x.slug ? `/tournaments/${x.slug}/draft` : "/",
    }));
  },
};

/**
 * An open draft stepped back to its drawn order (ADR 0074): each captain hears it's paused, the picks so far off; they
 * hear it open again (draftOpen) when it does.
 */
export const draftPaused: Notify<string | undefined> = {
  before: draftOpen.before,
  after: async (c, before) => {
    if (before !== "open") return [];
    const captains = await all<{ name: string; slug: string | null; memberId: number }>(
      c.env.DB,
      `SELECT t.name, ty.slug, tt.captain_member_id memberId FROM tournaments t
       JOIN tournament_teams tt ON tt.tournament_id = t.id LEFT JOIN tournament_types ty ON ty.id = t.type_id
       WHERE t.id = ? AND t.draft_state = 'none' AND tt.captain_member_id IS NOT NULL`,
      [id(c)],
    );
    return captains.map((x) => ({
      to: [x.memberId],
      topic: "draft" as const,
      title: `${x.name} Draft Paused`,
      body: "Back to the drawn order. You'll hear when it opens again.",
      path: x.slug ? `/tournaments/${x.slug}/draft` : "/",
    }));
  },
};

/**
 * The awards at the after-party (ADR 0074): the first one revealed, everyone with the app hears it ("Awards at The
 * Anchor"), so anyone not watching the page comes to it. Only the first: the rest they see on the page (topic
 * `announcements`).
 */
export const awardsOut: Notify<number | undefined> = {
  before: async (c) =>
    (await first<{ n: number }>(c.env.DB, "SELECT awards_revealed n FROM tournaments WHERE id = ?", [id(c)]))?.n,
  after: async (c, before) => {
    if (before !== 0) return [];
    const t = await first<{ name: string; slug: string | null; revealed: number; venue: string | null }>(
      c.env.DB,
      `SELECT t.name, ty.slug, t.awards_revealed revealed, v.name venue FROM tournaments t
       LEFT JOIN tournament_types ty ON ty.id = t.type_id
       LEFT JOIN venues v ON v.id = CASE t.after_mode WHEN 'none' THEN NULL WHEN 'own' THEN t.after_venue_id
                                    ELSE ty.after_venue_id END
       WHERE t.id = ?`,
      [id(c)],
    );
    if (!t || t.revealed < 1) return [];
    return [
      {
        to: "everyone",
        topic: "announcements",
        title: t.venue ? `Awards at ${t.venue}` : "The awards are on",
        body: `${t.name}: the first one's out.`,
        path: t.slug ? `/tournaments/${t.slug}` : "/",
      },
    ];
  },
};
