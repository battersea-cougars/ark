// The route tree, built from the schedule (ADR 0030): one page per training series, and a section per tournament
// type with its home (named for it: The Kumite), Fight card, The board, Teams and Draft. Admins add a training or a
// tournament type in Settings and it appears here. Phone tabs are derived from the same tree (mobile-nav.ts), so the
// two can't drift apart. Each route declares the action it needs (ADR 0024).
import type { Requirement } from "../access/actions";
import type { IconName } from "./shell/icons";

export type TabId = "home" | "training" | "calendar" | "tournaments" | "more";

/** Groups under More (phone) and in the rail (desktop). */
export type Group = "Club" | "You" | "Settings";

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
  /** Subtitle on the More page and the phone's You page: short, so it fits one line on a phone. */
  hint?: string;
  group?: Group;
  /** Sub-heading inside Settings. */
  section?: "Schedule" | "Money" | "Club" | "Security";
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
  section: "Security",
  hint: "Dev only: who gets real email",
};

// Profile first: it's the phone's last tab (your avatar), with everything else listed on it, above your details
const STATIC_TAIL: Route[] = [
  {
    id: "profile",
    path: "/me",
    name: "Profile",
    tab: "more",
    page: "profile",
    action: "authenticated",
    icon: "user",
    group: "You",
    hint: "Your details, position and photo",
  },
  { id: "more", path: "/more", name: "More", tab: "more", page: "more", action: "authenticated", icon: "more" },
  // Where the Settings gear goes: a phone's list of them, a desktop's first one (lib/SettingsButton)
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
  // The app's privacy notice (#30): from Profile → Your data, and on the sign-in screen
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
  {
    id: "teammates",
    path: "/more/teammates",
    name: "Teammates",
    tab: "more",
    page: "teammates",
    action: "authenticated",
    icon: "user",
    group: "Club",
    hint: "Everyone who plays",
  },
  // Every announcement the club has made (#85), newest first, with whether you got each: from Home, and here
  {
    id: "announcements",
    path: "/more/announcements",
    name: "Announcements",
    tab: "more",
    page: "announcements",
    action: "authenticated",
    icon: "megaphone",
    group: "Club",
    hint: "Everything the club's said, and what you've got",
  },
  {
    id: "upload",
    unfinished: true,
    path: "/more/upload",
    name: "Upload",
    tab: "more",
    page: "upload",
    action: "upload:Photo",
    icon: "upload",
    group: "Club",
    hint: "Photos to the site, videos to YouTube",
  },
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
    id: "overdue",
    path: "/settings/overdue",
    name: "Unpaid fees",
    tab: "more",
    page: "overdue",
    action: "read:Dues",
    icon: "pound",
    group: "Settings",
    section: "Money",
    hint: "Who owes what, and for how long",
  },
  {
    id: "fees",
    path: "/settings/fees",
    name: "Quarterly rate",
    tab: "more",
    page: "fees",
    action: "manage:Fees",
    icon: "pound",
    group: "Settings",
    section: "Money",
    hint: "The fee for a whole quarter",
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
    id: "quips",
    path: "/settings/quips",
    name: "Quips",
    tab: "more",
    page: "quips",
    action: "manage:Quip",
    icon: "chat",
    group: "Settings",
    section: "Club",
    hint: "What Home says when people sign up",
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
    section: "Security",
    hint: "What each role can do",
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
    section: "Security",
    hint: "Who changed what, and when",
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
    section: "Security",
    hint: "The app as they see it, read-only",
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
    section: "Security",
    hint: "Today's use of the free plan",
  },
];

export function buildRoutes(config: NavConfig): Route[] {
  const series = config.series.filter((s) => s.active);
  const types = config.types.filter((t) => t.active);
  const me = config.me;
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
      path: `/more/teammates/${m.id}`,
      name: m.name,
      tab: "more",
      // Teammates, with this member's big card open
      page: "teammates",
      params: { memberId: m.id },
      action: "manage:Member",
      icon: "user",
      hidden: true,
    })),
    {
      id: "calendar",
      path: "/calendar",
      name: "Calendar",
      tab: "calendar",
      page: "calendar",
      action: "read:Event",
      icon: "calendar",
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
          page: "games",
          action: "read:Event",
          icon: "trophy",
        },
        ...(running
          ? ([
              {
                ...base,
                id: `schedule:${t.id}`,
                path: `/tournaments/${t.slug}/schedule`,
                name: "Fight card",
                page: "schedule",
                action: "read:Event",
                // The Kumite's gong starts every fight (lib/motif.ts)
                icon: t.slug === "kumite" ? "gong" : "calendar",
              },
              {
                ...base,
                id: `standings:${t.id}`,
                path: `/tournaments/${t.slug}/standings`,
                name: "The board",
                page: "standings",
                action: "read:Event",
                icon: "list",
              },
              {
                ...base,
                id: `teams:${t.id}`,
                path: `/tournaments/${t.slug}/teams`,
                name: "Teams",
                page: "tournament-teams",
                // Everyone's: a draft's teams once it closes (ADR 0060); where an admin edits a team (ADR 0060)
                action: "read:Event",
                icon: "teams",
              },
            ] as Route[])
          : []),
        // Each team's page, reached from wherever the team's shown; yours is lit as My team
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
          under: !running ? home : team.mine ? `my-team:${t.id}` : `teams:${t.id}`,
        })),
        // Your team: whoever's on one, captains included; where the captain makes it theirs
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
              },
            ]
          : []),
        ...(running && t.kind === "draft"
          ? [
              {
                ...base,
                id: `draft:${t.id}`,
                path: `/tournaments/${t.slug}/draft`,
                name: "Draft",
                page: "draft",
                // Only its captains, and whoever runs the draft
                action: me !== undefined && t.captains?.includes(me) ? ("read:Event" as const) : ("run:Draft" as const),
                icon: "draft" as const,
              },
            ]
          : []),
        // History: every past one with its result, and each one's page (the champions, every fight, the board, the
        // awards), back to the list (ADR 0074). With nothing on, the list is the front page
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
          under: running ? `schedule:${t.id}` : home,
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
 * Phone tabs. With one training or one tournament type, the tab takes its short name ("Friday", "Kumite"). The last
 * is you: your avatar, opening your profile, with the club's pages and Settings listed under it.
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
    { id: "calendar", label: "Calendar", icon: "calendar" },
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

export const routeFor = (routes: Route[], path: string): Route | undefined =>
  routes.find((r) => r.path === path) ?? routes.find((r) => r.path !== "/" && path.startsWith(r.path + "/"));
