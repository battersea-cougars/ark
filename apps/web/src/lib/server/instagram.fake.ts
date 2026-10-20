// A sample Instagram feed (ADR 0113): what the photos look like before the club has connected its account, on a
// laptop, dev and PR previews. Never in production. Pictures are placeholders from picsum.photos (not hockey).
import type { Post } from "./instagram";

const CAPTIONS = [
  "Friday night under the lights. Same time next week?",
  "Kumite day. Nobody left the rink unbruised.",
  "New faces, old bruises. Welcome to the club.",
  "Post-game at the pub. The real highlights.",
  "Goalie of the night: wall, not a person.",
  "Tournament weekend, all of it",
  "Warm-up laps before the drills",
  "Spare kit, first session, first goal.",
  null,
  "Saturday scrimmage in the sun",
  "Team photo, mostly in focus",
  "Late-night overtime. Worth it.",
];

const day = (n: number) => new Date(Date.UTC(2026, 9, 31 - n * 3, 21)).toISOString();

export const FAKE_POSTS: Post[] = CAPTIONS.map((caption, i) => {
  const kind = i === 1 ? "video" : i === 5 ? "album" : "image";
  const first = caption?.split(/(?<=[.!?])\s/)[0];
  return {
    id: `fake-${i + 1}`,
    kind,
    image: `https://picsum.photos/seed/cougars-ig-${i + 1}/1080/1080`,
    caption,
    alt: first ?? "A photo from the club's Instagram",
    href: "https://www.instagram.com/batterseacougars/",
    takenAt: day(i),
    ...(kind === "album" ? { count: 4 } : {}),
  };
});
