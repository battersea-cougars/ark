// Home's feed at its edges: nothing on, the last day it looks ahead to, a session that's today in London but
// yesterday in UTC, ties, cancellations, and what's owed in ones.
import { describe, expect, it } from "vitest";
import type { Tournament, TournamentType } from "../demo/model";
import { AHEAD_DAYS, homeFeed, owedNotice, UPCOMING_MAX, type FeedInput, type UpcomingEvent } from "./home-feed";

const type = { id: 1, slug: "kumite", name: "The Cougars Kumite", shortName: "Kumite" } as TournamentType;
const TODAY = "2026-10-21";
const feed = (over: Partial<FeedInput> = {}) =>
  homeFeed({
    me: 7,
    today: TODAY,
    runsDrafts: false,
    agenda: [],
    tournaments: [],
    types: [type],
    upcoming: [],
    club: null,
    ...over,
  });
const ev = (key: string, startsAt: string, over: Partial<UpcomingEvent> = {}): UpcomingEvent => ({
  key,
  kind: "social",
  filter: "social",
  icon: "glass",
  title: key,
  startsAt,
  endsAt: startsAt,
  venue: "The Lock",
  standing: null,
  asking: false,
  ...over,
});
const up = (events: UpcomingEvent[], over: Partial<FeedInput> = {}) => feed({ events, ...over }).upcoming;
const day = (offset: number, time = "19:00:00Z") =>
  `${new Date(Date.parse(`${TODAY}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)}T${time}`;

describe("Home with nothing on", () => {
  it("has nothing in any group: no lead, no rows, no admin lines", () => {
    expect(feed()).toEqual({ lead: null, now: [], upcoming: [], admin: [] });
    expect(feed({ events: [] }).upcoming).toEqual([]);
  });

  it("everything already past: nothing coming up; but midnight in London tonight is today's", () => {
    expect(up([ev("last week", day(-7)), ev("yesterday, 11pm in London", day(-1, "22:00:00Z"))])).toEqual([]);
    // 23:00 UTC yesterday is midnight in London (BST): today
    expect(up([ev("midnight", day(-1, "23:00:00Z"))]).map((r) => r.key)).toEqual(["midnight"]);
  });
});

describe("what's coming up, at the edges", () => {
  it("looks exactly six weeks ahead: the last day in, the day after out", () => {
    const rows = up([ev("last day", day(AHEAD_DAYS)), ev("too far", day(AHEAD_DAYS + 1))]);
    expect(rows.map((r) => r.key)).toEqual(["last day"]);
  });

  it("a tournament's next one shows however far off it is", () => {
    const far = ev("tournament:3", day(200), { kind: "tournament", filter: "type:1" });
    expect(up([far]).map((r) => r.key)).toEqual(["tournament:3"]);
  });

  it("today's session shows, even once it's started", () => {
    expect(up([ev("tonight", day(0, "06:00:00Z"))]).map((r) => r.key)).toEqual(["tonight"]);
  });

  it("goes by London's date: 23:30 UTC on a summer night is tomorrow in London, so it still shows", () => {
    const summer = "2026-07-01";
    const late = ev("late", "2026-06-30T23:30:00Z");
    expect(up([late], { today: summer }).map((r) => r.key)).toEqual(["late"]);
  });

  it("two at the same time keep the order they came in", () => {
    const rows = up([ev("quiz", day(3)), ev("drinks", day(3))]);
    expect(rows.map((r) => r.key)).toEqual(["quiz", "drinks"]);
  });

  it("socials are each their own: two on the same night both show, where a training shows only its next", () => {
    const training = (k: string, d: number) =>
      ev(k, day(d), { kind: "training", filter: "series:1", title: "Friday Training" });
    const rows = up([ev("quiz", day(1)), ev("drinks", day(1)), training("fri1", 2), training("fri2", 9)]);
    expect(rows.map((r) => r.key)).toEqual(["quiz", "drinks", "fri1"]);
  });

  it("stops at exactly the cap, the earliest first", () => {
    const many = Array.from({ length: UPCOMING_MAX + 1 }, (_, i) => ev(`e${i}`, day(i + 1)));
    const rows = up(many.reverse());
    expect(rows).toHaveLength(UPCOMING_MAX);
    expect(rows[0].key).toBe("e0");
    expect(rows.map((r) => r.key)).not.toContain(`e${UPCOMING_MAX}`);
  });

  it("a cancelled one says Cancelled, whatever you'd said", () => {
    const rows = up([ev("off", day(2), { cancelled: true, standing: "in", asking: true })]);
    expect(rows[0].sub).toBe("8pm · Cancelled");
  });

  it("asks Are you in? from the day sign-up opens, and says when it opens before that", () => {
    const t = (signupOpensOn: string) =>
      ev("tournament:1", day(30), { kind: "tournament", filter: "type:1", asking: true, signupOpensOn });
    // A training night sooner is the lead, so the tournament is a row
    const fri = ev("session:1", day(1), { kind: "training", filter: "series:1", asking: true });
    const row = (e: UpcomingEvent) => up([fri, e]).find((r) => r.key === "tournament:1");
    expect(row(t(TODAY))?.sub).toBe("7pm · Are you in?");
    expect(row(t("2026-10-22"))?.sub).toBe("7pm · Sign-up opens 22 Oct");
  });

  it("a date still to be confirmed shows no time, only how it stands", () => {
    const rows = up([ev("tbc", day(5), { dateTbc: true, standing: "waitlist" })]);
    expect(rows[0].sub).toBe("You're on the waitlist");
  });

  it("the lead isn't a row as well, and nothing else is left out", () => {
    expect(up([ev("a", day(1), { asking: true }), ev("b", day(2))]).map((r) => r.key)).toEqual(["b"]);
  });
});

describe("what's owed", () => {
  it("one person owing the club is one person, and a late part only when there is one", () => {
    const admin = feed({ club: { total: 1200, people: 1, worst: 0 } }).admin;
    expect(admin.map((r) => [r.text, r.sub])).toEqual([["Owed to the club £12", "1 person"]]);
    const late = feed({ club: { total: 1200, people: 2, worst: 600 } }).admin;
    expect(late[0].sub).toBe("2 people · £6 over 90 days late");
  });

  it("a member in credit (owing less than nothing) sees no notice", () => {
    expect(owedNotice({ pence: -500, kinds: [] })).toBeNull();
  });

  it("a night and a quarter together are charges, not nights", () => {
    expect(owedNotice({ pence: 3000, kinds: ["session", "quarterly"] })?.sub).toBe("Your tab · 2 charges");
    expect(owedNotice({ pence: 1500, kinds: ["session"] })?.sub).toBe("Your tab · 1 night");
  });

  it("owing with no charge named still opens the tab", () => {
    expect(owedNotice({ pence: 100, kinds: [] })).toEqual({ text: "£1 to pay", sub: "Your tab", href: "/me/tab" });
  });
});

describe("a draft with nobody left to pick", () => {
  const kumite = (over: Partial<Tournament>) =>
    ({
      id: 10,
      typeId: 1,
      name: "The Cougars Kumite",
      kind: "draft",
      status: "open",
      signupOpensOn: null,
      signupClosesOn: null,
      going: [1, 2, 7],
      waitlist: [],
      out: [],
      teams: [],
      draftState: "open",
      ...over,
    }) as unknown as Tournament;
  it("tells a captain everyone's picked, not that it's their pick", () => {
    const team = (captain: number, players: number[]) => ({
      name: "",
      logo: null,
      captainMemberId: captain,
      captainName: "",
      contact: "",
      players: players.map((memberId) => ({ memberId, name: "" })),
    });
    // Everyone going is a captain or picked
    const t = kumite({ teams: [team(7, [1]), team(2, [])] as never });
    const rows = feed({ tournaments: [t], upcoming: [{ type, t }] }).now;
    expect(rows.map((r) => [r.text, r.hot])).toEqual([["Everyone's picked", false]]);
  });
});
