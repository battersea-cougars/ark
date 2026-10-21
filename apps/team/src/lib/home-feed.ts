// Home's feed (ADR 0118): under the calls to action, three groups. First what needs you now: a captain's draft, the
// draft being on, the teams being out, a sign-up closing you haven't answered. (What you owe is a notice up top.) Then what's coming
// up, in date order and capped: the other trainings' next sessions, each tournament series' next one, the club's
// events, with "See the calendar" after them. Last, under "For admins", only for whoever they're for: running the
// draft, and what the club is owed.
import type { AgendaRow, Bookable, Tournament, TournamentType } from "../demo/model";
import { dateBadge, formatTime, londonISO, londonToday, pounds } from "./dates";
import { BUCKETS } from "./dues";
import { draftTurn } from "./draft";
import { signupOpen } from "./signup";

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
> {
  standing: Standing | null;
  /** Taking sign-ups now, and you may sign up. */
  asking: boolean;
  /** A tournament's sign-up, still to open. */
  signupOpensOn?: string | null;
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
  /** What's on from today, any order: Home picks the rows. */
  events?: UpcomingEvent[];
  /** Already a card up top (the lead Friday, a tournament still asking): not repeated. */
  shown?: string[];
}

export interface Feed {
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
  const now = rows.filter((r) => !forAdmins(r));
  const admin = rows.filter(forAdmins);
  const { club } = input;
  if (club && club.total > 0)
    admin.push({
      key: "admin:club-dues",
      href: "/settings/overdue",
      text: `Owed to the club ${pounds(club.total)}`,
      sub: `${club.people} ${club.people === 1 ? "person" : "people"}${club.worst > 0 ? ` · ${pounds(club.worst)} ${BUCKETS[3]} (over 90 days)` : ""}`,
      hot: false,
      icon: "pound",
    });
  return { now, upcoming: upcomingRows(input), admin };
}

/** What you owe, and what for: the kind of each charge with something left on it. */
export interface Owes {
  pence: number;
  kinds: string[];
}

/** What you owe, as a notice in the locker room (Home's top, after the club's): none when you're square. */
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
  return { text: `${pounds(owes.pence)} to pay`, sub: n ? `Your tab · ${n} ${what}` : "Your tab", href: "/me/tab" };
}

const dayOf = (iso: string) => londonToday(new Date(iso));
const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const STANDING: Record<Standing, string> = { in: "You're in", waitlist: "You're on the waitlist", out: "You're out" };

// Coming up: each training's and each tournament series' next one, the club's events in the next few weeks; what's
// a card up top isn't repeated. Dated ones by date, a season-only tournament after them; capped
function upcomingRows({ events = [], shown = [], today }: FeedInput): UpcomingRow[] {
  const until = plusDays(today, AHEAD_DAYS);
  const seen = new Set<string>();
  const sorted = events
    .filter((e) => dayOf(e.startsAt) >= today)
    .sort((a, b) => Number(!!a.season) - Number(!!b.season) || a.startsAt.localeCompare(b.startsAt));
  const picked: UpcomingEvent[] = [];
  for (const e of sorted) {
    // A card up top already says it; the row for its series is then the one after
    if (shown.includes(e.key)) continue;
    // A series' next one: only the first of each counts
    const series = e.kind === "social" ? null : e.filter;
    if (series && seen.has(series)) continue;
    if (series) seen.add(series);
    if (e.kind !== "tournament" && dayOf(e.startsAt) > until) continue;
    picked.push(e);
  }
  return picked.slice(0, UPCOMING_MAX).map((e) => upcomingRow(e, today));
}

function upcomingRow(e: UpcomingEvent, today: string): UpcomingRow {
  const time = e.timeText || (e.season ? "" : `${formatTime(e.startsAt)}–${formatTime(e.endsAt)}`);
  const opens = e.signupOpensOn && e.signupOpensOn > today ? dateBadge(londonISO(e.signupOpensOn, "12:00")) : null;
  const how = e.cancelled
    ? "Cancelled"
    : e.standing
      ? STANDING[e.standing]
      : opens
        ? `Sign-up opens ${opens.day} ${opens.month}`
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
        // The next of a series taking sign-ups is already asked up top, as a card of its own
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
function liveDrafts({ upcoming, me, runsDrafts }: FeedInput): FeedItem[] {
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
    if (until === 0)
      return [{ ...row, text: "It's your pick", sub: `${t.name} draft · you're on the clock`, hot: true }];
    const sub = until < Infinity ? `${t.name} · you pick in ${until}` : `${t.name} · your picks are done`;
    return [{ ...row, text: "The draft's open", sub, hot: false }];
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
    if (t.draftState === "closed" && t.teams.some((x) => x.players.length))
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
