// Home's hero (ADR 0118): the club's next event, whatever it is, with where you stand on it (playing, answering, or
// not in it), the one card up top; what's coming up is everything after it. The tricky part is the ordering: a fight's time comes from its place in the day, in London's clock either side
// of the clocks going back; a draft you're picking in is on now; what you're out of leads all the same.
import { describe, expect, it } from "vitest";
import type { AgendaRow, Tournament, TournamentType } from "../demo/model";
import { homeFeed, type FeedInput, type UpcomingEvent } from "./home-feed";

const ME = 7;
const TODAY = "2026-10-21";
const type = { id: 1, slug: "kumite", name: "The Cougars Kumite", shortName: "Kumite" } as TournamentType;
const team = (id: number, captain: number, players: number[] = []) => ({
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
/** A Kumite you're on Team 2 in, its fixtures out: your fight is game 3, at 10:00 + 2 × (12 + 5) = 10:34. */
const kumite = (over: Partial<Tournament> = {}) =>
  ({
    id: 10,
    typeId: 1,
    name: "The Cougars Kumite",
    kind: "draft",
    status: "open",
    signupOpensOn: null,
    signupClosesOn: null,
    going: [ME],
    waitlist: [],
    out: [],
    draftState: "closed",
    heldOn: "2026-10-31",
    startTime: "10:00",
    gameMinutes: 12,
    season: null,
    teams: [team(1, 2), team(2, 4, [ME]), team(3, 5)],
    games: [game(81, 1, 1, 3), game(82, 2, 1, 3), game(83, 3, 2, 3)],
    ...over,
  }) as unknown as Tournament;
const ev = (key: string, startsAt: string, over: Partial<UpcomingEvent> = {}): UpcomingEvent => ({
  key,
  kind: "training",
  filter: "series:1",
  icon: "stick",
  title: "Friday Training",
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 90 * 60_000).toISOString(),
  venue: "Battersea Park",
  standing: null,
  asking: true,
  ...over,
});
/** The Kumite's own row on the schedule, which your fight stands in for. */
const kumiteEvent = (t: Tournament) =>
  ev(`tournament:${t.id}`, "2026-10-31T10:00:00Z", {
    kind: "tournament",
    filter: "type:1",
    title: t.name,
    standing: "in",
    asking: false,
  });
const feed = (over: Partial<FeedInput> = {}) => {
  const t = over.tournaments?.[0] ?? kumite();
  return homeFeed({
    me: ME,
    today: TODAY,
    runsDrafts: false,
    agenda: [],
    tournaments: [t],
    types: [type],
    upcoming: [{ type, t }],
    club: null,
    ...over,
  });
};

describe("Home's hero: the club's next event, whatever it is", () => {
  it("a Kumite fight before the next Friday leads, and Coming up has the Friday, not the Kumite again", () => {
    const t = kumite();
    const rows = feed({ events: [kumiteEvent(t), ev("session:2", "2026-11-06T19:00:00Z")] });
    expect(rows.lead).toMatchObject({ kind: "fight", at: "2026-10-31T10:34:00.000Z", fight: { game: { id: 83 } } });
    expect(rows.upcoming.map((r) => r.key)).toEqual(["session:2"]);
  });

  it("a Friday before the Kumite leads; the Kumite's row then says when your fight is", () => {
    const t = kumite();
    const rows = feed({ events: [kumiteEvent(t), ev("session:1", "2026-10-23T18:30:00Z")] });
    expect(rows.lead).toMatchObject({ kind: "event", key: "session:1" });
    expect(rows.upcoming.map((r) => [r.key, r.sub])).toEqual([
      ["tournament:10", "10 to 11:30am · Your match at 10:34am"],
    ]);
  });

  it("a fight's time is London's: before the clocks go back, 10:00 is 09:00 UTC, so it beats a 09:30 UTC start", () => {
    // 24 Oct 2026 is still BST. Game 1 at 10:00 London; a naive 10:00 UTC would put the social first
    const t = kumite({ heldOn: "2026-10-24", games: [game(83, 1, 2, 3)] });
    const brunch = ev("oneoff:1", "2026-10-24T09:30:00Z", { kind: "social", filter: "social", title: "Brunch" });
    const rows = feed({ tournaments: [t], upcoming: [{ type, t }], events: [brunch] });
    expect(rows.lead).toMatchObject({ kind: "fight", at: "2026-10-24T09:00:00.000Z" });
    expect(rows.upcoming.map((r) => r.key)).toEqual(["oneoff:1"]);
  });

  it("a fight already played isn't next: the one after it is, and once all are played, the Kumite's done with you", () => {
    const played = kumite({ games: [game(83, 3, 2, 3, "done"), game(84, 4, 2, 1)] });
    expect(feed({ tournaments: [played], upcoming: [{ type, t: played }] }).lead).toMatchObject({
      kind: "fight",
      fight: { game: { id: 84 } },
    });
    const allDone = kumite({ games: [game(83, 3, 2, 3, "done")] });
    expect(feed({ tournaments: [allDone], upcoming: [{ type, t: allDone }] }).lead).toBeNull();
  });

  it("a captain on the clock leads, ahead of tonight's training, and isn't in what needs you now as well", () => {
    const t = kumite({ draftState: "open", going: [ME, 4, 8, 9], teams: [team(1, ME), team(2, 4)], games: [] });
    const rows = feed({
      tournaments: [t],
      upcoming: [{ type, t }],
      now: "2026-10-21T12:00:00Z",
      events: [ev("session:1", "2026-10-21T18:30:00Z")],
    });
    expect(rows.lead).toMatchObject({ kind: "draft", item: { text: "It's your pick" } });
    expect(rows.now).toEqual([]);
    expect(rows.upcoming.map((r) => r.key)).toEqual(["session:1"]);
  });

  it("a captain whose picks are done doesn't lead: the draft goes on without them", () => {
    // Two teams, one left to draft, and team 2 on the clock: team 1's captain has had their last pick
    const picked = { ...team(1, ME), players: [{ memberId: 8, name: "", pick: 1 }] };
    const t = kumite({ draftState: "open", going: [ME, 4, 8, 9], teams: [picked, team(2, 4)], games: [] });
    const rows = feed({ tournaments: [t], upcoming: [{ type, t }], events: [ev("session:1", "2026-10-23T18:30:00Z")] });
    expect(rows.lead?.kind).not.toBe("draft");
  });

  it("a captain's draft day leads from London's midnight that day: before that evening's training", () => {
    const t = kumite({ draftState: "scheduled", teams: [team(1, ME), team(2, 4)], games: [] });
    const draft = {
      key: "draft:10",
      kind: "draft",
      sourceId: 10,
      day: "2026-10-23",
      startsAt: "2026-10-23T23:59:00Z",
      allDay: true,
    } as AgendaRow;
    const rows = feed({
      tournaments: [t],
      upcoming: [{ type, t }],
      agenda: [draft],
      events: [
        ev("session:1", "2026-10-23T18:30:00Z"),
        ev("session:9", "2026-10-22T18:30:00Z", { filter: "series:2" }),
      ],
    });
    // The 22nd's training is sooner still; then the draft's day, from 23:00 UTC on the 22nd (midnight in BST)
    expect(rows.lead).toMatchObject({ kind: "event", key: "session:9" });
    const without = feed({
      tournaments: [t],
      upcoming: [{ type, t }],
      agenda: [draft],
      events: [ev("session:1", "2026-10-23T18:30:00Z")],
    });
    expect(without.lead).toMatchObject({ kind: "draft", key: "draft:10", at: "2026-10-22T23:00:00.000Z" });
    expect(without.now).toEqual([]);
  });

  it("what you've said you're out of still leads when it's the club's next: its card shows your Out", () => {
    const out = ev("session:1", "2026-10-23T18:30:00Z", { standing: "out", asking: false });
    const later = ev("session:5", "2026-10-25T10:00:00Z", { filter: "series:2", standing: "in", asking: false });
    const rows = feed({ upcoming: [], events: [out, later] });
    expect(rows.lead).toMatchObject({ key: "session:1", role: "out" });
    expect(rows.upcoming.map((r) => r.key)).toEqual(["session:5"]);
  });

  it("a night whose sign-up opens later is still yours (In comes on Monday), not one you're out of", () => {
    const friday = ev("session:1", "2026-10-30T19:30:00Z", { asking: false, opens: "Mon" });
    expect(feed({ upcoming: [], events: [friday] }).lead).toMatchObject({ key: "session:1", role: "yours" });
    const kumite = ev("tournament:3", "2026-11-28T10:00:00Z", {
      kind: "tournament",
      filter: "type:1",
      asking: false,
      signupOpensOn: "2026-11-01",
    });
    expect(feed({ upcoming: [], events: [kumite] }).lead).toMatchObject({ role: "yours" });
    // Closed and not in it: not yours
    expect(feed({ upcoming: [], events: [{ ...kumite, signupOpensOn: null, signupClosed: true }] }).lead).toMatchObject(
      { role: "notIn" },
    );
  });

  it("never a cancelled one, one with no day yet, or one that's over", () => {
    const events = [
      ev("session:1", "2026-10-22T18:30:00Z", { cancelled: true }),
      ev("tournament:3", "2026-10-22T10:00:00Z", { kind: "tournament", dateTbc: true, filter: "type:3" }),
      ev("session:0", "2026-10-21T08:00:00Z", { filter: "series:3" }),
    ];
    expect(feed({ upcoming: [], now: "2026-10-21T12:00:00Z", events }).lead).toBeNull();
    // Still on at 09:00 (it ends at 09:30): it leads
    expect(feed({ upcoming: [], now: "2026-10-21T09:00:00Z", events }).lead).toMatchObject({ key: "session:0" });
  });

  it("one with nothing to answer still leads when it's the club's next: it's the club's, not yours", () => {
    const quiz = ev("oneoff:1", "2026-10-22T19:00:00Z", { kind: "social", filter: "social", asking: false });
    const friday = ev("session:1", "2026-10-23T18:30:00Z");
    const rows = feed({ upcoming: [], events: [friday, quiz] });
    expect(rows.lead).toMatchObject({ kind: "event", key: "oneoff:1", role: "notIn" });
    expect(rows.upcoming.map((r) => r.key)).toEqual(["session:1"]);
  });

  it("the hero Home showed stays this visit while it's still on: nothing swaps the card under your thumb", () => {
    const friday = ev("session:1", "2026-10-23T18:30:00Z", { standing: "out", asking: false });
    const sunday = ev("session:5", "2026-10-25T10:00:00Z", { filter: "series:2" });
    expect(feed({ upcoming: [], events: [friday, sunday] }).lead?.key).toBe("session:1");
    // Something sooner added while Home's open doesn't take its place this visit
    const sooner = ev("oneoff:1", "2026-10-22T19:00:00Z", { kind: "social", filter: "social" });
    expect(feed({ upcoming: [], events: [sooner, friday, sunday], pinned: "session:1" }).lead?.key).toBe("session:1");
    // Gone (cancelled since): the next one leads
    const off = { ...friday, cancelled: true };
    expect(feed({ upcoming: [], events: [off, sunday], pinned: "session:1" }).lead?.key).toBe("session:5");
  });
});

describe("the Kumite this Friday, the Friday's training off for it", () => {
  // Today's Wednesday 21 October; the Kumite's on Friday the 23rd at 10am, its sign-up closed. The night's training
  // is cancelled for it; the one after is the 30th.
  const t = kumite({ heldOn: "2026-10-23", games: [game(83, 1, 2, 3)] });
  const off = ev("session:1", "2026-10-23T18:30:00Z", { cancelled: true });
  const next = ev("session:2", "2026-10-30T19:30:00Z");
  const theKumite = (over: Partial<UpcomingEvent>) =>
    ev("tournament:10", "2026-10-23T09:00:00Z", {
      kind: "tournament",
      filter: "type:1",
      title: t.name,
      href: "/tournaments/kumite/schedule",
      asking: false,
      signupClosed: true,
      ...over,
    });

  it("a member not in it: the Kumite is still the hero (they're out of it), not next week's training", () => {
    const notIn = kumite({ ...t, going: [4, 5], teams: [team(1, 2, [4]), team(2, 3, [5])] });
    const rows = feed({ tournaments: [notIn], upcoming: [{ type, t: notIn }], events: [off, next, theKumite({})] });
    expect(rows.lead).toMatchObject({ kind: "event", key: "tournament:10", role: "notIn" });
    // Coming up: the night that's off says so, and the Friday after it shows too
    expect(rows.upcoming.map((r) => [r.key, r.sub])).toEqual([
      ["session:1", "7:30 to 9pm · Cancelled"],
      ["session:2", "7:30 to 9pm · Are you in?"],
    ]);
  });

  it("a member on a team plays: their match is the hero, its tournament not a row as well", () => {
    const rows = feed({
      tournaments: [t],
      upcoming: [{ type, t }],
      events: [off, next, theKumite({ standing: "in" })],
    });
    expect(rows.lead).toMatchObject({ kind: "fight", at: "2026-10-23T09:00:00.000Z", fight: { game: { id: 83 } } });
    expect(rows.upcoming.map((r) => r.key)).toEqual(["session:1", "session:2"]);
  });

  it("the cancelled night never leads, even for someone who'd said they were in", () => {
    const rows = feed({ upcoming: [], events: [{ ...off, standing: "in" }, next, theKumite({})] });
    expect(rows.lead?.key).toBe("tournament:10");
  });

  it("with the training still on that evening, the Kumite's morning is still sooner: it's the hero", () => {
    const on = ev("session:1", "2026-10-23T18:30:00Z", { standing: "in", asking: false });
    expect(feed({ upcoming: [], events: [on, theKumite({})] }).lead).toMatchObject({ key: "tournament:10" });
  });
});
