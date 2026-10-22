// Home's feed (ADR 0118). Home is a feed: the club's next event is the hero, whatever kind it is, and your part in it
// is shown on its card (playing in it: your match; in, waiting, or may sign up: In and Out; not in it: You're out). Then what's coming up
// after it, in date order and capped, with "See the calendar". Then what needs you (a captain's draft, the draft
// being on, the teams being out, a sign-up closing you haven't answered), and under "For admins", only for whoever
// they're for, running the draft and what the club is owed. What you owe is Home's foot (owedNotice), and a loud icon
// in its header while some of it is overdue (lib/dues.ts overdue).
import type { AgendaRow, Bookable, Tournament, TournamentGame, TournamentType } from "../demo/model";
import { dateBadge, formatDayDate, formatTime, londonISO, londonToday, pounds, timeRange } from "./dates";
import { draftTurn } from "./draft";
import { ROOM_SOON, roomPath } from "./draft-room";
import { kickOff, slotMinutes } from "./fixtures";
import { signupOpen } from "./signup";
import { myTeamIndex, nextFightOf } from "./tournament-front";

export type FeedIcon = "draft" | "teams" | "pound";

/** One row of the feed: a line, a sub-line, and where it opens (none: just news). `hot`: your move, now. */
export interface FeedItem {
  key: string;
  href?: string;
  text: string;
  sub: string;
  hot: boolean;
  icon: FeedIcon;
  /** The day it's about (a draft night, a sign-up's last day): its date block stands in for the icon. */
  on?: When;
  /** A captain's own draft, with picks still to make or its day to come: it may lead Home, as of this instant. */
  captainAt?: string;
}

/** A date to show as the stacked block (lib/DateBlock): the day, or a season, or not confirmed. */
export interface When {
  at: string;
  season?: { name: string; year: number };
  tbc?: boolean;
}

export type Standing = "in" | "waitlist" | "out";

/** Something on the schedule, as Home knows it (a Bookable), with where you stand on it. */
export interface UpcomingEvent extends Pick<
  Bookable,
  | "key"
  | "kind"
  | "filter"
  | "icon"
  | "title"
  | "startsAt"
  | "endsAt"
  | "venue"
  | "href"
  | "cancelled"
  | "dateTbc"
  | "season"
  | "timeText"
  | "opens"
> {
  standing: Standing | null;
  /** Taking sign-ups now, and you may sign up: only then does Home ask "Are you in?". */
  asking: boolean;
  /** A tournament's sign-up, still to open. (A training night's: `opens`, its short weekday, "Mon".) */
  signupOpensOn?: string | null;
  /** A tournament's sign-up is over (past its last day, or it's under way): nobody can answer now. */
  signupClosed?: boolean;
}

/** A row of what's coming up: its date on the left (Fri / 30 / Oct, or Summer / TBC / 2027), then what and how. */
export interface UpcomingRow {
  key: string;
  href?: string;
  icon: Bookable["icon"];
  on: When;
  text: string;
  sub: string;
}

export interface FeedInput {
  /** Who's looking. */
  me: number;
  /** London's today, YYYY-MM-DD. */
  today: string;
  /** run:Draft: an admin who opens and closes drafts. */
  runsDrafts: boolean;
  agenda: AgendaRow[];
  tournaments: Tournament[];
  types: TournamentType[];
  /** The next edition of each active series, not one that's done. */
  upcoming: { type: TournamentType; t: Tournament }[];
  /** What the club is owed, for whoever sees Unpaid fees (read:Dues); null for everyone else. */
  club: { total: number; people: number; worst: number } | null;
  /** What's on from today, any order: Home picks the lead and the rows. */
  events?: UpcomingEvent[];
  /** The instant Home was opened (ISO); left out, the start of today in London. */
  now?: string;
  /** The lead Home has shown this visit: it stays the lead while it's still on, so nothing jumps when you answer. */
  pinned?: string;
}

/** Your team's next game in a tournament on or coming up: Home's lead when it's your soonest thing. */
export interface Fight {
  type: TournamentType;
  t: Tournament;
  game: TournamentGame;
  teamId: number;
}

/** Your part in the hero: on it (in, waiting, or may sign up), not in it (nothing to answer: the Kumite you're not in,
 * a social with no sign-up), or said you're out. */
export type Role = "yours" | "notIn" | "out";

/** Home's hero: the club's next event, as its card (with your role on it), your next match, or a captain's draft. */
export type Lead =
  | { kind: "event"; key: string; at: string; event: UpcomingEvent; role: Role }
  | { kind: "fight"; key: string; at: string; fight: Fight }
  | { kind: "draft"; key: string; at: string; item: FeedItem };

export interface Feed {
  /** Your next thing, or nothing at all on. */
  lead: Lead | null;
  now: FeedItem[];
  upcoming: UpcomingRow[];
  admin: FeedItem[];
}

/** How far ahead the upcoming list looks for the club's events (a tournament series' next one shows however far). */
export const AHEAD_DAYS = 42;
/** At most this many upcoming rows: then "See the calendar". */
export const UPCOMING_MAX = 7;

const nth = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/** The feed: what needs you now (your move first), what's coming up, then the admins' lines. */
export function homeFeed(input: FeedInput): Feed {
  const rows = [...liveDrafts(input), ...draftNews(input), ...agendaNudges(input)].sort(
    (a, b) => Number(b.hot) - Number(a.hot),
  );
  const forAdmins = (r: FeedItem) => r.key.startsWith("admin:");
  const fights = nextFights(input);
  const lead = leadOf(input, fights, rows);
  // A draft that leads isn't a row as well
  const now = rows.filter((r) => !forAdmins(r) && !(lead?.kind === "draft" && lead.key === r.key));
  const admin = rows.filter(forAdmins);
  const { club } = input;
  if (club && club.total > 0)
    admin.push({
      key: "admin:club-dues",
      href: "/settings/overdue",
      text: `Owed to the club ${pounds(club.total)}`,
      sub: `${club.people} ${club.people === 1 ? "person" : "people"}${club.worst > 0 ? ` · ${pounds(club.worst)} over 90 days late` : ""}`,
      hot: false,
      icon: "pound",
    });
  return { lead, now, upcoming: upcomingRows(input, lead, fights), admin };
}

/** What you owe, and what for: the kind of each charge with something left on it; how much of it is overdue. */
export interface Owes {
  pence: number;
  kinds: string[];
  overdue?: number;
}

/** What you owe, at Home's foot: none when you're square. Overdue is also the loud icon in Home's header. */
export function owedNotice(owes: Owes): { text: string; sub: string; href: string } | null {
  if (owes.pence <= 0) return null;
  const n = owes.kinds.length;
  const what = owes.kinds.every((k) => k === "session")
    ? n === 1
      ? "night"
      : "nights"
    : n === 1
      ? "charge"
      : "charges";
  const late = owes.overdue && owes.overdue > 0 ? ` · ${pounds(owes.overdue)} overdue` : "";
  return { text: `${pounds(owes.pence)} to pay`, sub: `Your tab${n ? ` · ${n} ${what}` : ""}${late}`, href: "/me/tab" };
}

const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" });
/** When it is, as the hero's heading says it: "today", "this Friday" within the week, else "on Fri 6 Nov". */
export function whenSaid(startsAt: string, today: string): string {
  const ahead = Math.round(
    (Date.parse(`${dayOf(startsAt)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
  );
  if (ahead <= 0) return "today";
  return ahead < 7 ? `this ${weekday.format(new Date(startsAt))}` : `on ${formatDayDate(startsAt)}`;
}

const dayOf = (iso: string) => londonToday(new Date(iso));
const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const STANDING: Record<Standing, string> = { in: "You're in", waitlist: "You're on the waitlist", out: "You're out" };

/** A tournament's own key on the schedule (lib/schedule tournamentBookable): its fight stands in for it. */
const tournamentKey = (t: Tournament) => `tournament:${t.id}`;
/** When your fight kicks off, London's wall clock on the tournament's day, as an instant. */
const fightAt = ({ t, game }: Fight) => londonISO(t.heldOn, kickOff(t.startTime, slotMinutes(t), game.position));

/**
 * The hero: the club's next event, whatever it is, with where you stand on it. Yours stand in for theirs: your next
 * match for its tournament, a draft you're a captain in (open, with picks to make: now; else its day). Everything
 * else on the schedule is the event itself, yours to answer or not yours (the Kumite you're not in, a social with no
 * sign-up): it still leads, its card saying where you stand, and so does one you've said you're out of (its card shows
 * your Out, and In is still there). The soonest leads, and at the same moment a match, then a draft, then the
 * schedule's order. A cancelled one, one with no day yet, or one that's over never does. The one Home pinned this
 * visit stays while it's still on, so nothing swaps under your thumb.
 */
export function leadOf(input: FeedInput, fights: Fight[], rows: FeedItem[]): Lead | null {
  const { events = [], today, pinned } = input;
  const nowMs = Date.parse(input.now ?? londonISO(today, "00:00"));
  const next: Lead[] = [];
  for (const fight of fights) {
    if (fight.t.season || fight.t.heldOn < today) continue;
    next.push({ kind: "fight", key: `fight:${fight.t.id}`, at: fightAt(fight), fight });
  }
  for (const item of rows) if (item.captainAt) next.push({ kind: "draft", key: item.key, at: item.captainAt, item });
  const fought = new Set(fights.map((f) => tournamentKey(f.t)));
  for (const event of events) {
    if (event.cancelled || event.season || event.dateTbc || fought.has(event.key)) continue;
    if (Date.parse(event.endsAt) <= nowMs) continue;
    // A sign-up still to open is yours to answer when it does
    const toCome = !!event.opens || (!!event.signupOpensOn && event.signupOpensOn > today);
    const role: Role = event.standing === "out" ? "out" : event.standing || event.asking || toCome ? "yours" : "notIn";
    next.push({ kind: "event", key: event.key, at: event.startsAt, event, role });
  }
  const held = pinned && next.find((l) => l.key === pinned);
  if (held) return held;
  // Soonest first; a stable sort keeps a match, then a draft, then the schedule's order at the same moment
  return [...next].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
}

// Coming up: each training's and each tournament series' next one, the club's events in the next few weeks; the lead
// isn't repeated (for a fight, its tournament). Dated ones by date, a season-only tournament after them; capped
function upcomingRows({ events = [], today }: FeedInput, lead: Lead | null, fights: Fight[]): UpcomingRow[] {
  const shown = !lead
    ? []
    : lead.kind === "event"
      ? [lead.key]
      : lead.kind === "fight"
        ? [tournamentKey(lead.fight.t)]
        : [];
  const until = plusDays(today, AHEAD_DAYS);
  const seen = new Set<string>();
  const sorted = events
    .filter((e) => dayOf(e.startsAt) >= today)
    .sort((a, b) => Number(!!a.season) - Number(!!b.season) || a.startsAt.localeCompare(b.startsAt));
  const picked: UpcomingEvent[] = [];
  for (const e of sorted) {
    // A card up top already says it; the row for its series is then the one after
    if (shown.includes(e.key)) continue;
    // A series' next one: only the first of each counts, and a night that's off isn't it (the one after shows too)
    const series = e.kind === "social" ? null : e.filter;
    if (series && seen.has(series)) continue;
    if (series && !e.cancelled) seen.add(series);
    if (e.kind !== "tournament" && dayOf(e.startsAt) > until) continue;
    picked.push(e);
  }
  // A tournament you've a fight in says when it is
  const fightTimes = new Map(fights.map((f) => [tournamentKey(f.t), formatTime(fightAt(f))]));
  return picked.slice(0, UPCOMING_MAX).map((e) => upcomingRow(e, today, fightTimes.get(e.key)));
}

// How you stand, or how its sign-up does: "Are you in?" only when you can answer now (the sign-up open, by the same
// rules as the event's own page: lib/signup.ts, worked out as Home reads the schedule); else when it opens, that it's
// closed, or just where
function upcomingRow(e: UpcomingEvent, today: string, fight?: string): UpcomingRow {
  const time = e.timeText || (e.season ? "" : timeRange(e.startsAt, e.endsAt));
  const opensOn = e.signupOpensOn && e.signupOpensOn > today ? dateBadge(londonISO(e.signupOpensOn, "12:00")) : null;
  const how = e.cancelled
    ? "Cancelled"
    : fight
      ? `Your match at ${fight}`
      : e.standing
        ? STANDING[e.standing]
        : e.opens
          ? `Sign-up opens ${e.opens}`
          : opensOn
            ? `Sign-up opens ${opensOn.day} ${opensOn.month}`
            : e.signupClosed
              ? "Sign-up closed"
              : e.asking
                ? "Are you in?"
                : e.venue;
  const sub = [e.dateTbc ? "" : time, how].filter(Boolean).join(" · ");
  const on = { at: e.startsAt, season: e.season, tbc: e.dateTbc };
  return { key: e.key, href: e.href, icon: e.icon, on, text: e.title, sub };
}

// From the agenda (ADR 0060, 0042): a captain's draft day, the draft an admin runs, a sign-up about to close (for a
// tournament Home doesn't already ask about)
function agendaNudges({ agenda, tournaments, types, upcoming, me, today, runsDrafts }: FeedInput): FeedItem[] {
  return agenda
    .filter((r) => r.day >= today && (r.kind === "draft" || r.kind === "signup_closes"))
    .flatMap((r): FeedItem[] => {
      const t = tournaments.find((x) => x.id === r.sourceId);
      const type = t && types.find((y) => y.id === t.typeId);
      if (!t || !type) return [];
      // The day is the row's date block; the line says the time, if it has one
      const on = { at: r.startsAt };
      const at = r.allDay ? "" : ` at ${formatTime(r.startsAt)}`;
      if (r.kind === "signup_closes") {
        // The next of a series taking sign-ups is already asked: the lead, or its row in what's coming up
        if (upcoming.some((u) => u.t.id === t.id)) return [];
        if (!signupOpen(t, today) || t.going.includes(me) || t.waitlist.includes(me)) return [];
        return [
          {
            key: r.key,
            href: `/tournaments/${type.slug}`,
            text: `Sign-up for ${t.name} closes`,
            on,
            sub: "Are you in?",
            hot: false,
            icon: "draft",
          },
        ];
      }
      // An open draft has a row of its own (liveDrafts), whatever day it was meant for
      if (t.draftState === "open") return [];
      const href = `/tournaments/${type.slug}/draft`;
      const mine = t.teams.findIndex((x) => x.captainMemberId === me);
      if (mine >= 0)
        return [
          {
            key: r.key,
            href,
            text: `Draft${at}`,
            on,
            sub: `${t.name} · you pick ${nth(mine + 1)}`,
            hot: false,
            icon: "draft",
            captainAt: r.allDay ? londonISO(r.day, "00:00") : r.startsAt,
          },
        ];
      if (!runsDrafts) return [];
      return [
        {
          key: `admin:${r.key}`,
          href,
          text: `Draft${at}`,
          on,
          sub: `${t.name} · open it when the captains are ready`,
          hot: false,
          icon: "draft",
        },
      ];
    });
}

// A draft that's open, for its captains and whoever runs it: on until it's closed, however long that takes. A captain
// hears when it's their pick, or how many picks away it is
function liveDrafts({ upcoming, me, runsDrafts, now, today }: FeedInput): FeedItem[] {
  // A captain with picks still to make: it's on now, so it may lead
  const captainAt = now ?? londonISO(today, "00:00");
  return upcoming.flatMap(({ type, t }): FeedItem[] => {
    if (t.kind !== "draft" || t.draftState !== "open") return [];
    const mine = t.teams.findIndex((x) => x.captainMemberId === me);
    if (mine < 0 && !runsDrafts) return [];
    // Whoever runs the draft and isn't a captain: an admin's line
    const key = mine < 0 ? `admin:draft-open:${t.id}` : `draft-open:${t.id}`;
    const row = { key, href: `/tournaments/${type.slug}/draft`, icon: "draft" as const };
    const { left, until } = draftTurn(t, mine);
    if (!left)
      return [{ ...row, text: "Everyone's picked", sub: `${t.name} · the draft closes to set the teams`, hot: false }];
    if (mine < 0)
      return [{ ...row, text: "The draft's open", sub: `${t.name} · close it once everyone's picked`, hot: true }];
    // Your pick now or close: straight into the draft room (ADR 0060), the whole screen for it
    const soon = { ...row, href: roomPath(type.slug) };
    if (until === 0)
      return [{ ...soon, text: "It's your pick", sub: `${t.name} draft · you're on the clock`, hot: true, captainAt }];
    if (until === Infinity)
      return [{ ...row, text: "The draft's open", sub: `${t.name} · your picks are done`, hot: false }];
    const near = until <= ROOM_SOON ? soon : row;
    return [{ ...near, text: "The draft's open", sub: `${t.name} · you pick in ${until}`, hot: false, captainAt }];
  });
}

// Your next fight, wherever you're on a team with one still to play
function nextFights({ upcoming, me }: FeedInput): Fight[] {
  return upcoming.flatMap(({ type, t }): Fight[] => {
    const game = nextFightOf(t, me);
    const teamId = t.teams[myTeamIndex(t, me)]?.id;
    return game && teamId ? [{ type, t, game, teamId }] : [];
  });
}

// Everyone else (ADR 0060): the draft is the captains' business, so a member hears that it's on, with nothing to open;
// once it's closed, the teams are out, and that's a link to them
function draftNews({ upcoming, me, runsDrafts }: FeedInput): FeedItem[] {
  if (runsDrafts) return [];
  return upcoming.flatMap(({ type, t }): FeedItem[] => {
    if (t.kind !== "draft" || t.teams.some((x) => x.captainMemberId === me)) return [];
    if (t.draftState === "open")
      return [
        {
          key: `draft-on:${t.id}`,
          text: "The draft is on",
          sub: `${t.name} · the captains are picking, and you'll see the teams when they're done`,
          hot: false,
          icon: "draft",
        },
      ];
    // Once you've a fight coming, that says it better
    if (t.draftState === "closed" && t.teams.some((x) => x.players.length) && !nextFightOf(t, me))
      return [
        {
          key: `teams-out:${t.id}`,
          href: `/tournaments/${type.slug}/teams`,
          text: "The teams are out",
          sub: `${t.name} · see who you're playing with`,
          hot: false,
          icon: "teams",
        },
      ];
    return [];
  });
}
