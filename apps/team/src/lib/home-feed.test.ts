import { describe, expect, it } from "vitest";
import type { AgendaRow, Tournament, TournamentType } from "../demo/model";
import { homeFeed, owedNotice, UPCOMING_MAX, type FeedInput, type UpcomingEvent } from "./home-feed";

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
    heldOn: "2026-10-31",
    startTime: "10:00",
    gameMinutes: 12,
    season: null,
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
  it("a captain on the clock has it as Home's lead; the club's dues are an admin's line, at the bottom", () => {
    const t = kumite({
      draftState: "open",
      teams: [
        { name: "A", logo: null, captainMemberId: ME, captainName: "", contact: "", players: [] },
        { name: "B", logo: null, captainMemberId: 2, captainName: "", contact: "", players: [] },
      ],
    });
    const rows = feed(t, { club: { total: 9000, people: 3, worst: 0 } });
    // Straight into the draft room (ADR 0060), the whole screen for the pick
    expect(rows.lead).toMatchObject({
      kind: "draft",
      item: { text: "It's your pick", hot: true, href: "/tournaments/kumite/draft/room" },
    });
    expect(rows.now).toEqual([]);
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

  it("on a team once the fixtures are out: your next fight, up top, in place of the teams being out", () => {
    const team = (id: number, captain: number, players: number[]) => ({
      id,
      name: "",
      logo: null,
      captainMemberId: captain,
      captainName: "",
      contact: "",
      players: players.map((memberId) => ({ memberId, name: "" })),
    });
    const game = (id: number, position: number, home: number, away: number, status = "next") =>
      ({ id, position, homeTeamId: home, awayTeamId: away, status }) as never;
    const out = kumite({
      draftState: "closed",
      teams: [team(1, 2, [3]), team(2, 4, [ME]), team(3, 5, [6])],
      games: [game(81, 1, 1, 3, "done"), game(82, 2, 2, 3), game(83, 3, 1, 2)],
    });
    const rows = feed(out);
    expect(rows.lead).toMatchObject({ kind: "fight", fight: { game: { id: 82 }, teamId: 2 } });
    expect(rows.now).toEqual([]);
    // Not on a team: no fight of yours, and the teams are still news
    expect(feed(out, { me: 99 }).lead).toBeNull();
    expect(feed(out, { me: 99 }).now.map((r) => r.text)).toEqual(["The teams are out"]);
  });

  it("doesn't nag about a sign-up closing when Home already asks about that tournament up top", () => {
    const t = kumite();
    expect(feed(t, { agenda: [closes] }).now).toEqual([]);
    // A one-off tournament (not the next of a series Home asks about) still gets its reminder
    expect(feed(t, { agenda: [closes], upcoming: [] }).now).toMatchObject([
      { text: "Sign-up for The Cougars Kumite closes", sub: "Are you in?", on: { at: closes.startsAt } },
    ]);
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

describe("what you owe, in the locker room", () => {
  it("a member who owes sees a notice opening their tab, and no row in the feed", () => {
    expect(owedNotice({ pence: 5800, kinds: ["session", "session", "session"] })).toEqual({
      text: "£58 to pay",
      sub: "Your tab · 3 nights",
      href: "/me/tab",
    });
    expect(owedNotice({ pence: 1000, kinds: ["quarterly"] })?.sub).toBe("Your tab · 1 charge");
    expect(feed(kumite()).now.some((r) => r.href === "/me/tab")).toBe(false);
  });

  it("nobody square sees one", () => {
    expect(owedNotice({ pence: 0, kinds: [] })).toBeNull();
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
  // The club's next event, on all day today, is the hero: what's under test is what comes after it
  const hero = ev("hero", "2026-10-20T23:00:00Z", { endsAt: "2026-10-21T22:59:00Z" });
  const up = (events: UpcomingEvent[]) => feed(kumite(), { events: [hero, ...events] }).upcoming;
  // With no hero of its own: the first is
  const after = (events: UpcomingEvent[]) => feed(kumite(), { events }).upcoming;

  it("is in date order, a date on the left of each", () => {
    const rows = up([ev("quiz", "2026-11-05T19:00:00Z"), ev("drinks", "2026-10-30T19:00:00Z")]);
    expect(rows.map((r) => r.text)).toEqual(["drinks", "quiz"]);
    expect(rows[0].on).toEqual({ at: "2026-10-30T19:00:00Z", season: undefined, tbc: undefined });
    expect(rows[0].sub).toBe("7pm · The Lock");
  });

  it("doesn't repeat the lead Friday: the row is the Friday after it, once", () => {
    const rows = after([{ ...friday(0), asking: true }, friday(1)]);
    expect(rows.map((r) => r.key)).toEqual(["session:1"]);
  });

  it("each training and tournament series once, its next; where you stand, or when sign-up opens", () => {
    const rows = after([
      { ...friday(0), asking: true },
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
      ["tournament:1", "10am · You're in"],
      ["tournament:2", "Sign-up opens 1 May"],
    ]);
    expect(rows[1].on).toMatchObject({ season: { name: "summer", year: 2027 }, tbc: true });
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
