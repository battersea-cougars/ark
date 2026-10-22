// Locker-room lines, spelt the way the team says them. Replies: the ask is what Home says before you answer; the
// rest are the app talking back when you do. Greetings: Home's title, by the time of day, on a training night, or
// once you've looked too often (lib/greetings.ts picks the set). Admins edit them in Settings → Quips; the
// starting set is in db/seed/club.sql. Keep them short and cheeky, never needy, and never make one a club fact.

export type ReplyKind = "ask" | "in" | "waitlist" | "out" | "empty";
export type GreetingKind = "morning" | "afternoon" | "evening" | "late" | "training" | "nag";
export type QuipKind = ReplyKind | GreetingKind;
export type QuipGroup = "reply" | "greeting";

export interface Quip {
  id: number;
  kind: QuipKind;
  text: string;
}

/** Two lines of the Home message on a phone. */
export const QUIP_MAX = 56;
/** Two lines of Home's poster title on a phone, with a longish name. */
export const GREETING_MAX = 40;

export const QUIP_KINDS: { kind: QuipKind; group: QuipGroup; label: string; hint: string; max: number }[] = [
  { kind: "ask", group: "reply", label: "Ask", hint: "On Home before you've answered", max: QUIP_MAX },
  { kind: "in", group: "reply", label: "In", hint: "When you say you're in", max: QUIP_MAX },
  { kind: "waitlist", group: "reply", label: "Waitlist", hint: "When it's full and you're queued", max: QUIP_MAX },
  { kind: "out", group: "reply", label: "Out", hint: "When you say you're out", max: QUIP_MAX },
  {
    kind: "empty",
    group: "reply",
    label: "Nobody in",
    hint: "A training's Who's coming, before anyone's answered",
    max: QUIP_MAX,
  },
  { kind: "morning", group: "greeting", label: "Morning", hint: "Home's title before noon", max: GREETING_MAX },
  { kind: "afternoon", group: "greeting", label: "Afternoon", hint: "Home's title from noon", max: GREETING_MAX },
  { kind: "evening", group: "greeting", label: "Evening", hint: "Home's title from 6pm", max: GREETING_MAX },
  { kind: "late", group: "greeting", label: "Late", hint: "Home's title from 11pm until 5am", max: GREETING_MAX },
  {
    kind: "training",
    group: "greeting",
    label: "Training night",
    hint: "Home's title on the day of a training session, until 11pm",
    max: GREETING_MAX,
  },
  {
    kind: "nag",
    group: "greeting",
    label: "Again?",
    hint: "Home's title from someone's 4th look in a day, whatever the time",
    max: GREETING_MAX,
  },
];

export const pick = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];
