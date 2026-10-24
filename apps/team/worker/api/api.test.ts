// The team app's API, as the club uses it: the admin opens the app on the real roster and schedule, cancels the
// odd Friday, edits members and the training. Driven through the real handler on an in-memory D1 with every
// migration and the roster seed applied (ADR 0031).
import { beforeEach, describe, expect, it } from "vitest";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { FIRST_KUMITE_SQL } from "@cougars/shared/testing/kumite";
import { parseRoster, rosterSql } from "../../../../scripts/lib/roster.mjs";
import { ACTIONS } from "../../src/access/actions";
import { ROUTES, handleApi, type Env } from "./api";
import { whatsOn } from "../../../web/src/lib/server/whats-on";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Alt Uploader", position: "F", rating: 45, roles: ["Contributor"] },
  { name: "Reg Player", position: "F", rating: 60 },
];

// Tuesday 6 October 2026, midday in London
const NOW = new Date("2026-10-06T11:00:00Z");
let env: Env;

beforeEach(() => {
  const db = createTestD1();
  db.raw.exec(rosterSql(parseRoster(JSON.stringify(ROSTER)), NOW));
  db.raw.exec(FIRST_KUMITE_SQL);
  env = { DB: db, TEAM_ENV: "local", TEAM_AUTO_ADMIN: "1" };
});

// The tests read whatever the API sent back; its shapes are checked by the assertions themselves.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

async function call(method: string, path: string, payload?: unknown, e: Env = env, now = NOW) {
  const res = await handleApi(
    new Request(`http://team.test${path}`, {
      method,
      headers: { "content-type": "application/json", origin: "http://team.test" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
    e,
    now,
  );
  return { status: res.status, body: (await res.json()) as Body };
}
const boot = async () => (await call("GET", "/api/bootstrap")).body;
/** The sessions still to come (bootstrap also sends the last four weeks, for what's just been held). */
const ahead = (b: Body) => b.sessions.filter((s: { heldOn: string }) => s.heldOn >= "2026-10-06");

describe("opening the app", () => {
  it("shows every Friday for the next 12 weeks at Battersea Sports Centre, 21 skaters and 3 goalies", async () => {
    const b = await boot();
    expect(b.series).toEqual([
      expect.objectContaining({
        name: "Friday Training",
        weekdays: ["fri"],
        startTime: "19:30",
        endTime: "21:30",
        venueId: b.venues[0].id,
        capacity: 21,
        goalieCapacity: 3,
      }),
    ]);
    expect(b.venues).toEqual([
      expect.objectContaining({ name: "Battersea Sports Centre", mapUrl: "https://maps.app.goo.gl/w5GZTqQF9Qekgeaa6" }),
      // Where the Kumite goes afterwards (ADR 0074)
      expect.objectContaining({ name: "The Anchor", mapUrl: "https://maps.app.goo.gl/GhKGiPB1vKnpV6HB7" }),
    ]);
    const dates = ahead(b).map((s: { heldOn: string }) => s.heldOn);
    expect(dates[0]).toBe("2026-10-09");
    expect(dates).toHaveLength(12);
    expect(dates.every((d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5)).toBe(true);
  });

  it("has the first Kumite in summer 2027, its day not set yet", async () => {
    const b = await boot();
    expect(b.tournamentTypes.map((t: { name: string }) => t.name)).toEqual(["The Cougars Kumite"]);
    expect(b.tournaments).toEqual([
      expect.objectContaining({
        name: "The Cougars Kumite",
        season: "summer",
        heldOn: "2027-08-31",
        status: "planned",
      }),
    ]);
  });

  it("knows the roster and who does what: the first admin is you, the uploader is a Contributor", async () => {
    const b = await boot();
    const byName = Object.fromEntries(b.members.map((m: { name: string }) => [m.name, m]));
    expect(b.me).toBe(byName["Dana Admin"].id);
    expect(byName["Alt Uploader"].roles.sort()).toEqual(["Contributor", "Member"]);
    expect(byName["Reg Player"]).toMatchObject({ position: "F", rating: 60, roles: ["Member"], status: "active" });
    expect(b.actions).toContain("manage:all");
  });

  it("doesn't make the Fridays twice when opened again", async () => {
    await boot();
    expect(ahead(await boot())).toHaveLength(12);
  });
});

describe("the schedule", () => {
  it("an admin cancels Christmas Day's Friday, and can restore it", async () => {
    const xmas = (await boot()).sessions.find((s: { heldOn: string }) => s.heldOn === "2026-12-25");
    expect((await call("POST", `/api/sessions/${xmas.id}/cancelled`, { cancelled: true })).status).toBe(200);
    expect((await boot()).sessions.find((s: { id: number }) => s.id === xmas.id).cancelledAt).toBe(NOW.toISOString());
    await call("POST", `/api/sessions/${xmas.id}/cancelled`, { cancelled: false });
    expect((await boot()).sessions.find((s: { id: number }) => s.id === xmas.id).cancelledAt).toBeNull();
  });

  it("moving training to Thursdays drops the untouched Fridays but keeps a cancelled one, for whoever signed up", async () => {
    const b = await boot();
    const friday = b.series[0];
    const xmas = b.sessions.find((s: { heldOn: string }) => s.heldOn === "2026-12-25");
    await call("POST", `/api/sessions/${xmas.id}/cancelled`, { cancelled: true });
    const res = await call("PUT", `/api/series/${friday.id}`, { ...friday, weekdays: ["thu"] });
    expect(res.status).toBe(200);
    const days = (await boot()).sessions.map((s: { heldOn: string }) => s.heldOn);
    // Thursdays from today on
    expect(days).toContain("2026-10-08");
    expect(days).toContain("2026-10-15");
    expect(days).toContain("2026-12-25");
    expect(days).not.toContain("2026-10-09");
  });

  it("an admin sets a tournament's awards, a fun one included", async () => {
    const kumite = (await boot()).tournamentTypes[0];
    // The Kumite starts with the joke and builds to the champions, the finale, each saying how it's decided
    expect(kumite.awards.map((a: { name: string; decidedBy: { kind: string } }) => [a.name, a.decidedBy.kind])).toEqual(
      [
        ["The Judges' Call", "live"],
        ["Top scorer", "stat"],
        ["Best keeper", "vote"],
        ["Champions", "stat"],
      ],
    );
    const awards = [
      { name: "Champions", about: "Top of the table." },
      { name: "The Slapshot Sensei", about: "Fastest shot from a faceoff." },
      { name: "  ", about: "an empty row is dropped" },
    ];
    expect((await call("PUT", `/api/tournament-types/${kumite.id}`, { ...kumite, awards })).status).toBe(200);
    // Saved without saying how each is decided: the old guess from its name is written in, once (ADR 0044)
    expect((await boot()).tournamentTypes[0].awards).toEqual([
      { ...awards[0], decidedBy: { kind: "stat", stat: "table" } },
      { ...awards[1], decidedBy: { kind: "live", options: [] } },
    ]);
    // Said how, it's kept as said; a stat we don't track is refused
    const voted = [{ name: "MVP", about: "", decidedBy: { kind: "vote", voters: "players", tieBreak: "points" } }];
    expect((await call("PUT", `/api/tournament-types/${kumite.id}`, { ...kumite, awards: voted })).status).toBe(200);
    expect((await boot()).tournamentTypes[0].awards).toEqual(voted);
    const unknown = [{ name: "Best hair", about: "", decidedBy: { kind: "stat", stat: "hair" } }];
    expect((await call("PUT", `/api/tournament-types/${kumite.id}`, { ...kumite, awards: unknown })).status).toBe(400);
    const twins = [
      { name: "MVP", about: "" },
      { name: "mvp", about: "" },
    ];
    expect((await call("PUT", `/api/tournament-types/${kumite.id}`, { ...kumite, awards: twins })).status).toBe(400);
    const tooMany = Array.from({ length: 9 }, (_, i) => ({ name: `Award ${i}`, about: "" }));
    expect((await call("PUT", `/api/tournament-types/${kumite.id}`, { ...kumite, awards: tooMany })).status).toBe(400);
  });

  it("a Kumite date is at the series' saved venue, and the website's map follows when the venue's link changes", async () => {
    const b = await boot();
    const [rink, kumite, date] = [b.venues[0], b.tournamentTypes[0], b.tournaments[0]];
    expect(kumite.venueId).toBe(rink.id);
    expect(date).toMatchObject({ venueId: null, location: "", mapUrl: "" });
    const kumiteOnline = async () => (await whatsOn(env.DB, NOW)).find((i) => i.kind === "tournament")!;
    expect(await kumiteOnline()).toMatchObject({ venue: "Battersea Sports Centre", mapUrl: rink.mapUrl });

    const moved = { ...rink, mapUrl: "https://maps.app.goo.gl/NewEntrance" };
    expect((await call("PUT", `/api/venues/${rink.id}`, moved)).status).toBe(200);
    expect((await kumiteOnline()).mapUrl).toBe("https://maps.app.goo.gl/NewEntrance");

    // This one date somewhere else, with the link pasted for it: no venue saved
    const put = (changes: object) => call("PUT", `/api/tournaments/${date.id}`, { ...date, ...changes });
    expect((await put({ location: "Latchmere Leisure Centre", mapUrl: "https://maps.app.goo.gl/Latch" })).status).toBe(
      200,
    );
    expect(await kumiteOnline()).toMatchObject({
      venue: "Latchmere Leisure Centre",
      mapUrl: "https://maps.app.goo.gl/Latch",
    });
    expect((await put({ venueId: 999 })).status).toBe(400);
  });

  it("an admin saves a venue, and a new training picks it", async () => {
    const saved = await call("POST", "/api/venues", {
      name: "Latchmere Leisure Centre",
      address: "Burns Road, London SW11 5AD",
      mapUrl: "",
    });
    expect(saved.status).toBe(201);
    expect((await boot()).venues.map((v: { name: string }) => v.name)).toEqual([
      "Battersea Sports Centre",
      "Latchmere Leisure Centre",
      "The Anchor",
    ]);
    // A link that isn't a web link never reaches a page
    const bad = { name: "Nowhere", mapUrl: "javascript:alert(1)" };
    expect((await call("POST", "/api/venues", bad)).status).toBe(400);

    const t = await call("POST", "/api/series", {
      name: "Sunday Skills",
      shortName: "Sunday",
      icon: "skate",
      tone: "green",
      repeatEvery: 1,
      weekdays: ["sun"],
      startsOn: "2026-10-11",
      endsOn: null,
      startTime: "10:00",
      endTime: "11:30",
      venueId: saved.body.id,
      venue: "ignored when there's a venue",
      capacity: 12,
      goalieCapacity: 2,
      public: true,
      active: true,
    });
    expect(t.status).toBe(201);
    const sunday = (await boot()).series.find((s: { id: number }) => s.id === t.body.id);
    expect(sunday).toMatchObject({ venueId: saved.body.id, venue: "", mapUrl: "" });
    // No link saved: the website's map searches for the name and address
    const online = (await whatsOn(env.DB, NOW)).find((i) => i.title === "Sunday Skills")!;
    expect(online.mapUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=Latchmere%20Leisure%20Centre%2C%20Burns%20Road%2C%20London%20SW11%205AD",
    );
  });

  it("an admin sets a Kumite's sign-up deadline, draft night and its captains' teams, in no pick order till the draw", async () => {
    const b = await boot();
    const date = b.tournaments[0];
    const ids = Object.fromEntries(b.members.map((m: { name: string; id: number }) => [m.name, m.id]));
    const team = (captain: string, players: string[] = []) => ({
      name: "",
      logo: null,
      captainMemberId: ids[captain],
      players: players.map((p) => ({ memberId: ids[p] })),
    });
    const details = {
      ...date,
      kind: "draft",
      heldOn: "2027-06-12",
      season: null,
      signupClosesOn: "2027-06-05",
      draftOn: "2027-06-09",
      teams: [team("Reg Player"), team("Dana Admin")],
    };
    expect((await call("PUT", `/api/tournaments/${date.id}`, details)).status).toBe(200);
    const saved = (await boot()).tournaments[0];
    expect(saved).toMatchObject({ kind: "draft", signupClosesOn: "2027-06-05", draftOn: "2027-06-09" });
    expect(saved.teams.map((t: { captainMemberId: number; pick: number }) => [t.captainMemberId, t.pick])).toEqual([
      [ids["Reg Player"], null],
      [ids["Dana Admin"], null],
    ]);
    // Nothing after the day itself; a draft's captain is a member; nobody on two teams
    const bad = [
      { draftOn: "2027-06-13" },
      { signupClosesOn: "2027-06-20" },
      { teams: [{ ...team("Reg Player"), captainMemberId: null, captainName: "Someone" }] },
      // (A draft's players come from its picks, never the editor: the same captain twice is how it'd clash)
      { teams: [team("Reg Player"), team("Reg Player")] },
    ];
    for (const b of bad)
      expect((await call("PUT", `/api/tournaments/${date.id}`, { ...details, ...b })).status).toBe(400);
  });

  it("teams enter a cup: a name, a logo, a captain from outside the club, and players by name", async () => {
    const ids = Object.fromEntries((await boot()).members.map((m: { name: string; id: number }) => [m.name, m.id]));
    const logo = "data:image/png;base64,iVBORw0KGgo=";
    const cup = {
      typeId: null,
      kind: "teams",
      name: "Charity Cup",
      location: "",
      heldOn: "2027-03-20",
      startTime: "10:00",
      endTime: "15:00",
      capacity: null,
      status: "open",
      feePence: 0,
      teams: [
        {
          name: "Clapham Crushers",
          logo,
          captainMemberId: null,
          captainName: "Jo Outsider",
          contact: "jo@example.com",
          players: [{ name: "Jo Outsider" }, { name: "Max Visitor" }],
        },
        {
          name: "Cougars B",
          logo: null,
          captainMemberId: ids["Reg Player"],
          players: [{ memberId: ids["Dana Admin"] }],
        },
      ],
    };
    const t = await call("POST", "/api/tournaments", cup);
    expect(t.status).toBe(201);
    const saved = (await boot()).tournaments.find((x: { id: number }) => x.id === t.body.id);
    expect(saved.teams).toMatchObject([
      {
        name: "Clapham Crushers",
        logo,
        captainName: "Jo Outsider",
        contact: "jo@example.com",
        pick: null,
        players: [
          { memberId: null, name: "Jo Outsider" },
          { memberId: null, name: "Max Visitor" },
        ],
      },
      { name: "Cougars B", captainMemberId: ids["Reg Player"], players: [{ memberId: ids["Dana Admin"] }] },
    ]);
    // Every team needs a name, and a logo has to be a small image
    const put = (teams: object[]) => call("PUT", `/api/tournaments/${t.body.id}`, { ...cup, teams });
    expect((await put([{ ...cup.teams[0], name: "" }])).status).toBe(400);
    expect((await put([{ ...cup.teams[0], logo: "javascript:alert(1)" }])).status).toBe(400);
  });

  it("an admin plans a Kumite for next summer before anyone knows the day", async () => {
    const date = (await boot()).tournaments[0];
    const put = (changes: object) => call("PUT", `/api/tournaments/${date.id}`, { ...date, ...changes });
    // Just a season: its day is the season's last, so it sorts after summer's dates
    expect((await put({ season: "summer", heldOn: "2027-08-31" })).status).toBe(200);
    expect((await boot()).tournaments[0]).toMatchObject({ season: "summer", heldOn: "2027-08-31" });
    // Winter runs into the next year
    expect((await put({ season: "winter", heldOn: "2028-02-29" })).status).toBe(200);
    // A made-up day, or a season that isn't one, is refused
    expect((await put({ season: "summer", heldOn: "2027-07-01" })).status).toBe(400);
    expect((await put({ season: "monsoon", heldOn: "2027-08-31" })).status).toBe(400);
    // Then the day is set: no season, just the day
    expect((await put({ season: null, heldOn: "2027-06-12" })).status).toBe(200);
    expect((await boot()).tournaments[0]).toMatchObject({ season: null, heldOn: "2027-06-12" });
  });

  it("an admin schedules a one-off tournament in no series, then puts it in one", async () => {
    const kumite = (await boot()).tournamentTypes[0];
    const oneOff = {
      name: "Charity Cup",
      location: "Battersea Park courts",
      heldOn: "2027-03-20",
      startTime: "10:00",
      endTime: "15:00",
      capacity: 30,
      status: "planned",
      feePence: 500,
    };
    const t = await call("POST", "/api/tournaments", { ...oneOff, typeId: null });
    expect(t.status).toBe(201);
    const listed = (await boot()).tournaments.find((x: { id: number }) => x.id === t.body.id);
    expect(listed).toMatchObject({ typeId: null, venueId: null, location: "Battersea Park courts" });
    // Into the Kumite series, and out again; a series that doesn't exist is refused
    expect((await call("PUT", `/api/tournaments/${t.body.id}`, { ...oneOff, typeId: kumite.id })).status).toBe(200);
    expect((await boot()).tournaments.find((x: { id: number }) => x.id === t.body.id).typeId).toBe(kumite.id);
    expect((await call("PUT", `/api/tournaments/${t.body.id}`, { ...oneOff, typeId: null })).status).toBe(200);
    expect((await call("PUT", `/api/tournaments/${t.body.id}`, { ...oneOff, typeId: 999 })).status).toBe(400);
  });

  it("a tournament copies its series' rules and awards, and can change them for itself", async () => {
    const kumite = (await boot()).tournamentTypes[0];
    const base = {
      typeId: kumite.id,
      name: "Spring Kumite",
      location: "",
      heldOn: "2027-04-10",
      startTime: "11:00",
      endTime: "16:00",
      capacity: null,
      status: "planned",
      feePence: 0,
    };
    // Left out: the series' own
    const t = await call("POST", "/api/tournaments", base);
    const copied = () => boot().then((b) => b.tournaments.find((x: { id: number }) => x.id === t.body.id));
    expect(await copied()).toMatchObject({
      pointsWin: kumite.pointsWin,
      gameMinutes: kumite.gameMinutes,
      kind: kumite.kind,
      awards: kumite.awards,
    });
    // This one plays 15-minute games for 2 points a win, with one award; the series is untouched
    const changed = { ...base, pointsWin: 2, gameMinutes: 15, awards: [{ name: "Champions", about: "" }] };
    expect((await call("PUT", `/api/tournaments/${t.body.id}`, changed)).status).toBe(200);
    expect(await copied()).toMatchObject({ pointsWin: 2, gameMinutes: 15, awards: [{ name: "Champions" }] });
    expect((await boot()).tournamentTypes[0]).toMatchObject({ pointsWin: kumite.pointsWin, awards: kumite.awards });
  });

  it("a new training gets its own sessions and a slug", async () => {
    const res = await call("POST", "/api/series", {
      name: "Sunday Skills",
      shortName: "Sunday",
      icon: "skate",
      tone: "green",
      repeatEvery: 1,
      weekdays: ["sun"],
      startsOn: "2026-10-11",
      endsOn: null,
      startTime: "10:00",
      endTime: "11:30",
      venue: "The park",
      capacity: 16,
      goalieCapacity: null,
      public: false,
      active: true,
    });
    expect(res).toMatchObject({ status: 201, body: { slug: "sunday" } });
    const sundays = (await boot()).sessions.filter((s: { seriesId: number }) => s.seriesId === res.body.id);
    expect(sundays).toHaveLength(12);
  });

  it("schedules another Kumite, and adds a one-off event", async () => {
    const kumite = (await boot()).tournamentTypes[0];
    const t = await call("POST", "/api/tournaments", {
      typeId: kumite.id,
      name: "Winter Kumite",
      location: "Battersea Sports Centre",
      heldOn: "2026-12-05",
      startTime: "11:00",
      endTime: "16:00",
      capacity: null,
      status: "planned",
      feePence: 0,
    });
    expect(t.status).toBe(201);
    const e = await call("POST", "/api/club-events", {
      title: "Kit day",
      startsAt: "2026-10-24T10:00:00.000Z",
      endsAt: "2026-10-24T12:00:00.000Z",
      venue: "",
      signup: false,
      capacity: null,
    });
    expect(e.status).toBe(201);
    const b = await boot();
    // In date order: a day, or a season's last
    expect(b.tournaments.map((x: { name: string; season: string | null }) => [x.name, x.season])).toEqual([
      ["Winter Kumite", null],
      ["The Cougars Kumite", "summer"],
    ]);
    expect(b.clubEvents.map((x: { title: string }) => x.title)).toEqual(["Kit day"]);
  });

  it("lets an admin add an event for the website, change it and call it off", async () => {
    const added = await call("POST", "/api/club-events", {
      title: "Summer social",
      startsAt: "2026-10-24T18:00:00.000Z",
      endsAt: "2026-10-24T22:00:00.000Z",
      venue: "The Latchmere",
      // A pub the club goes to once: no venue saved, just the link pasted from Google Maps
      mapUrl: "https://maps.app.goo.gl/TheLatchmere",
      description: "Drinks after the last Friday of the month.",
      signup: false,
      capacity: null,
    });
    expect(added.status).toBe(201);
    // On the website unless they say otherwise, its name opening the pasted map
    expect((await boot()).clubEvents[0]).toMatchObject({ title: "Summer social", public: true, cancelledAt: null });
    expect((await whatsOn(env.DB, NOW)).find((i) => i.kind === "event")).toMatchObject({
      venue: "The Latchmere",
      mapUrl: "https://maps.app.goo.gl/TheLatchmere",
    });

    const id = added.body.id;
    const changed = await call("PUT", `/api/club-events/${id}`, {
      title: "Summer social",
      startsAt: "2026-10-24T19:00:00.000Z",
      endsAt: "2026-10-24T23:00:00.000Z",
      venue: "The Latchmere",
      description: "Now from 8.",
      public: false,
      signup: true,
      capacity: 30,
    });
    expect(changed.status).toBe(200);
    expect((await boot()).clubEvents[0]).toMatchObject({
      startsAt: "2026-10-24T19:00:00.000Z",
      description: "Now from 8.",
      public: false,
      signup: true,
      capacity: 30,
    });

    expect((await call("POST", `/api/club-events/${id}/cancelled`, { cancelled: true })).status).toBe(200);
    expect((await boot()).clubEvents[0].cancelledAt).toBe(NOW.toISOString());
    await call("POST", `/api/club-events/${id}/cancelled`, { cancelled: false });
    expect((await boot()).clubEvents[0].cancelledAt).toBeNull();

    const gone = { title: "x", startsAt: NOW.toISOString(), endsAt: NOW.toISOString(), signup: false };
    expect((await call("PUT", "/api/club-events/999", gone)).status).toBe(404);
  });

  it("looks 12 more weeks ahead each time an admin asks, up to two years", async () => {
    const friday = (await boot()).series[0];
    expect(ahead(await boot())).toHaveLength(12);
    expect((await call("POST", `/api/series/${friday.id}/more`)).status).toBe(200);
    const more = ahead(await boot());
    expect(more).toHaveLength(24);
    expect(more.at(-1).heldOn).toBe("2027-03-19");
    for (let i = 0; i < 12; i++) await call("POST", `/api/series/${friday.id}/more`);
    expect(ahead(await boot()).at(-1).heldOn <= "2028-10-05").toBe(true);
  });

  it("refuses a training with no days, saying why", async () => {
    const friday = (await boot()).series[0];
    expect(await call("PUT", `/api/series/${friday.id}`, { ...friday, weekdays: [] })).toEqual({
      status: 400,
      body: { error: "weekdays should list at least one day." },
    });
  });
});

describe("members and roles", () => {
  it("an admin changes a player's position, rating and roles", async () => {
    const reg = (await boot()).members.find((m: { name: string }) => m.name === "Reg Player");
    const res = await call("PUT", `/api/members/${reg.id}`, {
      ...reg,
      position: "G",
      rating: 70,
      roles: ["Member", "Session lead"],
    });
    expect(res.status).toBe(200);
    const after = (await boot()).members.find((m: { id: number }) => m.id === reg.id);
    expect(after).toMatchObject({ position: "G", rating: 70 });
    expect(after.roles.sort()).toEqual(["Member", "Session lead"]);
  });

  it("an admin adds a role with its actions; the Admin role itself can't be changed", async () => {
    const created = await call("POST", "/api/roles", { name: "Coach", description: "", actions: ["generate:Teams"] });
    expect(created.status).toBe(201);
    const roles = (await boot()).roles;
    expect(roles.find((r: { name: string }) => r.name === "Coach").actions).toEqual(["generate:Teams"]);
    const admin = roles.find((r: { name: string }) => r.name === "Admin");
    expect((await call("PUT", `/api/roles/${admin.id}`, { ...admin, actions: [] })).status).toBe(409);
  });
});

describe("who's in", () => {
  const people = async () => {
    const b = await boot();
    const byName = Object.fromEntries(b.members.map((m: { name: string; id: number }) => [m.name, m.id]));
    return { b, dana: byName["Dana Admin"], alt: byName["Alt Uploader"], reg: byName["Reg Player"] };
  };
  const friday = async () => ahead(await boot())[0];

  it("you say you're in for Friday, and it's still there when the app opens again", async () => {
    const { dana } = await people();
    const s = await friday();
    expect((await call("POST", `/api/sessions/${s.id}/answer`, { answer: "in" })).status).toBe(200);
    expect(await friday()).toMatchObject({ going: [dana], waitlist: [], out: [] });
  });

  it("saying out is an answer of its own, not the same as not answering", async () => {
    const { dana } = await people();
    const s = await friday();
    expect(s).toMatchObject({ going: [], out: [] });
    await call("POST", `/api/sessions/${s.id}/answer`, { answer: "out" });
    expect(await friday()).toMatchObject({ going: [], out: [dana] });
  });

  it("a full social puts the next one on the waitlist, who moves up when someone drops out", async () => {
    const { dana, alt } = await people();
    await call("POST", "/api/club-events", {
      title: "Curry night",
      startsAt: "2026-10-24T19:00:00.000Z",
      endsAt: "2026-10-24T22:00:00.000Z",
      venue: "",
      signup: true,
      capacity: 1,
    });
    const event = (await boot()).clubEvents[0];
    await call("POST", `/api/club-events/${event.id}/players`, { memberId: alt, in: true });
    await call("POST", `/api/club-events/${event.id}/answer`, { answer: "in" });
    expect((await boot()).clubEvents[0]).toMatchObject({ going: [alt], waitlist: [dana] });
    await call("POST", `/api/club-events/${event.id}/players`, { memberId: alt, in: false });
    expect((await boot()).clubEvents[0]).toMatchObject({ going: [dana], waitlist: [] });
  });

  it("an admin adds a player who texted instead, and takes one off", async () => {
    const { alt, reg } = await people();
    const s = await friday();
    await call("POST", `/api/sessions/${s.id}/players`, { memberId: alt, in: true });
    await call("POST", `/api/sessions/${s.id}/players`, { memberId: reg, in: true });
    await call("POST", `/api/sessions/${s.id}/players`, { memberId: alt, in: false });
    expect(await friday()).toMatchObject({ going: [reg] });
  });

  it("the register on the night: a no-show stays signed up, a walk-in joins, and a mistaken tick comes off", async () => {
    const { alt, reg } = await people();
    const s = await friday();
    await call("POST", `/api/sessions/${s.id}/players`, { memberId: reg, in: true });
    await call("POST", `/api/sessions/${s.id}/register`, { memberId: reg, here: false });
    await call("POST", `/api/sessions/${s.id}/register`, { memberId: alt, here: true });
    expect(await friday()).toMatchObject({ going: [reg, alt], walkIns: [alt], noShows: [reg] });
    await call("POST", `/api/sessions/${s.id}/register`, { memberId: alt, here: false });
    await call("POST", `/api/sessions/${s.id}/register`, { memberId: reg, here: true });
    expect(await friday()).toMatchObject({ going: [reg], walkIns: [], noShows: [] });
  });

  it("won't take a Kumite sign-up once it has closed, but saying out is still fine", async () => {
    const date = (await boot()).tournaments[0];
    await call("PUT", `/api/tournaments/${date.id}`, { ...date, status: "open", signupClosesOn: "2026-10-05" });
    expect((await call("POST", `/api/tournaments/${date.id}/answer`, { answer: "in" })).status).toBe(409);
    expect((await call("POST", `/api/tournaments/${date.id}/answer`, { answer: "out" })).status).toBe(200);
    // Closing on the day itself still takes it
    await call("PUT", `/api/tournaments/${date.id}`, { ...date, status: "open", signupClosesOn: "2026-10-06" });
    expect((await call("POST", `/api/tournaments/${date.id}/answer`, { answer: "in" })).status).toBe(200);
  });

  it("won't take sign-ups for a cancelled Friday", async () => {
    const s = await friday();
    await call("POST", `/api/sessions/${s.id}/cancelled`, { cancelled: true });
    expect(await call("POST", `/api/sessions/${s.id}/answer`, { answer: "in" })).toEqual({
      status: 409,
      body: { error: "That session's cancelled." },
    });
  });

  it("moving training to Thursdays keeps a Friday someone already said they're in for", async () => {
    const b = await boot();
    const first = ahead(b)[0];
    await call("POST", `/api/sessions/${first.id}/answer`, { answer: "in" });
    await call("PUT", `/api/series/${b.series[0].id}`, { ...b.series[0], weekdays: ["thu"] });
    const days = (await boot()).sessions.map((s: { heldOn: string }) => s.heldOn);
    expect(days).toContain(first.heldOn);
  });
});

describe("teams, quips, profiles and attendance", () => {
  const ids = async () => {
    const b = await boot();
    const byName = Object.fromEntries(b.members.map((m: { name: string; id: number }) => [m.name, m.id]));
    return { b, dana: byName["Dana Admin"], alt: byName["Alt Uploader"], reg: byName["Reg Player"] };
  };
  const friday = async () => ahead(await boot())[0];

  it("an admin publishes Friday's teams; everyone sees them, and someone dropping out stays on theirs until a team maker decides (ADR 0076)", async () => {
    const { dana, alt, reg } = await ids();
    const s = await friday();
    for (const m of [alt, reg]) await call("POST", `/api/sessions/${s.id}/players`, { memberId: m, in: true });
    await call("POST", `/api/sessions/${s.id}/answer`, { answer: "in" });
    const teams = [
      { name: "Cougars", players: [dana, alt] },
      { name: "White", players: [reg] },
    ];
    expect((await call("POST", `/api/sessions/${s.id}/teams`, { teams })).status).toBe(200);
    expect((await friday()).teams).toEqual(teams);
    await call("POST", `/api/sessions/${s.id}/answer`, { answer: "out" });
    // Out, but still on the team: the app flags the gap, and a team maker remakes the teams or keeps them as they are
    expect((await friday()).teams).toEqual(teams);
    const kept = [
      { name: "Cougars", players: [alt] },
      { name: "White", players: [reg] },
    ];
    expect((await call("POST", `/api/sessions/${s.id}/teams`, { teams: kept })).status).toBe(200);
    expect((await friday()).teams).toEqual(kept);
  });

  it("won't put someone on two teams", async () => {
    const { dana } = await ids();
    const s = await friday();
    const res = await call("POST", `/api/sessions/${s.id}/teams`, {
      teams: [
        { name: "Cougars", players: [dana] },
        { name: "White", players: [dana] },
      ],
    });
    expect(res).toEqual({ status: 400, body: { error: "Someone's on two teams." } });
  });

  it("Home's quips start with the club's lines; an admin adds, edits and removes them, keeping one of each", async () => {
    const quips = async () => (await boot()).quips as { id: number; kind: string; text: string }[];
    const late = (await quips()).filter((q) => q.kind === "late");
    expect(late.map((q) => q.text)).toContain("Go to bed, {name}");
    const added = await call("POST", "/api/quips", { kind: "late", text: "Lights out, {name}" });
    expect(added.status).toBe(201);
    await call("PUT", `/api/quips/${added.body.id}`, { text: "Lights out, {name}." });
    expect((await quips()).find((q) => q.id === added.body.id)?.text).toBe("Lights out, {name}.");
    for (const q of [...late, { id: added.body.id }].slice(0, -1)) await call("DELETE", `/api/quips/${q.id}`);
    expect(await call("DELETE", `/api/quips/${added.body.id}`)).toEqual({
      status: 409,
      body: { error: "Keep at least one." },
    });
  });

  it("you write your bio and phone; others see the bio but not the phone", async () => {
    const { dana } = await ids();
    await call("PUT", "/api/me", { position: "G", phone: "07700 900123", bio: "Blames the wheels." });
    const me = (await boot()).members.find((m: { id: number }) => m.id === dana);
    expect(me).toMatchObject({ position: "G", phone: "07700 900123", bio: "Blames the wheels." });
  });

  it("you choose how your name shows on the website, or go back to the default", async () => {
    const { dana } = await ids();
    const webName = async () => (await boot()).members.find((m: { id: number }) => m.id === dana).webName;
    expect(await webName()).toBeNull();
    await call("PUT", "/api/me", { position: "F", phone: "", bio: "", webName: "  The Wall " });
    expect(await webName()).toBe("The Wall");
    await call("PUT", "/api/me", { position: "F", phone: "", bio: "", webName: "" });
    expect(await webName()).toBeNull();
  });

  it("an admin makes someone a Quarterly Member, and can take it back", async () => {
    const { reg } = await ids();
    const quarterly = async () => (await boot()).members.find((m: { id: number }) => m.id === reg).quarterly;
    expect(await quarterly()).toBe(false);
    await call("POST", `/api/members/${reg}/quarterly`, { quarterly: true });
    expect(await quarterly()).toBe(true);
    await call("POST", `/api/members/${reg}/quarterly`, { quarterly: false });
    expect(await quarterly()).toBe(false);
  });

  it("counts the Fridays someone played, and an admin sees their attendance", async () => {
    const { alt, reg } = await ids();
    const s = await friday();
    await call("POST", `/api/sessions/${s.id}/players`, { memberId: reg, in: true });
    await call("POST", `/api/sessions/${s.id}/register`, { memberId: alt, here: true });
    await call("POST", `/api/sessions/${s.id}/register`, { memberId: reg, here: false });
    // The Saturday after
    const later = new Date("2026-10-10T11:00:00Z");
    const b = (await call("GET", "/api/bootstrap", undefined, env, later)).body;
    const played = (id: number) => b.members.find((m: { id: number }) => m.id === id).played;
    expect([played(alt), played(reg)]).toEqual([1, 0]);
    const history = (await call("GET", `/api/members/${reg}/attendance`, undefined, env, later)).body;
    expect(history[0]).toMatchObject({
      heldOn: "2026-10-09",
      series: "Friday Training",
      signup: "in",
      attended: false,
    });
    // Every Friday of the year so far is there, answered or not
    expect(history.at(-1)).toMatchObject({ heldOn: "2026-01-02", signup: null, attended: null });
  });

  it("an admin can't change who came to a Friday back in March: its register closed the morning after (#11)", async () => {
    const { reg } = await ids();
    const history = async () => (await call("GET", `/api/members/${reg}/attendance`)).body;
    const march = (await history()).find((r: { heldOn: string }) => r.heldOn === "2026-03-13");
    const res = await call("POST", `/api/sessions/${march.sessionId}/register`, { memberId: reg, here: true });
    expect(res).toEqual({ status: 409, body: { error: "The register's closed: it closed at 6am the morning after." } });
    const played = async () => (await boot()).members.find((m: { id: number }) => m.id === reg).played;
    expect(await played()).toBe(0);
    expect((await history()).find((r: { heldOn: string }) => r.heldOn === "2026-03-13")).toMatchObject({
      signup: null,
      attended: null,
    });
  });
});

describe("is it up", () => {
  it("says it's up only when it can read the club's database, so a deploy with a broken binding fails its check", async () => {
    expect(await call("GET", "/api/health")).toEqual({ status: 200, body: { ok: true } });
    const broken = { ...env, DB: { prepare: () => ({ first: () => Promise.reject(new Error("no such binding")) }) } };
    expect((await call("GET", "/api/health", undefined, broken as unknown as Env)).status).toBe(503);
  });
});

describe("access", () => {
  it("every route declares an action from the catalog", () => {
    for (const r of ROUTES) expect(r.action === "authenticated" || r.action in ACTIONS).toBe(true);
  });
});
