// Default club facts (from the old Wix site, rewritten), one object per Sanity singleton. Used field by field
// wherever Sanity has no value yet, and by apps/studio/seed.ts to seed the singletons. Every claim here is
// listed in docs/club-facts.md for the team manager to confirm.
import type { Club, Fridays, Kumite, Pub, Team } from "./types";

export const FALLBACK_CLUB: Club = {
  founded: 1996,
  // Set in the Studio (Club → Contact email), never here: the club's address isn't kept in the repo
  contactEmail: "",
  socials: {
    instagram: "https://www.instagram.com/batterseacougarshockey/",
    facebook: "https://www.facebook.com/groups/531393120208526",
    youtube: null,
  },
  youtubeChannelId: null,
  youtubePlaylists: null,
  heroImage: null,
};

export const FALLBACK_FRIDAYS: Fridays = {
  training: [
    {
      title: "Friday session",
      day: "Friday",
      start: "19:30",
      end: "21:30",
      description:
        "One session, every level, one rink. We play to get better together and we play to win. Teams are " +
        "balanced every week so every game is a real game.",
    },
  ],
  venue: {
    name: "Battersea Sports Centre",
    address: "London SW11 3AB",
    mapUrl: "https://maps.app.goo.gl/w5GZTqQF9Qekgeaa6",
  },
  kitNotes: "Helmet, gloves and shin pads are non-negotiable. Knee and elbow pads strongly recommended.",
  // The club doesn't promise to lend kit (2026-10-17): nothing about lending kit unless the Studio says so
  firstSessionKit: null,
  feesText: null,
};

export const FALLBACK_PUB: Pub = {
  name: "The Anchor",
  about:
    "Final whistle, first round. Players, first-timers and whoever came to watch. Nobody has to drink " +
    "beer. Everybody has to come.",
  mapUrl: null,
};

export const FALLBACK_TEAM: Team = {
  onWebsite: false,
  intro:
    "The official Battersea Cougars team plays in the BIPHA league. Same club, same Friday rink, " +
    "plus fixtures against other inline hockey clubs.",
  league: "BIPHA",
  photo: null,
};

export const FALLBACK_KUMITE: Kumite = {
  onWebsite: false,
  intro:
    "Four times a year we hold the Kumite, our in-house tournament, a special event apart from regular " +
    "Friday hockey. Everyone who signs up is drafted into balanced teams, every team plays every other " +
    "team, and one team walks away as champions. Anyone can play.",
  tagline: "Four times a year. Drafted teams, everyone plays everyone.",
  posterStatement: "One team walks away.",
  posterReveal: "Champions.",
  format: [
    "Players are drafted into balanced teams on the day",
    "Full round robin: every team plays every team",
    "One team finishes top of the table as champions",
  ],
  awards: ["Champions", "Top scorer", "Best goalie"],
};
