// The route tree, built from the schedule (ADR 0030): one page per training series, and a section per tournament
// type with its home (named for it: The Kumite), Fight card, The board, Teams and Draft. Admins add a training or a
// tournament type in Settings and it appears here. Phone tabs are derived from the same tree (mobile-nav.ts), so the
// two can't drift apart. Each route declares the action it needs (ADR 0024).
import type { Requirement } from "../access/actions";
import type { IconName } from "./shell/icons";

export type TabId = "home" | "training" | "club" | "tournaments" | "more";

/** You: your own pages (the You page). Club: the club page, in the desktop rail. Settings: listed under the gear. */
export type Group = "Club" | "You" | "Settings";

/**
 * Settings' groups, in the order the Settings page and a desktop's settings list show them: by how often an admin needs
 * them, everyday jobs first, set-up-once things last. Inside each, the rows come in STATIC_TAIL's order, the page used
 * most first. This is the one place the order lives (settings-list.test.ts pins it).
 */
export const SECTIONS = ["Club", "Schedule", "Content", "System"] as const;
export type Section = (typeof SECTIONS)[number];

export interface Route {
  id: string;
  path: string;
  name: string;
  tab: TabId;
  action: Requirement;
  icon: IconName;
  /** Which page component renders it (App.svelte), and its props. */
  page: string;
  params?: Record<string, number>;
  /** Label in the strip of sub-pages, when shorter than the name. */
  short?: string;
  /** Subtitle in Settings' list: short, so it fits one line on a phone. */
  hint?: string;
  group?: Group;
  /** Sub-heading inside Settings. */
  section?: Section;
  /** The folding rail section it sits in: a tournament type ("type:1"). */
  fold?: string;
  /** Reached from a page, not from any menu (the register). */
  hidden?: boolean;
  /** A hidden page that belongs to one of its section's pages: that one's lit in the strip (a team, under Teams). */
  under?: string;
  /** Full-screen: hides the tabs and shows its own back bar (the game clock). */
  focus?: boolean;
  /** Still on demo data: only there when the config switches unfinished screens on (#63). */
  unfinished?: boolean;
}

export interface Fold {
  id: string;
  name: string;
  icon: IconName;
}

/**
 * Where a running tournament has got to, which says which of its pages are tabs (ADR 0074): sign-up (just its front
 * page), the draft on, the teams set with no fixtures yet, the fixtures out (the fight card and the board).
 */
export type Stage = "signup" | "draft" | "teams" | "fixtures";

/** What the menu is built from: the configured trainings and tournament types. */
export interface NavConfig {
  series: { id: number; slug: string; name: string; shortName: string; icon: IconName; active: boolean }[];
  types: {
    id: number;
    slug: string;
    name: string;
    shortName: string;
    icon: IconName;
    /** A draft tournament gets a Draft page (ADR 0030). */
    kind: "teams" | "draft";
    active: boolean;
    /** The captains of its next tournament: they see its Draft page, as do those running the draft. */
    captains?: number[];
    /** You're on one of its next tournament's teams (as far as you can see: a draft's only once it's closed). */
    onTeam?: boolean;
    /** Its tournaments' games, the past ones' too, each with a page of its own (the live score, the scoresheet). */
    games?: number[];
    /** Its tournaments' teams, the past ones' too, each with a page of its own; `mine`: you're on it. */
    teams?: { id: number; mine: boolean }[];
    /** Its past tournaments (played), newest first: History, and a page each. */
    past?: number[];
    /** Nothing on or coming up: just its front page (the past ones on it), none of the pages for a running one. */
    idle?: boolean;
    /** Where its next one has got to: its tabs are the pages that matter then; left out, the fixtures are out. */
    stage?: Stage;
  }[];
  /** Who's signed in (or being viewed as). */
  me?: number;
  /** Members, for their pages (Teammates with their card up). */
  members?: { id: number; name: string }[];
  /** Outside production: Settings → Dev tools (ADR 0027). */
  devTools?: boolean;
  /** Outside production: the screens still on demo data (#63). */
  unfinished?: boolean;
}

// Outside production only (ADR 0027)
const DEV_TOOLS_ROUTE: Route = {
  id: "dev-tools",
  path: "/settings/dev",
  name: "Dev tools",
  tab: "more",
  page: "dev-tools",
  action: "manage:Settings",
  icon: "settings",
  group: "Settings",
  section: "System",
  hint: "Dev only: who gets real email",
};

// You first: the phone's last tab (your avatar) and a desktop's avatar, top right, open it: only your own things.
// Everything an admin sets up is in Settings (the gear), grouped Club / Schedule / Content / System (ADR 0065), in
// the order below
const STATIC_TAIL: Route[] = [
  {
    id: "profile",
    path: "/me",
    name: "You",
    tab: "more",
    page: "profile",
    action: "authenticated",
    icon: "user",
    group: "You",
    hint: "Your details, notifications and dues",
  },
  // Old links: your You page
  {
    id: "more",
    path: "/more",
    name: "You",
    tab: "more",
    page: "profile",
    action: "authenticated",
    icon: "user",
    hidden: true,
  },
  // Where the gear goes (lib/SettingsButton): every admin area, grouped, phone and desktop
  {
    id: "settings",
    path: "/settings",
    name: "Settings",
    tab: "more",
    page: "settings",
    action: "authenticated",
    icon: "settings",
    hidden: true,
  },
  // The app's privacy notice (#30): from You → Privacy, and on the sign-in screen
  {
    id: "privacy",
    path: "/privacy",
    name: "Privacy",
    tab: "more",
    page: "privacy",
    action: "authenticated",
    icon: "user",
    hidden: true,
  },
  // The club (a phone's Club tab, a desktop's rail): its players now, its contacts later (#67)
  {
    id: "club",
    path: "/club",
    name: "The club",
    short: "Club",
    tab: "club",
    page: "teammates",
    action: "authenticated",
    icon: "club",
    group: "Club",
    hint: "Everyone who plays",
  },
  // Your dues: a row on your You page
  {
    id: "tab",
    path: "/me/tab",
    name: "Dues",
    tab: "more",
    page: "tab",
    action: "authenticated",
    icon: "pound",
    group: "You",
    hint: "Pay what you owe, and what you've paid",
  },
  {
    id: "members",
    path: "/settings/members",
    name: "Members",
    tab: "more",
    page: "members",
    action: "manage:Member",
    icon: "teams",
    group: "Settings",
    section: "Club",
    hint: "Everyone in a table: dues, contacts",
  },
  {
    id: "overdue",
    path: "/settings/overdue",
    name: "Unpaid fees",
    tab: "more",
    page: "overdue",
    action: "read:Dues",
    icon: "pound",
    group: "Settings",
    section: "Club",
    hint: "Who owes what, and for how long",
  },
  {
    id: "fees",
    path: "/settings/fees",
    name: "Membership",
    tab: "more",
    page: "fees",
    action: "manage:Fees",
    icon: "pound",
    group: "Settings",
    section: "Club",
    hint: "The quarterly membership's price",
  },
  {
    id: "roles",
    path: "/settings/roles",
    name: "Roles",
    tab: "more",
    page: "roles",
    action: "manage:Role",
    icon: "key",
    group: "Settings",
    section: "Club",
    hint: "What each role can do",
  },
  {
    id: "quips",
    path: "/settings/quips",
    name: "Quips",
    tab: "more",
    page: "quips",
    action: "manage:Quip",
    icon: "chat",
    group: "Settings",
    section: "Content",
    hint: "What Home says when people sign up",
  },
  // Contributors' (not every member's), so in Settings, not the rail
  {
    id: "upload",
    unfinished: true,
    path: "/more/upload",
    name: "Upload",
    tab: "more",
    page: "upload",
    action: "upload:Photo",
    icon: "upload",
    group: "Settings",
    section: "Content",
    hint: "Photos to the site, videos to YouTube",
  },
  {
    id: "training-settings",
    path: "/settings/training",
    name: "Training",
    tab: "more",
    page: "training-settings",
    action: "manage:Training",
    icon: "stick",
    group: "Settings",
    section: "Schedule",
    hint: "When, where and how many",
  },
  {
    id: "tournament-settings",
    path: "/settings/tournaments",
    name: "Tournaments",
    tab: "more",
    page: "tournament-settings",
    action: "manage:Tournament",
    icon: "trophy",
    group: "Settings",
    section: "Schedule",
    hint: "Dates, sign-up, teams, the draft",
  },
  {
    id: "tournament-series",
    path: "/settings/tournament-series",
    name: "Tournament Series",
    tab: "more",
    page: "tournament-series",
    action: "manage:Tournament",
    icon: "medal",
    group: "Settings",
    section: "Schedule",
    hint: "Rules, fee and awards to start from",
  },
  {
    id: "venues",
    path: "/settings/venues",
    name: "Venues",
    tab: "more",
    page: "venues",
    action: "manage:Venue",
    icon: "pin",
    group: "Settings",
    section: "Schedule",
    hint: "Addresses and map links",
  },
  {
    id: "view-as",
    path: "/settings/view-as",
    name: "View as a member",
    tab: "more",
    page: "view-as",
    action: "impersonate:Member",
    icon: "eye",
    group: "Settings",
    section: "System",
    hint: "The app as they see it, read-only",
  },
  {
    id: "audit",
    path: "/settings/audit",
    name: "Audit log",
    tab: "more",
    page: "audit",
    action: "read:Audit",
    icon: "list",
    group: "Settings",
    section: "System",
    hint: "Who changed what, and when",
  },
  {
    id: "usage",
    path: "/settings/usage",
    name: "Usage",
    tab: "more",
    page: "usage",
    action: "read:Usage",
    icon: "clock",
    group: "Settings",
    section: "System",
    hint: "Today's use of the free plan",
  },
  // The apps' recent errors, from Sentry (ADR 0111): here, not in Dev tools, which production doesn't have
  {
    id: "errors",
    path: "/settings/errors",
    name: "Errors",
    tab: "more",
    page: "errors",
    action: "read:Errors",
    icon: "alert",
    group: "Settings",
    section: "System",
    hint: "What's gone wrong lately, from Sentry",
  },
  // The club's email (ADR 0027): whether it works, and reconnecting it when Google has cancelled its access (#101)
  {
    id: "email",
    path: "/settings/email",
    name: "Email",
    tab: "more",
    page: "email",
    action: "manage:Settings",
    icon: "mail",
    group: "Settings",
    section: "System",
    hint: "Whether it sends; reconnect it",
  },
];

export function buildRoutes(config: NavConfig): Route[] {
  const series = config.series.filter((s) => s.active);
  const types = config.types.filter((t) => t.active);
  return [
    { id: "home", path: "/", name: "Home", tab: "home", page: "home", action: "authenticated", icon: "home" },
    ...series.flatMap((s): Route[] => [
      {
        id: `training:${s.id}`,
        path: `/training/${s.slug}`,
        name: s.name,
        short: s.shortName,
        tab: "training",
        page: "training",
        params: { seriesId: s.id },
        action: "read:Event",
        icon: s.icon,
      },
    ]),
    ...(config.members ?? []).map((m): Route => ({
      id: `member:${m.id}`,
      path: `/club/${m.id}`,
      name: m.name,
      tab: "club",
      // The club, with this member's big card open
      page: "teammates",
      params: { memberId: m.id },
      action: "manage:Member",
      icon: "user",
      hidden: true,
      under: "club",
    })),
    // Every announcement the club has made (#85), newest first, with whether you got each: Home's page, from its Past
    // announcements, for everyone. Posting one is Home's too (the megaphone)
    {
      id: "announcements",
      path: "/announcements",
      // The locker room: what people see it called
      name: "Locker room",
      tab: "home",
      page: "announcements",
      action: "authenticated",
      icon: "megaphone",
      hidden: true,
      under: "home",
    },
    // Not a phone tab (the Club has its place): opened from Home's header, so it's under Home there. A desktop's rail
    // keeps it
    {
      id: "calendar",
      path: "/calendar",
      name: "Calendar",
      tab: "home",
      page: "calendar",
      action: "read:Event",
      icon: "calendar",
      hidden: true,
      under: "home",
    },
    ...types.flatMap((t): Route[] => {
      const base = { tab: "tournaments" as const, params: { typeId: t.id }, fold: `type:${t.id}` };
      // With nothing on or coming up, its front page is the only one: a past one's pages sit under it
      const home = `games:${t.id}`;
      const running = !t.idle;
      return [
        {
          ...base,
          id: `games:${t.id}`,
          path: `/tournaments/${t.slug}`,
          // Named for the tournament itself: "The Kumite"
          name: `The ${t.shortName}`,
          short: t.shortName,
          page: "games",
          action: "read:Event",
          icon: "trophy",
        },
        // The draft room (ADR 0060): the draft, the whole screen, for its captains and whoever runs it while it's
        // open; anyone else, or once it closes, is shown out to the page (pages/DraftRoom.svelte)
        ...(running && t.kind === "draft"
          ? [
              {
                ...base,
                id: `draft-room:${t.id}`,
                path: `/tournaments/${t.slug}/draft/room`,
                name: "Draft room",
                page: "draft-room",
                action: "read:Event" as const,
                icon: "draft" as const,
                focus: true,
                hidden: true,
              },
            ]
          : []),
        // The awards (ADR 0074): a stage of their own, the after-party's reveal, one card at a time. Under its front
        // page, which links to it
        ...(running
          ? [
              {
                ...base,
                id: `awards:${t.id}`,
                path: `/tournaments/${t.slug}/awards`,
                name: "The awards",
                page: "awards",
                action: "read:Event" as const,
                icon: "medal" as const,
                hidden: true,
                under: home,
              },
            ]
          : []),
        // Its draft, teams, fixtures and board aren't pages of their own: they're its statuses, shown on its one page
        // (ADR 0074). /tournaments/kumite/draft, /teams, /schedule show those, as the page's own address does the one
        // it's at; /standings (the board's old address) the one it's at, where the table is on the day
        // Each team's page, reached from wherever the team's shown, under Teams
        ...(t.teams ?? []).map((team): Route => ({
          ...base,
          id: `team:${t.id}:${team.id}`,
          path: `/tournaments/${t.slug}/teams/${team.id}`,
          name: "Team",
          page: "tournament-team",
          params: { typeId: t.id, teamId: team.id },
          action: "read:Event",
          icon: "teams",
          hidden: true,
          under: home,
        })),
        // Your team: whoever's on one, captains included; where the captain makes it theirs. Not a tab: Teams has
        // yours first, marked; this link (from Home) is under it
        ...(running && t.onTeam
          ? [
              {
                ...base,
                id: `my-team:${t.id}`,
                path: `/tournaments/${t.slug}/my-team`,
                name: "My team",
                page: "tournament-team",
                action: "read:Event" as const,
                icon: "user" as const,
                hidden: true,
                under: home,
              },
            ]
          : []),
        // History: every past one with its result, and each one's page (the champions, every fight, the board, the
        // awards), back to the list (ADR 0074). Not a tab: the front page links to it. With nothing on, the list is
        // the front page
        ...(t.past?.length
          ? [
              ...(running
                ? [
                    {
                      ...base,
                      id: `history:${t.id}`,
                      path: `/tournaments/${t.slug}/history`,
                      name: "History",
                      page: "history",
                      action: "read:Event" as const,
                      icon: "medal" as const,
                      hidden: true,
                      under: home,
                    },
                  ]
                : []),
              ...t.past.map((tournamentId): Route => ({
                ...base,
                id: `edition:${t.id}:${tournamentId}`,
                path: `/tournaments/${t.slug}/history/${tournamentId}`,
                name: "History",
                page: "edition",
                params: { typeId: t.id, tournamentId },
                action: "read:Event",
                icon: "medal",
                hidden: true,
                under: running ? `history:${t.id}` : home,
              })),
            ]
          : []),
        // Each game's matchup (ADR 0061): both squads, the result, when the captains' sides last met. Under the
        // fight card
        ...(t.games ?? []).map((gameId): Route => ({
          ...base,
          id: `matchup:${t.id}:${gameId}`,
          path: `/tournaments/${t.slug}/games/${gameId}`,
          name: "Matchup",
          page: "matchup",
          params: { typeId: t.id, gameId },
          action: "read:Event",
          icon: "swords",
          hidden: true,
          under: home,
        })),
        // Each game's clock, full screen: its live score for anyone, its scoresheet for whoever keeps time and score
        // (ADR 0061)
        ...(t.games ?? []).map((gameId): Route => ({
          ...base,
          id: `game:${t.id}:${gameId}`,
          path: `/tournaments/${t.slug}/games/${gameId}/live`,
          name: "Game",
          page: "game",
          params: { typeId: t.id, gameId },
          action: "read:Event",
          icon: "clock",
          focus: true,
          hidden: true,
        })),
      ];
    }),
    ...STATIC_TAIL.filter((r) => config.unfinished || !r.unfinished),
    ...(config.devTools ? [DEV_TOOLS_ROUTE] : []),
  ];
}

/** Rail sections that fold: one per tournament type. */
export const buildFolds = (config: NavConfig): Fold[] =>
  config.types.filter((t) => t.active).map((t) => ({ id: `type:${t.id}`, name: t.name, icon: t.icon }));

/**
 * Phone tabs. With one training or one tournament type, the tab takes its short name ("Friday", "Kumite"). The club
 * sits between them (its players; the Calendar is a button on Home). The last is you: your avatar, opening your You page (your own things; Settings is the gear).
 */
export function buildTabs(config: NavConfig): { id: TabId; label: string; icon: IconName }[] {
  const series = config.series.filter((s) => s.active);
  const types = config.types.filter((t) => t.active);
  return [
    { id: "home", label: "Home", icon: "home" },
    ...(series.length
      ? [
          {
            id: "training" as const,
            label: series.length === 1 ? series[0].shortName : "Training",
            icon: series.length === 1 ? series[0].icon : ("stick" as IconName),
          },
        ]
      : []),
    { id: "club", label: "Club", icon: "club" },
    ...(types.length
      ? [
          {
            id: "tournaments" as const,
            label: types.length === 1 ? types[0].shortName : "Tournaments",
            icon: types.length === 1 ? types[0].icon : ("trophy" as IconName),
          },
        ]
      : []),
    { id: "more", label: "You", icon: "user" },
  ];
}

// Old paths, and where their pages live now
const MOVED: [from: string, to: string][] = [
  ["/more/teammates", "/club"],
  ["/more/announcements", "/announcements"],
];

/** Where an old link goes now (Teammates became the club), or null when it's where it should be. */
export function movedTo(path: string): string | null {
  const hit = MOVED.find(([from]) => path === from || path.startsWith(from + "/"));
  return hit ? hit[1] + path.slice(hit[0].length) : null;
}

export const routeFor = (routes: Route[], path: string): Route | undefined =>
  routes.find((r) => r.path === path) ?? routes.find((r) => r.path !== "/" && path.startsWith(r.path + "/"));
