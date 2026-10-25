// Home's feed (ADR 0118). Home is a feed: the club's next event is the hero, whatever kind it is, and your part in it
// is shown on its card (playing in it: your match; in, waiting, or may sign up: In and Out; not in it: You're out). Then what's coming up
// after it, in date order and capped, with "See the calendar". Then what needs you (a captain's draft, the draft
// being on, the teams being out, a sign-up closing you haven't answered), and under "For admins", only for whoever
// they're for, the email having stopped, running the draft, someone asking to join, what the club is owed and a free limit getting close
// (lib/usage-near.ts). What you owe is Home's foot (owedNotice), and a loud icon in its header while some of it is
// overdue (lib/dues.ts overdue).
import type { AgendaRow, Bookable, Tournament, TournamentGame, TournamentType } from "../demo/model";
import { dateBadge, formatDayDate, formatTime, londonISO, londonToday, ordinal, pounds, timeRange } from "./dates";
import { draftTurn } from "./draft";
import { roomPath } from "./draft-room";
import { kickOff, slotMinutes } from "./fixtures";
import { signupOpen } from "./signup";
import { invitationOnly } from "./motif";
import { myTeamIndex, nextFightOf } from "./tournament-front";
import { tournamentPhase, type Phase } from "./phase";
import { hasStarted } from "./edition";
import { usageRow, type UsageLevel } from "./usage-near";

export type FeedIcon = "draft" | "teams" | "pound" | "mail" | "alert";

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
  /** That draft, for the hero's card: the tournament, your place in the pick order, and picks until your turn (0:
   * now; Infinity: not open yet, or none left to you). */
  draft?: { tournamentId: number; place: number; until: number };
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
  /** Past, on or next by its status (lib/phase.ts); unset, its time decides (a row with no status). */
  phase?: Phase;
  standing: Standing | null;
  /** Taking sign-ups now, and you may sign up: only then does Home ask "Are you in?". */
  asking: boolean;
  /** A tournament's sign-up, still to open. (A training night's: `opens`, its short weekday, "Mon".) */
  signupOpensOn?: string | null;
  /** A tournament's sign-up is over (past its last day, or it's under way): nobody can answer now. */
  signupClosed?: boolean;
  /** How many are in (a training's: its skaters, when it has places, as its card counts them). Unset: it takes no
   * sign-ups. */
  going?: number;
  /** Its places (a training's: the skaters'); null or unset: no limit. */
  limit?: number | null;
  /** On the waitlist: your number in it (a training's keepers are numbered on their own). */
  place?: number;
}

/** A row of what's coming up: its date on the left (Fri / 30 / Oct, or Summer / TBC / 2027), then what and how. */
export interface UpcomingRow {
  key: string;
  href?: string;
  icon: Bookable["icon"];
  on: When;
  text: string;
  /** When, then how its sign-up stands or where, muted: "7pm · Are you in?". Not where you stand: that's `standing`. */
  sub: string;
  /** Where you stand, said as a status after `sub`: in (a tick, in red), waiting (your number, if known), out. */
  standing?: { is: Standing; place?: number };
  /** How many are in, and its places: on a row taking sign-ups, not cancelled nor still to open. */
  count?: { going: number; limit?: number };
  /** Called off: a Cancelled badge where the count would be, not words in the line. */
  cancelled?: true;
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
  /** A tournament at its after-party (lib/edition.ts atAfters): the evening it ends, it's what's on now. */
  afters?: { type: TournamentType; t: Tournament }[];
  /** Google cancelled the email's token (ADR 0027): for whoever looks after it (manage:Settings), nobody else. */
  emailStopped?: boolean;
  /** The free limits at 70% or more, nearest first (lib/usage-near.ts): for whoever sees Usage, nobody else. */
  usage?: UsageLevel[];
  /** Who's asking to join, by name (ADR 0069): for whoever lets members in (manage:Member), nobody else. */
  asking?: string[];
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
  | { kind: "draft"; key: string; at: string; item: FeedItem }
  /** The evening a tournament ends: everyone at its afterwards, the awards being revealed (ADR 0074). */
  | { kind: "afters"; key: string; at: string; type: TournamentType; t: Tournament };

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

/** The feed: what needs you now (your move first), what's coming up, then the admins' lines. */
/** Asking you to answer: the Kumite's an invitation to accept (invitationOnly), the rest ask plainly. */
const asked = (invited: boolean) => (invited ? "Accept the invitation" : "Are you in?");

/** The hero's heading for a tournament: while it's yours to answer, the Kumite says you've been invited ("You've been
 * invited to the Kumite"), another asks ("Are you in for the Cup?"); else just its name. */
export function tournamentTitle(type: Pick<TournamentType, "slug" | "shortName"> | undefined, asking: boolean) {
  if (!type) return asking ? "Are you in?" : "Up next";
  if (!asking) return `The ${type.shortName}`;
  return invitationOnly(type)
    ? `You've been invited to the ${type.shortName}`
    : `Are you in for the ${type.shortName}?`;
}

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
  // Nobody can sign in until it's reconnected: first, and hot
  if (input.emailStopped)
    admin.unshift({
      key: "admin:email-stopped",
      href: "/settings/email",
      text: "Email has stopped",
      sub: "Google cancelled its access: nobody gets a sign-in code. Reconnect it",
      hot: true,
      icon: "mail",
    });
  // Someone waiting to be let in: named if it's one, opening The club where Approve is
  const asking = input.asking ?? [];
  if (asking.length)
    admin.push({
      key: "admin:asking-to-join",
      href: "/club",
      text: asking.length === 1 ? `${asking[0]} is asking to join` : `${asking.length} asking to join`,
      sub: "Approve them on The club",
      hot: true,
      icon: "teams",
    });
  if (club && club.total > 0)
    admin.push({
      key: "admin:club-dues",
      href: "/settings/overdue",
      text: `Owed to the club ${pounds(club.total)}`,
      sub: `${club.people} ${club.people === 1 ? "person" : "people"}${club.worst > 0 ? ` · ${pounds(club.worst)} over 90 days late` : ""}`,
      hot: false,
      icon: "pound",
    });
  // Last: it's asked for after Home opens, so nothing above it moves when it comes
  const usage = usageRow(input.usage);
  if (usage) admin.push(usage);
  return { lead, now, upcoming: upcomingRows(input, lead, fights), admin };
}

/** What you owe, and what for: the kind of each charge with something left on it; how much of it is overdue. */
export interface Owes {
  pence: number;
  kinds: string[];
  overdue?: number;
}

/**
 * The joke on your tab: what you owe in beers at the club's pub, a lot of them (it's cheap there), 10 to 40. The same
 * all day for the same amount, so it doesn't jump about between visits.
 */
export function beersFor(pence: number, day: string): number {
  let h = pence;
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) % 100_003;
  return 10 + (h % 31);
}

/**
 * What you owe, at Home's foot: none when you're square. Overdue is also the loud icon in Home's header. With the
 * club's pub, what that comes to in beers there (about so many: the same money, not another way to pay).
 */
export function owedNotice(
  owes: Owes,
  pub?: { name: string; beers: number },
): { text: string; sub: string; href: string } | null {
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
  const text = `${pounds(owes.pence)} to pay${pub ? `, about ${pub.beers} beers at ${pub.name}` : ""}`;
  return { text, sub: `Your tab${n ? ` · ${n} ${what}` : ""}${late}`, href: "/me/tab" };
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
/** Past by its status (ADR 0074, #182); only an event with none goes by its end. */
const isPast = (event: UpcomingEvent, nowMs: number) =>
  event.phase ? event.phase === "past" : Date.parse(event.endsAt) <= nowMs;
const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A tournament's own key on the schedule (lib/schedule tournamentBookable): its fight stands in for it. */
const tournamentKey = (t: Tournament) => `tournament:${t.id}`;
/** When your fight kicks off, London's wall clock on the tournament's day, as an instant. */
const fightAt = ({ t, game }: Fight) => londonISO(t.heldOn, kickOff(t.startTime, slotMinutes(t), game.position));

/**
 * The hero: the club's next event, whatever it is, with where you stand on it. Yours stand in for theirs: your next
 * match for its tournament, a draft you're a captain in (open, with picks to make: now; else its day). Everything
 * else on the schedule is the event itself, yours to answer or not yours (the Kumite you're not in, a social with no
 * sign-up): it still leads, its card saying where you stand, and so does one you've said you're out of (its card shows
 * your Out, and In is still there). The evening a tournament ends, its after-party: it's on now. The soonest leads, and at the same moment a match, then a draft, then the
 * schedule's order; what's on now (a tournament under way before its day) counts as now. A cancelled one, one with no
 * day yet, or one that's past never does: past by its status, not its time (lib/phase.ts, #182), so a night past its
 * end is still the one till its register closes, and a Kumite whose day went by unplayed is still next. The one Home
 * pinned this visit stays while it's still on, so nothing swaps under your thumb.
 */
export function leadOf(input: FeedInput, fights: Fight[], rows: FeedItem[]): Lead | null {
  const { events = [], today, pinned } = input;
  const nowMs = Date.parse(input.now ?? londonISO(today, "00:00"));
  const nowIso = new Date(nowMs).toISOString();
  /** When it sorts: what's on now is now, whatever day it was set for */
  const sortsAt = (at: string, phase?: Phase) => (phase === "on" && Date.parse(at) > nowMs ? nowIso : at);
  const next: Lead[] = [];
  for (const fight of fights) {
    if (fight.t.season) continue;
    const at = sortsAt(fightAt(fight), tournamentPhase(fight.t));
    next.push({ kind: "fight", key: `fight:${fight.t.id}`, at, fight });
  }
  for (const item of rows) if (item.captainAt) next.push({ kind: "draft", key: item.key, at: item.captainAt, item });
  // The after-party is on now: it leads, and its tournament's own row doesn't
  const afters = input.afters ?? [];
  for (const { type, t } of afters) next.push({ kind: "afters", key: `afters:${t.id}`, at: nowIso, type, t });
  const fought = new Set([...fights.map((f) => tournamentKey(f.t)), ...afters.map((a) => tournamentKey(a.t))]);
  for (const event of events) {
    if (event.cancelled || event.season || event.dateTbc || fought.has(event.key)) continue;
    if (isPast(event, nowMs)) continue;
    // A sign-up still to open is yours to answer when it does
    const toCome = !!event.opens || (!!event.signupOpensOn && event.signupOpensOn > today);
    const role: Role = event.standing === "out" ? "out" : event.standing || event.asking || toCome ? "yours" : "notIn";
    next.push({ kind: "event", key: event.key, at: sortsAt(event.startsAt, event.phase), event, role });
  }
  const held = pinned && next.find((l) => l.key === pinned);
  if (held) return held;
  // Soonest first; a stable sort keeps a match, then a draft, then the schedule's order at the same moment
  return [...next].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
}

// Coming up: each training's and each tournament series' next one, the club's events in the next few weeks; the lead
// isn't repeated (for a fight, its tournament). Dated ones by date, a season-only tournament after them; capped
function upcomingRows(input: FeedInput, lead: Lead | null, fights: Fight[]): UpcomingRow[] {
  const { events = [], today, types } = input;
  const nowMs = Date.parse(input.now ?? londonISO(today, "00:00"));
  const shown = !lead
    ? []
    : lead.kind === "event"
      ? [lead.key]
      : lead.kind === "fight"
        ? [tournamentKey(lead.fight.t)]
        : lead.kind === "afters"
          ? [tournamentKey(lead.t)]
          : [];
  const until = plusDays(today, AHEAD_DAYS);
  const seen = new Set<string>();
  // Not past by its status (#182); one with none, from today
  const sorted = events
    .filter((e) => (e.phase ? !isPast(e, nowMs) : dayOf(e.startsAt) >= today))
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
  const invited = (e: UpcomingEvent) =>
    e.kind === "tournament" && invitationOnly(types.find((y) => e.filter === `type:${y.id}`));
  return picked.slice(0, UPCOMING_MAX).map((e) => upcomingRow(e, today, fightTimes.get(e.key), invited(e)));
}

// How its sign-up stands: "Are you in?" only when you can answer now (the sign-up open, by the same rules as the
// event's own page: lib/signup.ts, worked out as Home reads the schedule); else when it opens, that it's closed, or
// just where. The Kumite's is an invitation to accept (lib/motif.ts invitationOnly). Where you stand is a status of its
// own, and how many are in, on any that takes sign-ups
function upcomingRow(e: UpcomingEvent, today: string, fight?: string, invited = false): UpcomingRow {
  const time = e.timeText || (e.season ? "" : timeRange(e.startsAt, e.endsAt));
  const opensOn = e.signupOpensOn && e.signupOpensOn > today ? dateBadge(londonISO(e.signupOpensOn, "12:00")) : null;
  const stands = !e.cancelled && !fight && e.standing;
  const how = e.cancelled
    ? ""
    : fight
      ? `Your match at ${fight}`
      : stands
        ? ""
        : e.opens
          ? `Sign-up opens ${e.opens}`
          : opensOn
            ? `Sign-up opens ${opensOn.day} ${opensOn.month}`
            : e.signupClosed
              ? "Sign-up closed"
              : e.asking
                ? asked(invited)
                : e.venue;
  const sub = [e.dateTbc ? "" : time, how].filter(Boolean).join(" · ");
  const on = { at: e.startsAt, season: e.season, tbc: e.dateTbc };
  const row: UpcomingRow = { key: e.key, href: e.href, icon: e.icon, on, text: e.title, sub };
  if (e.cancelled) row.cancelled = true;
  if (stands) row.standing = e.standing === "waitlist" && e.place ? { is: "waitlist", place: e.place } : { is: stands };
  // Nobody's in one still to open, and a cancelled one has nobody going
  if (e.going !== undefined && !e.cancelled && !e.opens && !opensOn)
    row.count = e.limit ? { going: e.going, limit: e.limit } : { going: e.going };
  return row;
}

// From the agenda (ADR 0060, 0042): a captain's draft day, the draft an admin runs, a sign-up about to close (for a
// tournament Home doesn't already ask about)
function agendaNudges({ agenda, tournaments, types, upcoming, me, today, runsDrafts }: FeedInput): FeedItem[] {
  return agenda
    .filter((r) => r.day >= today && (r.kind === "draft" || r.kind === "signup_closes"))
    .flatMap((r): FeedItem[] => {
      const t = tournaments.find((x) => x.id === r.sourceId);
      const type = t && types.find((y) => y.id === t.typeId);
      // Played (early, maybe: its reminders' days still ahead), it's past (#182)
      if (!t || !type || tournamentPhase(t) === "past") return [];
      // The day is the row's date block; the line says the time, if it has one
      const on = { at: r.startsAt };
      const at = r.allDay ? "" : ` at ${formatTime(r.startsAt)}`;
      if (r.kind === "signup_closes") {
        // The next of a series taking sign-ups is already asked: the lead, or its row in what's coming up
        if (upcoming.some((u) => u.t.id === t.id)) return [];
        if (!signupOpen(t, today) || hasStarted(t) || t.going.includes(me) || t.waitlist.includes(me)) return [];
        return [
          {
            key: r.key,
            href: `/tournaments/${type.slug}`,
            text: `Sign-up for ${t.name} closes`,
            on,
            sub: asked(invitationOnly(type)),
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
            sub: `${t.name} · you pick ${ordinal(mine + 1)}`,
            hot: false,
            icon: "draft",
            captainAt: r.allDay ? londonISO(r.day, "00:00") : r.startsAt,
            draft: { tournamentId: t.id, place: mine + 1, until: Infinity },
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
    // The picking's in the draft room (ADR 0060): there, while there are picks to make
    const room = { ...row, href: roomPath(type.slug) };
    if (mine < 0)
      return [{ ...room, text: "The draft's open", sub: `${t.name} · close it once everyone's picked`, hot: true }];
    const draft = { tournamentId: t.id, place: mine + 1, until };
    if (until === 0)
      return [
        { ...room, text: "It's your pick", sub: `${t.name} draft · you're on the clock`, hot: true, captainAt, draft },
      ];
    if (until === Infinity)
      return [{ ...row, text: "The draft's open", sub: `${t.name} · your picks are done`, hot: false }];
    return [
      { ...room, text: "The draft's open", sub: `${t.name} · you pick in ${until}`, hot: false, captainAt, draft },
    ];
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
