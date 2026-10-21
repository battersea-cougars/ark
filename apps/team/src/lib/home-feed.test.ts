import { describe, expect, it } from "vitest";
import type { AgendaRow, Tournament, TournamentType } from "../demo/model";
import { homeFeed, type FeedInput } from "./home-feed";

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
  it("a captain on the clock hears it first, above the club's dues", () => {
    const t = kumite({
      draftState: "open",
      teams: [
        { name: "A", logo: null, captainMemberId: ME, captainName: "", contact: "", players: [] },
        { name: "B", logo: null, captainMemberId: 2, captainName: "", contact: "", players: [] },
      ],
    });
    const rows = feed(t, { club: { total: 9000, people: 3, worst: 0 } });
    expect(rows.map((r) => r.text)).toEqual(["It's your pick", "Owed to the club £90"]);
    expect(rows[0].hot).toBe(true);
  });

  it("a member hears the draft is on, with nothing to open, then that the teams are out", () => {
    const on = feed(kumite({ draftState: "open" }));
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
    expect(feed(closed)).toMatchObject([{ text: "The teams are out", href: "/tournaments/kumite/teams" }]);
  });

  it("doesn't nag about a sign-up closing when Home already asks about that tournament up top", () => {
    const t = kumite();
    expect(feed(t, { agenda: [closes] })).toEqual([]);
    // A one-off tournament (not the next of a series Home asks about) still gets its reminder
    expect(feed(t, { agenda: [closes], upcoming: [] }).map((r) => r.sub)).toEqual(["Are you in?"]);
  });
});
