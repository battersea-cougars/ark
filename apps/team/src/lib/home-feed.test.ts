import { describe, expect, it } from "vitest";
import type { AgendaRow, Tournament, TournamentType } from "../demo/model";
import { homeFeed, UPCOMING_MAX, type FeedInput, type UpcomingEvent } from "./home-feed";

const ME = 7;
const type = { id: 1, slug: "kumite", name: "The Cougars Kumite", shortName: "Kumite" } as TournamentType;
const kumite = (over: Partial<Tournament> = {}) =>
  ({
    id: 10,
    typeId: 1,
    name: "The Cougars Kumite",
    kind: "draft",
    status: "open",
    signupOpensOn: null,
    signupClosesOn: "2026-11-01",
    going: [1, 2, 3, 4, 5, 6],
    waitlist: [],
    out: [],
    teams: [],
    draftState: "none",
    ...over,
  }) as unknown as Tournament;
const closes = {
  key: "signup:10",
  kind: "signup_closes",
  sourceId: 10,
  day: "2026-11-01",
  startsAt: "2026-11-01T23:59:00Z",
  allDay: true,
} as AgendaRow;

const feed = (t: Tournament, over: Partial<FeedInput> = {}) =>
  homeFeed({
    me: ME,
    today: "2026-10-21",
    runsDrafts: false,
    agenda: [],
    tournaments: [t],
    types: [type],
    upcoming: [{ type, t }],
    club: null,
    ...over,
  });

describe("Home's feed", () => {
  it("a captain on the clock hears it first; the club's dues are an admin's line, at the bottom", () => {
    const t = kumite({
      draftState: "open",
      teams: [
        { name: "A", logo: null, captainMemberId: ME, captainName: "", contact: "", players: [] },
        { name: "B", logo: null, captainMemberId: 2, captainName: "", contact: "", players: [] },
      ],
    });
    const rows = feed(t, { club: { total: 9000, people: 3, worst: 0 } });
    expect(rows.now.map((r) => r.text)).toEqual(["It's your pick"]);
    expect(rows.now[0].hot).toBe(true);
    expect(rows.admin.map((r) => [r.text, r.href])).toEqual([["Owed to the club £90", "/settings/overdue"]]);
  });

  it("a member hears the draft is on, with nothing to open, then that the teams are out", () => {
    const on = feed(kumite({ draftState: "open" })).now;
    expect(on.map((r) => [r.text, r.href])).toEqual([["The draft is on", undefined]]);
    const closed = kumite({
      draftState: "closed",
      teams: [
        {
          name: "A",
          logo: null,
          captainMemberId: 2,
          captainName: "",
          contact: "",
          players: [{ memberId: ME, name: "" }],
        },
      ],
    });
    expect(feed(closed).now).toMatchObject([{ text: "The teams are out", href: "/tournaments/kumite/teams" }]);
  });

  it("doesn't nag about a sign-up closing when Home already asks about that tournament up top", () => {
    const t = kumite();
    expect(feed(t, { agenda: [closes] }).now).toEqual([]);
    // A one-off tournament (not the next of a series Home asks about) still gets its reminder
    expect(feed(t, { agenda: [closes], upcoming: [] }).now.map((r) => r.sub)).toEqual(["Are you in?"]);
  });

  it("whoever runs the draft hears about it under For admins, not with everyone's", () => {
    const rows = feed(kumite({ draftState: "open" }), { runsDrafts: true });
    expect(rows.now).toEqual([]);
    expect(rows.admin.map((r) => r.text)).toEqual(["The draft's open"]);
  });

  it("nobody but whoever sees Unpaid fees has admin lines", () => {
    expect(feed(kumite()).admin).toEqual([]);
    expect(feed(kumite(), { club: { total: 0, people: 0, worst: 0 } }).admin).toEqual([]);
  });
});

describe("what you owe, in the feed", () => {
  it("a member who owes sees a row opening their tab, after what's about the play", () => {
    const closed = kumite({
      draftState: "closed",
      teams: [
        {
          name: "A",
          logo: null,
          captainMemberId: 2,
          captainName: "",
          contact: "",
          players: [{ memberId: ME, name: "" }],
        },
      ],
    });
    const rows = feed(closed, { owes: { pence: 5800, kinds: ["session", "session", "session"] } }).now;
    expect(rows.map((r) => r.text)).toEqual(["The teams are out", "£58 to pay"]);
    expect(rows[1]).toMatchObject({ href: "/me/tab", sub: "Your tab · 3 nights", icon: "pound", money: true });
  });

  it("nobody square sees one", () => {
    expect(feed(kumite(), { owes: { pence: 0, kinds: [] } }).now).toEqual([]);
  });
});

describe("what's coming up", () => {
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
  const friday = (n: number) =>
    ev(`session:${n}`, `2026-10-${23 + 7 * n}T18:30:00Z`, {
      kind: "training",
      filter: "series:1",
      title: "Friday Training",
    });
  const up = (events: UpcomingEvent[], shown: string[] = []) => feed(kumite(), { events, shown }).upcoming;

  it("is in date order, a date on the left of each", () => {
    const rows = up([ev("quiz", "2026-11-05T19:00:00Z"), ev("drinks", "2026-10-30T19:00:00Z")]);
    expect(rows.map((r) => r.text)).toEqual(["drinks", "quiz"]);
    expect(rows[0].date).toEqual({ top: "Fri", bottom: "30 Oct" });
    expect(rows[0].sub).toBe("7pm–7pm · The Lock");
  });

  it("doesn't repeat the lead Friday: the row is the Friday after it, once", () => {
    const rows = up([friday(0), friday(1)], ["session:0"]);
    expect(rows.map((r) => r.key)).toEqual(["session:1"]);
  });

  it("each training and tournament series once, its next; where you stand, or when sign-up opens", () => {
    const rows = up([
      ev("tournament:2", "2027-06-30T10:00:00Z", {
        kind: "tournament",
        filter: "type:1",
        title: "The Kumite",
        season: { name: "summer", year: 2027 },
        dateTbc: true,
        signupOpensOn: "2027-05-01",
      }),
      ev("tournament:1", "2026-11-14T10:00:00Z", { kind: "tournament", filter: "type:2", standing: "in" }),
    ]);
    expect(rows.map((r) => [r.key, r.sub])).toEqual([
      ["tournament:1", "10am–10am · You're in"],
      ["tournament:2", "Sign-up opens 1 May"],
    ]);
    expect(rows[1].date).toEqual({ top: "Summer", bottom: "2027" });
  });

  it("looks a few weeks ahead and stops at a handful, for See the calendar", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      ev(`e${i}`, new Date(Date.parse("2026-10-22T19:00:00Z") + i * 86_400_000).toISOString()),
    );
    expect(up(many)).toHaveLength(UPCOMING_MAX);
    expect(up([ev("far", "2027-03-01T19:00:00Z")])).toEqual([]);
    expect(up([ev("past", "2026-10-20T19:00:00Z")])).toEqual([]);
  });
});
