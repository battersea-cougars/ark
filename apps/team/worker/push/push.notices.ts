// What's news to whom (ADR 0108): each route that makes news says so with one of these (Route.notify). Read before
// the change where it needs to compare, and after it, never in the way of the change itself.
import { all, batch, first, statement } from "@cougars/shared/d1";
import { formatDayDate } from "../../src/lib/dates";
import { id, type Ctx, type Notify } from "../api/api.route";
import { TABLES, aheadIn, type EntryKind } from "../entries/entries";
import type { Notice } from "./push";
import { announcementSummary } from "../announcements/announcements";
import { nth } from "../../src/lib/draft";
import { markTold, signupOpenNotice } from "../tournaments/signup";
import { firstCharacters } from "../../src/lib/text";
import { nightPath } from "../../src/lib/night-off";

/** A training night as a notification names it (its day), and where it is in the app: its own page. */
async function sessionOf(db: D1Database, sessionId: number) {
  const s = await first<{ heldOn: string; slug: string }>(
    db,
    `SELECT s.held_on heldOn, ts.slug FROM training_sessions s JOIN training_series ts ON ts.id = s.series_id
     WHERE s.id = ?`,
    [sessionId],
  );
  return s && { name: formatDayDate(s.heldOn), path: nightPath(s.slug, s.heldOn) };
}

/** Who's in and who's waiting for an event, in its one order (aheadIn). */
const answersTo = (db: D1Database, kind: EntryKind, eventId: number) =>
  all<{ memberId: number; signup: string }>(
    db,
    `SELECT e.member_id memberId, e.signup FROM ${TABLES[kind].table} e WHERE e.${TABLES[kind].key} = ?
       AND e.signup IN ('in', 'waitlist') ORDER BY ${aheadIn(kind)} DESC, e.signed_up_at, e.id`,
    [eventId],
  );
/** The same, for the route's event (its first path number). */
const answers = (kind: EntryKind) => (c: Ctx) => answersTo(c.env.DB, kind, id(c));

/** One whose place moved and who hasn't been told yet (`moved`), with the event it's on. */
interface Moved {
  memberId: number;
  moved: "place" | "let-in" | "bumped";
  kind: EntryKind;
  eventId: number;
  name: string;
  heldOn: string | null;
  /** A training night's series (its page is the night's own, nightPath); for the rest, `path` is where it is */
  slug: string | null;
  path: string | null;
}

/**
 * Places changed hands (topic `places`), however they did (someone out, an admin taking someone off, a limit raised,
 * an account deleted, the register, the team maker's Let in, a Quarterly Member signing up for a full training):
 * whoever moved up off the waiting list hears they're in; whoever a Quarterly Member bumped to it (ADR 0030, entries.ts
 * bump) hears it, and where they are in line, before they turn up (#97). Each move marked itself (`moved`,
 * entries.ts); here every mark is read and cleared in one batch, so however many requests finish at once (a double
 * tap, two leaving or joining together) each move is told once, by whichever comes first (ADR 0121). Only someone
 * still where the move put them hears it.
 */
async function placesMoved(c: Ctx): Promise<Notice[]> {
  const db = c.env.DB;
  const where = `IS NOT NULL AND signup = CASE moved WHEN 'bumped' THEN 'waitlist' ELSE 'in' END`;
  const [taken] = await batch<Moved>(db, [
    statement(
      db,
      `SELECT a.member_id memberId, a.moved, 'session' kind, s.id eventId, ts.name, s.held_on heldOn, ts.slug,
         NULL path
       FROM attendance a JOIN training_sessions s ON s.id = a.session_id JOIN training_series ts ON ts.id = s.series_id
       WHERE a.moved ${where}
       UNION ALL
       SELECT e.member_id, e.moved, 'tournament', t.id, t.name, NULL, NULL, COALESCE('/tournaments/' || ty.slug, '/')
       FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id
         LEFT JOIN tournament_types ty ON ty.id = t.type_id
       WHERE e.moved ${where}
       UNION ALL
       SELECT e.member_id, e.moved, 'event', t.id, t.title, NULL, NULL, '/calendar'
       FROM club_event_entries e JOIN club_events t ON t.id = e.event_id
       WHERE e.moved ${where}
       ORDER BY kind, eventId, moved, memberId`,
      [],
    ),
    ...Object.values(TABLES).map((t) =>
      statement(db, `UPDATE ${t.table} SET moved = NULL WHERE moved IS NOT NULL`, []),
    ),
  ]);
  const up = new Map<string, Notice>();
  const down: Notice[] = [];
  const lines = new Map<number, Promise<number[]>>();
  for (const m of taken.results) {
    if (m.moved === "bumped") {
      // Where they are in line now: the waiting list in its one order
      if (!lines.has(m.eventId))
        lines.set(
          m.eventId,
          answersTo(db, "session", m.eventId).then((a) =>
            a.filter((x) => x.signup === "waitlist").map((x) => x.memberId),
          ),
        );
      const waiting = await lines.get(m.eventId)!;
      const n = waiting.indexOf(m.memberId);
      const place = n <= 0 ? "first in line" : `number ${n + 1} in line`;
      down.push({
        to: [m.memberId],
        topic: "places",
        key: placeKey(m),
        says: "waitlist",
        title: "On the waitlist",
        body: `You're on the waitlist for ${formatDayDate(m.heldOn!)}, ${place}: a Quarterly Member took the last place.`,
        path: pathOf(m),
      });
      continue;
    }
    const key = `${m.kind} ${m.eventId} ${m.moved}`;
    const notice = up.get(key) ?? {
      to: [],
      topic: "places",
      key: placeKey(m),
      says: "in",
      title: "You're in",
      body: youreIn(m),
      path: pathOf(m),
    };
    (notice.to as number[]).push(m.memberId);
    up.set(key, notice);
  }
  return [...up.values(), ...down];
}

/** Where a move is in the app: a training night's own page, or the event's. */
const pathOf = (m: Moved) => (m.slug ? nightPath(m.slug, m.heldOn!) : (m.path ?? "/"));

/** A member's place on one event, for the debounce: in, bumped and in again within it is one thing, and nothing new. */
const placeKey = (m: Moved) => `places:${m.kind}:${m.eventId}`;

/** What "You're in" says: a training with its day, and a nudge; who let them in, if it was the team maker. */
function youreIn(m: Moved) {
  const what = m.heldOn ? `${m.name}, ${formatDayDate(m.heldOn)}` : m.name;
  if (m.moved === "let-in") return `The team maker let you into ${what}. Don't make them regret it.`;
  return m.heldOn
    ? `A place came up for ${what}. Off the bench, skates on.`
    : `A place came up for ${what}. It's yours.`;
}

/** Every route that can move someone's place (in, waiting, off) says `notify: places`. */
export const places: Notify = { after: placesMoved };

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
    const event = await sessionOf(c.env.DB, id(c));
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
      key: `teams:${id(c)}`,
      says: team,
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
    const event = await sessionOf(c.env.DB, id(c));
    return event
      ? [
          {
            to: before.who,
            topic: "sessionOff",
            key: `session-off:${id(c)}`,
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
    return a
      ? [
          {
            to: "everyone",
            topic: "announcements",
            key: `announcement:${reply.id}`,
            title: a.title,
            body: firstCharacters(a.body, 180),
            path: "/",
          },
        ]
      : [];
  },
};

/**
 * The draft's open (ADR 0060): each captain hears it on their phone, with their place in the order ("Winter Cup 2026
 * Draft Open", "You pick 2nd"), and a tap opens the Draft page. Only the first time: a closed draft reopening isn't
 * news (topic `draft`). Live: the draft is on the night, so it goes in quiet hours too.
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
      key: `draft:${id(c)}`,
      live: true,
      title: `${x.name} Draft Open`,
      body: `You pick ${nth(x.pick)}`,
      path: x.slug ? `/tournaments/${x.slug}/draft` : "/",
    }));
  },
};

/**
 * An open draft stepped back to its drawn order (ADR 0074): each captain hears it's paused, the picks so far off; they
 * hear it open again (draftOpen) when it does. Live, like the opening.
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
      key: `draft:${id(c)}`,
      live: true,
      title: `${x.name} Draft Paused`,
      body: "Back to the drawn order. You'll hear when it opens again.",
      path: x.slug ? `/tournaments/${x.slug}/draft` : "/",
    }));
  },
};

/**
 * A draft moved to another status in one go (Move to…, ADR 0074): opened, its captains hear it as they would from the
 * Draft page (draftOpen); paused, the same (draftPaused); its teams set with the rest chosen at random, each captain
 * hears so ("the rest were chosen at random"), so nobody thinks their captain picked them. Live, like the rest.
 */
export const movedTo: Notify<string | undefined> = {
  before: draftOpen.before,
  after: async (c, before, reply) => {
    const told = [...(await draftOpen.after(c, before, reply)), ...(await draftPaused.after(c, before, reply))];
    if (!Number(reply.chosen)) return told;
    const captains = await all<{ name: string; slug: string | null; memberId: number }>(
      c.env.DB,
      `SELECT t.name, ty.slug, tt.captain_member_id memberId FROM tournaments t
       JOIN tournament_teams tt ON tt.tournament_id = t.id LEFT JOIN tournament_types ty ON ty.id = t.type_id
       WHERE t.id = ? AND t.draft_state = 'closed' AND tt.captain_member_id IS NOT NULL`,
      [id(c)],
    );
    return [
      ...told,
      ...captains.map((x) => ({
        to: [x.memberId],
        topic: "draft" as const,
        key: `draft:${id(c)}`,
        live: true,
        title: `${x.name} Teams Set`,
        body: "The draft's closed: the rest were chosen at random.",
        path: x.slug ? `/tournaments/${x.slug}/teams` : "/",
      })),
    ];
  },
};

/**
 * The awards at the after-party (ADR 0074): the first one revealed, everyone with the app hears it ("Awards at The
 * Anchor"), so anyone not watching the page comes to it. Only the first: the rest they see on the page (topic
 * `announcements`). Live: the party's now, past 22:00 as often as not.
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
        key: `awards:${id(c)}`,
        live: true,
        title: t.venue ? `Awards at ${t.venue}` : "The awards are on",
        body: `${t.name}: the first one's out.`,
        path: t.slug ? `/tournaments/${t.slug}` : "/",
      },
    ];
  },
};

/**
 * A tournament saved (its editor's Save): a limit raised lets the first waiting in, and they hear it (places); and a
 * sign-up an admin has just opened by hand (status planned to open) is told to everyone, the Kumite's as an invitation
 * (tournaments/signup.ts signupOpenNotice). Only the first time it opens: whichever tells it first, this or the cron on
 * its opening day, marks it told.
 */
export const tournamentSaved: Notify<string | undefined> = {
  before: async (c) =>
    (await first<{ status: string }>(c.env.DB, "SELECT status FROM tournaments WHERE id = ?", [id(c)]))?.status,
  after: async (c, before, reply) => [
    ...(await places.after(c, undefined, reply)),
    ...(before === "planned" ? await openedByHand(c, id(c)) : []),
  ],
};

/** A tournament made with its sign-up open: news, the same as one opened by hand. */
export const tournamentMade: Notify = {
  after: async (c, _, reply) => (typeof reply.id === "number" ? openedByHand(c, reply.id) : []),
};

const openedByHand = async (c: Ctx, tournamentId: number) =>
  (await markTold(c.env.DB, "id = ? AND status = 'open'", [tournamentId], new Date(c.now))).map(signupOpenNotice);
