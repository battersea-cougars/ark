// Home's feed (ADR 0118): under the calls to action, one stream of what's for you, your move first. A captain's
// draft, the draft an admin runs, a sign-up closing that you haven't answered, the teams being out, and for whoever
// sees Unpaid fees what the club is owed. What you owe yourself is not here: it's the chip in Home's header.
import type { AgendaRow, Tournament, TournamentType } from "../demo/model";
import { formatDayDate, formatTime, pounds } from "./dates";
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
}

const nth = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/** The feed, your move first, then in the order things come. */
export function homeFeed(input: FeedInput): FeedItem[] {
  const rows = [...liveDrafts(input), ...agendaNudges(input), ...draftNews(input)];
  const { club } = input;
  if (club && club.total > 0)
    rows.push({
      key: "club-dues",
      href: "/settings/overdue",
      text: `Owed to the club ${pounds(club.total)}`,
      sub: `${club.people} ${club.people === 1 ? "person" : "people"}${club.worst > 0 ? ` · ${pounds(club.worst)} ${BUCKETS[3]} (over 90 days)` : ""}`,
      hot: false,
      icon: "pound",
    });
  return rows.sort((a, b) => Number(b.hot) - Number(a.hot));
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
      const when = r.allDay ? formatDayDate(r.startsAt) : `${formatDayDate(r.startsAt)} at ${formatTime(r.startsAt)}`;
      if (r.kind === "signup_closes") {
        // The next of a series taking sign-ups is already asked up top, as a card of its own
        if (upcoming.some((u) => u.t.id === t.id)) return [];
        if (!signupOpen(t, today) || t.going.includes(me) || t.waitlist.includes(me)) return [];
        return [
          {
            key: r.key,
            href: `/tournaments/${type.slug}`,
            text: `Sign-up for ${t.name} closes ${when}`,
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
            text: `Draft ${when}`,
            sub: `${t.name} · you pick ${nth(mine + 1)}`,
            hot: false,
            icon: "draft",
          },
        ];
      if (!runsDrafts) return [];
      return [
        {
          key: r.key,
          href,
          text: `Draft ${when}`,
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
    const row = { key: `draft-open:${t.id}`, href: `/tournaments/${type.slug}/draft`, icon: "draft" as const };
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
