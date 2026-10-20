// What the club's notifications are about (ADR 0108, #24): the one list, for the Worker (each Notice says its topic;
// a member who turned one off isn't sent it) and for the You page (a switch each). Every topic is on until a member
// turns it off. Kept: "draft" (the draft starts, your pick), for when the draft's notifications are sent; it joins this
// list then, so there's never a switch for something that's never sent.
export const TOPICS = [
  { topic: "teams", label: "Teams are out", hint: "Which team you're on, once the night's teams are published." },
  {
    topic: "places",
    label: "Your place",
    hint: "A place came up for you, or a Quarterly Member took yours and you're waiting.",
  },
  { topic: "sessionOff", label: "A session's off", hint: "A night you're in for, or waiting for, is cancelled." },
  { topic: "announcements", label: "Announcements", hint: "What the club puts on Home." },
  { topic: "dues", label: "Dues", hint: "What you owe the club, when it's due." },
] as const;

export type Topic = (typeof TOPICS)[number]["topic"];
/** A member's choice for each topic: on unless they turned it off. */
export type NotificationPrefs = Record<Topic, boolean>;

export const isTopic = (t: string): t is Topic => TOPICS.some((x) => x.topic === t);

/** Every topic on: what a member hears until they choose. */
export const allOn = (): NotificationPrefs =>
  Object.fromEntries(TOPICS.map((t) => [t.topic, true])) as NotificationPrefs;
