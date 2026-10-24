// A series' editions, read when they're wanted (#175, ADR 0074): opening the app sends each series' one on or coming
// up and its last one played, never every one there's been. A past one's page reads it in full, as the club read
// would have sent it; History reads them a page at a time, newest first, each a line (its day, who won it, the final);
// a team's logo is an address of its own, kept by the browser, not a copy in every reply. Driven through the real
// Worker handlers in the fake world (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, testWorld } from "../testing";
import { meetings } from "../../src/lib/matchups";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...["Ash", "Bo", "Cy", "Di", "Ed", "Flo"].map((name) => ({
    name: `${name} Player`,
    position: "F",
    rating: 50,
    email: `${name.toLowerCase()}@example.com`,
  })),
];
/** The seeded series, and its next one, next summer (testing.ts FIRST_KUMITE_SQL). */
const KUMITE = 1;
const NEXT = 1;

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
const memberIds = () =>
  (w.db.raw.prepare("SELECT id FROM members ORDER BY id").all() as { id: number }[]).map((m) => m.id);
/** A crest as the browser shrinks one (lib/logo.ts): a few KB, so it has its own address. */
const LOGO = `data:image/webp;base64,${Buffer.alloc(3000, "a crest").toString("base64")}`;
/** A generated crest, a few hundred bytes: sent as itself (#177). */
const SMALL = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64")}`;

/**
 * Past Kumites played on these days, each of two drafted teams (the first with a logo, captained by Ash) and a final
 * the first won 3–1, its champions named; their ids, in the order given.
 */
function played(...days: string[]) {
  const db = w.db.raw;
  const [, ash, bo] = memberIds();
  return days.map((day, n) => {
    const t = Number(
      db
        .prepare(
          `INSERT INTO tournaments (type_id, name, held_on, start_time, end_time, status, kind, draft_state)
           VALUES (?, ?, ?, '11:00', '16:00', 'finished', 'draft', 'closed')`,
        )
        .run(KUMITE, `Kumite ${n + 1}`, day).lastInsertRowid,
    );
    const team = db.prepare(
      `INSERT INTO tournament_teams (tournament_id, name, logo, captain_member_id, pick, contact, created_at)
       VALUES (?, ?, ?, ?, ?, 'call me', ?)`,
    );
    const home = Number(team.run(t, "Shidoshi", LOGO, ash, 1, NOW.toISOString()).lastInsertRowid);
    const away = Number(team.run(t, "Dux", null, bo, 2, NOW.toISOString()).lastInsertRowid);
    db.prepare(
      "INSERT INTO tournament_team_players (team_id, member_id, position, pick_number, picked_by) VALUES (?, ?, 0, 1, ?)",
    ).run(home, memberIds()[3], ash);
    const game = Number(
      db
        .prepare(
          `INSERT INTO tournament_games (tournament_id, stage, round, position, name, home_team_id, away_team_id,
             home_goals, away_goals, status, period, started_at) VALUES (?, 'playoff', 1, 1, 'Final', ?, ?, 3, 1, 'done', 2, ?)`,
        )
        .run(t, home, away, `${day}T12:00:00.000Z`).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO tournament_goals (game_id, team_id, scorer_member_id, assist_member_id, at_ms, period, created_at)
       VALUES (?, ?, ?, NULL, 60000, 1, ?)`,
    ).run(game, home, ash, NOW.toISOString());
    db.prepare(
      "INSERT INTO tournament_award_winners (tournament_id, award, team_id, member_id, position) VALUES (?, 'Champions', ?, NULL, 0)",
    ).run(t, home);
    return t;
  });
}

const opened = async (email = "dana@example.com") => {
  const b = await w.signedIn(email);
  return { b, boot: (await b.call("GET", "/api/bootstrap")).body as Json };
};

describe("opening the app", () => {
  it("sends each series' next one and its last one played, not the ones before", async () => {
    const [, , , last] = played("2025-01-14", "2025-04-14", "2025-07-14", "2025-10-14");
    const { boot } = await opened();
    expect(boot.tournaments.map((t: Json) => t.id).sort()).toEqual([NEXT, last].sort());
  });

  it("with none played, sends only the one coming up", async () => {
    const { boot } = await opened();
    expect(boot.tournaments.map((t: Json) => t.id)).toEqual([NEXT]);
  });

  it("sends a team's logo as an address of its own, not the image", async () => {
    const [last] = played("2025-10-14");
    const { boot } = await opened();
    const team = boot.tournaments.find((t: Json) => t.id === last).teams[0];
    expect(team.logo).toMatch(new RegExp(`^/api/tournament-teams/${team.id}/logo\\?v=\\w+$`));
    expect(JSON.stringify(boot)).not.toContain("base64");
  });
});

describe("a past one's page", () => {
  it("reads it in full, as the club read sends the last one", async () => {
    const [older, last] = played("2025-04-14", "2025-10-14");
    const { b, boot } = await opened();
    const one = await b.call("GET", `/api/tournaments/${last}`);
    expect(one.status).toBe(200);
    expect(one.body.tournament).toEqual(boot.tournaments.find((t: Json) => t.id === last));
    const past = (await b.call("GET", `/api/tournaments/${older}`)).body.tournament;
    expect(past).toMatchObject({ id: older, name: "Kumite 1", status: "finished" });
    expect(past.games[0]).toMatchObject({ homeGoals: 3, awayGoals: 1, status: "done" });
    expect(past.games[0].goals).toHaveLength(1);
    expect(past.winners).toEqual([expect.objectContaining({ award: "Champions" })]);
  });

  it("is read by one of its games or teams too, for a link to a past one's matchup or team", async () => {
    const [older] = played("2025-04-14", "2025-10-14");
    const { b } = await opened();
    const t = (await b.call("GET", `/api/tournaments/${older}`)).body.tournament;
    expect((await b.call("GET", `/api/tournament-games/${t.games[0].id}/tournament`)).body.tournament).toEqual(t);
    expect((await b.call("GET", `/api/tournament-teams/${t.teams[1].id}/tournament`)).body.tournament).toEqual(t);
  });

  it("is a 404 for one that isn't there", async () => {
    const { b } = await opened();
    expect((await b.call("GET", "/api/tournaments/999")).status).toBe(404);
    expect((await b.call("GET", "/api/tournament-games/999/tournament")).status).toBe(404);
  });

  it("is seen by a member as the club read shows them: no team's contact, a closed draft's picks unnumbered", async () => {
    const [older] = played("2025-04-14", "2025-10-14");
    const admin = (await (await opened()).b.call("GET", `/api/tournaments/${older}`)).body.tournament;
    expect(admin.teams[0].contact).toBe("call me");
    expect(admin.teams[0].players[0].pick).toBe(1);
    const member = (await (await opened("ed@example.com")).b.call("GET", `/api/tournaments/${older}`)).body.tournament;
    expect(member.teams[0].contact).toBe("");
    expect(member.teams[0].players[0].pick).toBeNull();
  });

  it("is seen by an admin viewing as a member as that member sees it", async () => {
    const [older] = played("2025-04-14", "2025-10-14");
    const { b } = await opened();
    expect((await b.call("PUT", "/api/me/view-as", { memberId: memberIds()[5] })).status).toBe(200);
    const viewing = (await b.call("GET", `/api/tournaments/${older}`)).body.tournament;
    expect(viewing.teams[0].contact).toBe("");
    expect(viewing.teams[0].players[0].pick).toBeNull();
  });

  it("asked again with its tag is an empty 304 until something changes", async () => {
    const [older] = played("2025-04-14", "2025-10-14");
    const { b } = await opened();
    const first = await b.call("GET", `/api/tournaments/${older}`);
    const tag = first.headers.get("etag")!;
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    const again = await b.call("GET", `/api/tournaments/${older}`, undefined, { headers: { "if-none-match": tag } });
    expect(again.status).toBe(304);
    const t = first.body.tournament;
    expect(
      (await b.call("PUT", `/api/tournaments/${older}/games/${t.games[0].id}`, { homeGoals: 4, awayGoals: 1 })).status,
    ).toBe(200);
    const changed = await b.call("GET", `/api/tournaments/${older}`, undefined, { headers: { "if-none-match": tag } });
    expect(changed.status).toBe(200);
    expect(changed.body.tournament.games[0].homeGoals).toBe(4);
  });
});

describe("History, a page at a time", () => {
  const page = async (b: Json, query = "") =>
    (await b.call("GET", `/api/tournament-types/${KUMITE}/editions${query}`)).body;

  it("lists the ones played, newest first, each with its day, its champions and the final", async () => {
    const [older, last] = played("2025-04-14", "2025-10-14");
    const { b } = await opened("ed@example.com");
    const { editions, next } = await page(b);
    expect(editions.map((e: Json) => e.id)).toEqual([last, older]);
    expect(next).toBeNull();
    const [team] = (await b.call("GET", `/api/tournaments/${last}`)).body.tournament.teams;
    expect(editions[0]).toMatchObject({
      id: last,
      typeId: KUMITE,
      name: "Kumite 2",
      heldOn: "2025-10-14",
      champion: team.id,
      final: { homeTeamId: team.id, homeGoals: 3, awayGoals: 1 },
      games: 1,
    });
    expect(editions[0].teams[0]).toEqual({
      id: team.id,
      name: "Shidoshi",
      logo: team.logo,
      captainMemberId: team.captainMemberId,
    });
  });

  it("is empty with none played", async () => {
    const { b } = await opened();
    expect(await page(b)).toEqual({ editions: [], next: null });
  });

  it("with exactly a page of them, says there's no more", async () => {
    played("2025-01-14", "2025-04-14", "2025-07-14");
    const { b } = await opened();
    const first = await page(b, "?limit=3");
    expect(first.editions).toHaveLength(3);
    expect(first.next).toBeNull();
  });

  it("with one more than a page, the next page has it", async () => {
    const ids = played("2025-01-14", "2025-04-14", "2025-07-14", "2025-10-14");
    const { b } = await opened();
    const first = await page(b, "?limit=3");
    expect(first.editions.map((e: Json) => e.id)).toEqual([ids[3], ids[2], ids[1]]);
    const second = await page(b, `?limit=3&before=${first.next}`);
    expect(second.editions.map((e: Json) => e.id)).toEqual([ids[0]]);
    expect(second.next).toBeNull();
  });

  it("several on one day are split across pages with none twice and none missed", async () => {
    const ids = played("2025-07-14", "2025-07-14", "2025-07-14", "2025-04-14");
    const { b } = await opened();
    const seen: number[] = [];
    let next: string | null = "";
    while (next !== null) {
      const p: Json = await page(b, `?limit=2${next ? `&before=${next}` : ""}`);
      seen.push(...p.editions.map((e: Json) => e.id));
      next = p.next;
    }
    expect(seen).toEqual([ids[2], ids[1], ids[0], ids[3]]);
  });

  it("leaves out the one coming up, and refuses a page it can't read", async () => {
    played("2025-04-14");
    const { b } = await opened();
    expect((await page(b)).editions.map((e: Json) => e.id)).not.toContain(NEXT);
    expect((await b.call("GET", `/api/tournament-types/${KUMITE}/editions?limit=0`)).status).toBe(400);
    expect((await b.call("GET", `/api/tournament-types/${KUMITE}/editions?before=yesterday`)).status).toBe(400);
  });

  it("every series' at once, for Settings → Tournaments", async () => {
    const ids = played("2025-04-14", "2025-10-14");
    const { b } = await opened();
    const all = (await b.call("GET", "/api/tournaments/editions")).body;
    expect(all.editions.map((e: Json) => e.id)).toEqual([ids[1], ids[0]]);
  });

  it("asked again with its tag is an empty 304 until something changes", async () => {
    played("2025-04-14");
    const { b } = await opened();
    const first = await b.call("GET", `/api/tournament-types/${KUMITE}/editions`);
    const again = await b.call("GET", `/api/tournament-types/${KUMITE}/editions`, undefined, {
      headers: { "if-none-match": first.headers.get("etag")! },
    });
    expect(again.status).toBe(304);
  });

  it("all-time leaders count every one played", async () => {
    played("2025-04-14", "2025-10-14");
    const [, ash] = memberIds();
    const { b } = await opened("ed@example.com");
    const { leaders } = (await b.call("GET", `/api/tournament-types/${KUMITE}/leaders`)).body;
    expect(leaders).toEqual([{ memberId: ash, goals: 2, assists: 0, points: 2, pim: 0 }]);
  });
});

describe("a team's logo", () => {
  it("is its image at its own address, kept by the browser for good", async () => {
    const [last] = played("2025-10-14");
    const { b, boot } = await opened("ed@example.com");
    const team = boot.tournaments.find((t: Json) => t.id === last).teams[0];
    const res = await b.open("GET", team.logo);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(Buffer.alloc(3000, "a crest").toString());
    const again = await b.open("GET", team.logo, { headers: { "if-none-match": res.headers.get("etag")! } });
    expect(again.status).toBe(304);
  });

  it("is a 404 for a team with none", async () => {
    const [last] = played("2025-10-14");
    const { b, boot } = await opened();
    const team = boot.tournaments.find((t: Json) => t.id === last).teams[1];
    expect(team.logo).toBeNull();
    expect((await b.call("GET", `/api/tournament-teams/${team.id}/logo`)).status).toBe(404);
  });

  it("changed, has a new address; the team's look saved with its address keeps it", async () => {
    const [last] = played("2025-10-14");
    const { b, boot } = await opened();
    const team = boot.tournaments.find((t: Json) => t.id === last).teams[0];
    const look = (logo: string) =>
      b.call("PUT", `/api/tournaments/${last}/teams/${team.id}/look`, { name: "Shidoshi", logo });
    expect((await look(team.logo)).status).toBe(200);
    const kept = (await b.call("GET", `/api/tournaments/${last}`)).body.tournament.teams[0];
    expect(kept.logo).toBe(team.logo);
    const other = `data:image/png;base64,${Buffer.alloc(3000, "another crest").toString("base64")}`;
    expect((await look(other)).status).toBe(200);
    const changed = (await b.call("GET", `/api/tournaments/${last}`)).body.tournament.teams[0];
    expect(changed.logo).not.toBe(team.logo);
    expect(Buffer.from(await (await b.open("GET", changed.logo)).arrayBuffer()).toString()).toBe(
      Buffer.alloc(3000, "another crest").toString(),
    );
  });

  it("a small one (a generated crest) comes as itself, so twenty on a page of History aren't twenty requests (#177)", async () => {
    const [last, before] = played("2025-10-14", "2025-09-14");
    w.db.raw.prepare("UPDATE tournament_teams SET logo = ?").run(SMALL);
    w.db.raw.prepare("UPDATE data_version SET version = version + 1").run();
    const { b, boot } = await opened();
    const team = boot.tournaments.find((t: Json) => t.id === last).teams[0];
    expect(team.logo).toBe(SMALL);
    const page = (await b.call("GET", `/api/tournament-types/${KUMITE}/editions`)).body.editions as Json[];
    expect(page.find((e) => e.id === before).teams[0].logo).toBe(SMALL);
    // Sent back as it came (it isn't a kind anyone uploads), the team keeps it
    const look = await b.call("PUT", `/api/tournaments/${last}/teams/${team.id}/look`, {
      name: "Shidoshi",
      logo: SMALL,
    });
    expect(look.status).toBe(200);
    expect((await b.call("GET", `/api/tournaments/${last}`)).body.tournament.teams[0].logo).toBe(SMALL);
  });
});

// What looked through every edition the app held, before it held only a few (#177): each a small read of its own
describe("what the matchup, the editor and Venues read for themselves", () => {
  it("the matchup's when these captains last met: the past ones where both played, the newest first", async () => {
    const [first, second, third] = played("2025-01-14", "2025-02-14", "2025-03-14");
    const [, ash, bo] = memberIds();
    const final = (t: number) =>
      (w.db.raw.prepare("SELECT id FROM tournament_games WHERE tournament_id = ?").get(t) as { id: number }).id;
    const { b } = await opened("ash@example.com");
    const res = await b.call("GET", `/api/tournament-games/${final(third)}/meetings`);
    expect(res.status).toBe(200);
    expect(res.body.editions.map((e: Json) => e.id)).toEqual([second, first]);
    const met = meetings(res.body.editions, { id: third }, ash, bo);
    expect(met.map((m) => [m.tournament.id, m.for, m.against])).toEqual([
      [second, 3, 1],
      [first, 3, 1],
    ]);
  });

  it("the editor's Brings: the team each captain last captained in an earlier one of the series", async () => {
    const [first, second] = played("2025-01-14", "2025-02-14");
    const [, ash, bo] = memberIds();
    const { b } = await opened();
    const brings = async (query: string) =>
      (await b.call("GET", `/api/tournament-types/${KUMITE}/brings?${query}`)).body.brings as Json[];
    const next = await brings("heldOn=2026-07-01");
    expect(next).toEqual([
      { memberId: ash, name: "Shidoshi", logo: expect.stringMatching(/^\/api\/tournament-teams\/\d+\/logo\?v=/) },
      { memberId: bo, name: "Dux", logo: null },
    ]);
    expect(next[0].logo).toContain(`/tournament-teams/${teamOf(second, ash)}/`);
    // The second one's own editor: what they brought to it, from the first
    expect((await brings(`heldOn=2025-02-14&tournament=${second}`))[0].logo).toContain(
      `/tournament-teams/${teamOf(first, ash)}/`,
    );
    expect(await brings("heldOn=2025-01-01")).toEqual([]);
    expect((await b.call("GET", `/api/tournament-types/${KUMITE}/brings?heldOn=soon`)).status).toBe(400);
  });

  it("Venues' used by names every one held there, past ones too, each name once", async () => {
    const [first, second] = played("2025-01-14", "2025-02-14");
    const { b } = await opened();
    const venue = Number(
      w.db.raw.prepare("INSERT INTO venues (name, address, map_url, active) VALUES ('The Rink', '', '', 1)").run()
        .lastInsertRowid,
    );
    w.db.raw.prepare("UPDATE tournaments SET venue_id = ? WHERE id IN (?, ?)").run(venue, first, second);
    w.db.raw.prepare("UPDATE tournaments SET name = 'Kumite' WHERE id IN (?, ?)").run(first, second);
    w.db.raw.prepare("UPDATE data_version SET version = version + 1").run();
    const used = (await b.call("GET", "/api/venues/used")).body.used as Json[];
    expect(used.find((u) => u.venueId === venue)).toEqual({ venueId: venue, names: ["Kumite"] });
    const ash = await w.signedIn("ash@example.com");
    expect((await ash.call("GET", "/api/venues/used")).status).toBe(403);
  });
});

const teamOf = (tournament: number, captain: number) =>
  (
    w.db.raw
      .prepare("SELECT id FROM tournament_teams WHERE tournament_id = ? AND captain_member_id = ?")
      .get(tournament, captain) as { id: number }
  ).id;
