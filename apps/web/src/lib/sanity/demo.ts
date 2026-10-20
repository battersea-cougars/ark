// Sample content for previewing the design before Sanity has real content.
// Used when DEMO_CONTENT=true: locally, and in dev and PR builds (deploy.yml).
// Videos are public inline hockey clips on YouTube, dated as recent Friday sessions. The sample photos are the
// Instagram feed's (lib/server/instagram.fake.ts).
import type { ClubEvent, Player, Video } from "./types";

const inDays = (d: number, time: string) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  const [h, m] = time.split(":").map(Number);
  t.setHours(h, m, 0, 0);
  return t.toISOString();
};

export const DEMO_EVENTS: ClubEvent[] = [
  {
    title: "Cougars Kumite: Winter (sample)",
    slug: "demo-kumite",
    type: "kumite",
    startsAt: inDays(40, "10:00"),
    endsAt: inDays(40, "16:00"),
    location: "Battersea Sports Centre",
    summary: "Sample event: drafted teams, full round robin, one champion.",
  },
  {
    title: "End of season social (sample)",
    slug: "demo-social",
    type: "social",
    startsAt: inDays(18, "21:45"),
    location: "Somewhere near the rink",
    summary: "Sample event shown in demo mode only.",
  },
  {
    title: "Skills clinic (sample)",
    slug: "demo-clinic",
    type: "training",
    startsAt: inDays(25, "19:30"),
    endsAt: inDays(25, "21:30"),
    location: "Battersea Sports Centre",
    summary: "Sample event shown in demo mode only.",
  },
];

// The last few Fridays, each with a session video. Placeholder clips: public inline hockey
// videos on YouTube, not Cougars footage.
const fridaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 2) % 7) - 7 * n); // most recent Friday, then n weeks back
  d.setHours(21, 30, 0, 0);
  return d;
};
const fridayTitle = (d: Date) =>
  `Friday ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}`;
const SESSION_CLIPS = ["_O72RtQsqA4", "sJdXr3mK1H0", "2h88QNxClqU", "2zrhyg5B6dk", "X_rw0CtkL5Q"];
export const DEMO_VIDEOS: Video[] = SESSION_CLIPS.map((id, n) => {
  const d = fridaysAgo(n);
  return {
    _id: `demo-video-${n}`,
    title: `${fridayTitle(d)} (sample)`,
    recordedOn: d.toISOString(),
    youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
    description: "Placeholder clip, not Cougars footage.",
  };
});

// Made-up characters to preview the squad cards. Not real members.
const player = (n: number, nickname: string, rest: Omit<Player, "_id" | "name" | "nickname" | "number">): Player => ({
  _id: `demo-player-${n}`,
  name: "Sample player",
  nickname,
  number: n,
  ...rest,
});
export const DEMO_PLAYERS: Player[] = [
  player(4, "The Wall", {
    position: "Defence",
    shoots: "Left",
    since: 1998,
    knownFor: "Standing still, effectively",
    weakness: "Stairs, the day after",
    quote: "I was never out of position. The game moved.",
  }),
  player(17, "Hollywood", {
    position: "Forward",
    shoots: "Right",
    since: 2011,
    knownFor: "Celebrating goals scored in warm-up",
    weakness: "Passing",
    quote: "Did anyone get that on video?",
  }),
  player(1, "The Octopus", {
    position: "Goalie",
    shoots: "Left",
    since: 2006,
    knownFor: "Saves nobody can explain, including him",
    weakness: "Shots along the floor",
    quote: "I meant to do that.",
  }),
  player(88, "Sunday League", {
    position: "Forward",
    shoots: "Right",
    since: 2019,
    knownFor: "Offside, a rule we do not have",
    weakness: "Stopping",
    quote: "In football this would be a foul.",
  }),
  player(23, "The Professor", {
    position: "Defence",
    shoots: "Left",
    since: 2002,
    knownFor: "Explaining the play you just got wrong",
    weakness: "Being picked last in the draft",
    quote: "Technically, that was the correct pass.",
  }),
  player(9, "Fresh Legs", {
    position: "Wherever",
    shoots: "Right",
    since: 2025,
    knownFor: "Turning up early with all the kit",
    weakness: "Has not found the brakes yet",
    quote: "Which way are we shooting?",
  }),
];
