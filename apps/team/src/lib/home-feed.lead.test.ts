// Home's lead (ADR 0118): your next thing, whatever it is, the one card up top; what's coming up is everything after
// it. The tricky part is the ordering: a fight's time comes from its place in the day, in London's clock either side
// of the clocks going back; a draft you're picking in is on now; what you're out of only leads with nothing else.
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

describe("Home's lead: your next thing, whatever it is", () => {
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

  it("what you've said you're out of steps aside for your next thing, but leads when there's nothing else", () => {
    const out = ev("session:1", "2026-10-23T18:30:00Z", { standing: "out", asking: false });
    const later = ev("session:5", "2026-10-25T10:00:00Z", { filter: "series:2", standing: "in", asking: false });
    expect(feed({ upcoming: [], events: [out, later] }).lead).toMatchObject({ key: "session:5" });
    expect(feed({ upcoming: [], events: [out] }).lead).toMatchObject({ key: "session:1" });
  });

  it("never a cancelled one, one with no day yet, one with nothing to answer, or one that's over", () => {
    const events = [
      ev("session:1", "2026-10-22T18:30:00Z", { cancelled: true }),
      ev("tournament:3", "2026-10-22T10:00:00Z", { kind: "tournament", dateTbc: true, filter: "type:3" }),
      ev("oneoff:1", "2026-10-22T19:00:00Z", { kind: "social", filter: "social", asking: false }),
      ev("session:0", "2026-10-21T08:00:00Z", { filter: "series:3" }),
    ];
    expect(feed({ upcoming: [], now: "2026-10-21T12:00:00Z", events }).lead).toBeNull();
    // Still on at 09:00 (it ends at 09:30): it leads
    expect(feed({ upcoming: [], now: "2026-10-21T09:00:00Z", events }).lead).toMatchObject({ key: "session:0" });
  });

  it("the lead Home showed stays this visit while it's still on: saying Out doesn't swap the card under your thumb", () => {
    const friday = ev("session:1", "2026-10-23T18:30:00Z", { standing: "out", asking: false });
    const sunday = ev("session:5", "2026-10-25T10:00:00Z", { filter: "series:2" });
    expect(feed({ upcoming: [], events: [friday, sunday] }).lead?.key).toBe("session:5");
    expect(feed({ upcoming: [], events: [friday, sunday], pinned: "session:1" }).lead?.key).toBe("session:1");
    // Gone (cancelled since): the next one leads
    const off = { ...friday, cancelled: true };
    expect(feed({ upcoming: [], events: [off, sunday], pinned: "session:1" }).lead?.key).toBe("session:5");
  });
});
