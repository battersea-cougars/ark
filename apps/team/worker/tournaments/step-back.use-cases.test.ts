// An admin steps a tournament back one step of its workflow (ADR 0074, 0060), whatever step it's at: the stages its
// front page shows (sign-up, the draft, the teams, the fight card, the day) and the draft's own (the order drawn, the
// draft open). Each step back undoes the step before it and no more, says which step it's leaving (`from`), so a tap
// on a page that's out of date is refused, and is one batch. Driven through the real Worker handlers in the fake
// world, each person signed in as themselves (ADR 0031).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seeds } from "@cougars/shared/testing/d1-sqlite";
import { testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  // Given a role that runs the draft and nothing more
  { name: "Rae Runner", position: "F", rating: 50, email: "rae@example.com" },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  ...["Reg", "Mo", "Ash", "Bo"].map((n, i) => ({
    name: `${n} Player`,
    position: i % 2 ? "D" : "F",
    rating: 55,
    email: `${n.toLowerCase()}@example.com`,
  })),
];
/** Draft night, 8 December: sign-up closed on the 5th. */
const DRAFT_DAY = new Date("2026-12-08T19:30:00Z");
const at = { now: DRAFT_DAY };

let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});
type Phone = Awaited<ReturnType<typeof w.signedIn>>;

/** A captains' draft with Cara and Cole, Reg, Mo, Ash and Bo signed up, sign-up closed: not yet drawn. */
async function kumite() {
  w.luck(1);
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body as Json;
  const idOf = (name: string) => boot.members.find((m: Json) => m.name === name).id as number;
  const made = await dana.call("POST", "/api/tournaments", {
    name: "Kumite Summer 2027",
    heldOn: "2026-12-12",
    startTime: "11:00",
    endTime: "16:00",
    status: "open",
    feePence: 0,
    kind: "draft",
    signupClosesOn: "2026-12-05",
    draftOn: "2026-12-08",
    teams: ["Cara Captain", "Cole Captain"].map((n) => ({ name: "", captainMemberId: idOf(n) })),
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  for (const n of ["reg", "mo", "ash", "bo"])
    expect(
      (await (await w.signedIn(`${n}@example.com`)).call("POST", `/api/tournaments/${id}/answer`, { answer: "in" }))
        .status,
    ).toBe(200);
  const cara = await w.signedIn("cara@example.com");
  const cole = await w.signedIn("cole@example.com");
  const draft = (what: string, body: object = {}) =>
    dana.call("POST", `/api/tournaments/${id}/draft/${what}`, body, at);
  const back = (from: string, as: Phone = dana) => as.call("POST", `/api/tournaments/${id}/step-back`, { from }, at);
  const tournament = async () =>
    ((await dana.call("GET", "/api/bootstrap", undefined, at)).body as Json).tournaments.find((x: Json) => x.id === id);
  const players = ["Reg", "Mo", "Ash", "Bo"].map((n) => idOf(`${n} Player`));
  /** Everyone picked, in snake order from whoever drew first. */
  async function pickAll() {
    const t = await tournament();
    const order = t.teams.map((x: Json) => (x.captainMemberId === idOf("Cara Captain") ? cara : cole));
    for (const [k, m] of players.entries())
      expect(
        (await order[[0, 1, 1, 0][k]].call("POST", `/api/tournaments/${id}/draft/picks`, { memberId: m }, at)).status,
      ).toBe(200);
  }
  /** What's left in the database: picks, the order, games, results, goals. */
  const left = () =>
    w.db.raw
      .prepare(
        `SELECT (SELECT COUNT(*) FROM tournament_team_players p JOIN tournament_teams t ON t.id = p.team_id
                 WHERE t.tournament_id = ?) picks,
                (SELECT COUNT(pick) FROM tournament_teams WHERE tournament_id = ?) drawn,
                (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = ?) games,
                (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = ? AND status <> 'next') played,
                (SELECT COUNT(*) FROM tournament_goals WHERE game_id IN
                   (SELECT id FROM tournament_games WHERE tournament_id = ?)) goals,
                (SELECT draft_state FROM tournaments WHERE id = ?) draft`,
      )
      .get(id, id, id, id, id, id) as Json;
  return { dana, cara, cole, id, idOf, draft, back, tournament, pickAll, left, players };
}

/** Each step of the night, done in order up to `upTo`. */
async function at_(upTo: "start" | "drawn" | "open" | "picked" | "closed" | "fixtures" | "played") {
  const k = await kumite();
  const steps = ["drawn", "open", "picked", "closed", "fixtures", "played"];
  const upToStep = steps.indexOf(upTo);
  if (upToStep >= 0) expect((await k.draft("draw")).status).toBe(200);
  if (upToStep >= 1) expect((await k.draft("open")).status).toBe(200);
  if (upToStep >= 2) await k.pickAll();
  if (upToStep >= 3) expect((await k.draft("close")).status).toBe(200);
  if (upToStep >= 4) expect((await k.dana.call("POST", `/api/tournaments/${k.id}/fixtures`)).status).toBe(200);
  if (upToStep >= 5) {
    const game = (await k.tournament()).games[0];
    expect(
      (await k.dana.call("PUT", `/api/tournaments/${k.id}/games/${game.id}`, { homeGoals: 2, awayGoals: 1 })).status,
    ).toBe(200);
  }
  return k;
}

describe("an admin steps the Kumite back one step, at every step", () => {
  it("a match played: back to the fight card not started, results, goals and all gone; the matches stay", async () => {
    const k = await at_("played");
    expect((await k.back("results")).status).toBe(200);
    expect(k.left()).toMatchObject({ games: 1, played: 0, goals: 0, draft: "closed", picks: 4 });
    const g = (await k.tournament()).games[0];
    expect([g.homeGoals, g.awayGoals, g.status, g.keeperId, g.clockLeftMs]).toEqual([null, null, "next", null, null]);
  });

  it("the fight card out, nothing played: back to the teams, the fixtures gone, the draft still closed", async () => {
    const k = await at_("fixtures");
    expect((await k.back("fixtures")).status).toBe(200);
    expect(k.left()).toMatchObject({ games: 0, draft: "closed", picks: 4 });
  });

  it("the teams set: back to the draft, open again with every pick kept", async () => {
    const k = await at_("closed");
    expect((await k.back("teams")).status).toBe(200);
    expect(k.left()).toMatchObject({ draft: "open", picks: 4, drawn: 2 });
  });

  it("the draft open: back to the order drawn, the picks so far off, the order kept", async () => {
    const k = await at_("picked");
    expect((await k.back("draft")).status).toBe(200);
    expect(k.left()).toMatchObject({ draft: "none", picks: 0, drawn: 2 });
    expect((await k.tournament()).draftState).toBe("scheduled");
  });

  it("the order drawn: back to before the draw, nobody told; the next draw is a new one", async () => {
    const k = await at_("drawn");
    await k.cara.call("PUT", "/api/auth/device", { token: "cara-phone", platform: "ios" });
    expect((await k.back("order")).status).toBe(200);
    expect(k.left()).toMatchObject({ draft: "none", drawn: 0 });
    expect(w.pushes).toEqual([]);
    expect((await k.draft("draw")).status).toBe(200);
    expect(k.left()).toMatchObject({ drawn: 2 });
  });

  it("sign-up closed, nothing drawn: back to sign-up open, and a member can say they're in again", async () => {
    const k = await at_("start");
    expect((await k.tournament()).signupClosesOn).toBe("2026-12-05");
    expect((await k.back("signup")).status).toBe(200);
    const t = await k.tournament();
    expect([t.status, t.signupClosesOn]).toEqual(["open", null]);
    const reg = await w.signedIn("reg@example.com");
    expect((await reg.call("POST", `/api/tournaments/${k.id}/answer`, { answer: "out" }, at)).status).toBe(200);
    expect((await reg.call("POST", `/api/tournaments/${k.id}/answer`, { answer: "in" }, at)).status).toBe(200);
  });

  it("step by step from a match played all the way back to sign-up, one step each time", async () => {
    const k = await at_("played");
    for (const from of ["results", "fixtures", "teams", "draft", "order", "signup"])
      expect([from, (await k.back(from)).status]).toEqual([from, 200]);
    // Sign-up open with nothing before it: nothing to step back to
    const res = await k.back("signup");
    expect([res.status, res.body.error]).toEqual([409, "There's no step before this one."]);
  });
});

describe("a step back says which step it's leaving", () => {
  it("a page that's out of date is refused, and nothing changes", async () => {
    const k = await at_("picked");
    const res = await k.back("order");
    expect([res.status, res.body.error]).toEqual([409, "It's moved on since: have another look."]);
    expect(k.left()).toMatchObject({ draft: "open", picks: 4 });
    expect((await k.back("sideways")).status).toBe(400);
  });

  it.each(seeds(5))("two taps at once step back once, not twice (seed %i)", async (seed) => {
    const k = await at_("played");
    w.db.interleave(seed);
    const replies = await Promise.all([k.back("results"), k.back("results")]);
    w.db.interleave(null);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(k.left()).toMatchObject({ games: 1, played: 0, draft: "closed" });
  });

  it("it's on the record, with what there was before and after", async () => {
    const k = await at_("played");
    expect((await k.back("results")).status).toBe(200);
    const entry = w.db.raw
      .prepare("SELECT detail FROM audit_log WHERE action = 'tournament.stepped_back' ORDER BY id DESC LIMIT 1")
      .get() as { detail: string };
    const { from, to } = JSON.parse(entry.detail);
    expect(from).toMatchObject({ step: "results", results: 1, goals: 3 });
    expect(to).toMatchObject({ step: "fixtures", results: 0, goals: 0 });
  });
});

describe("captains hear only of a draft that was open", () => {
  it("stepping an open draft back tells each captain it's paused; opening it again tells them it's open", async () => {
    const k = await at_("open");
    await k.cara.call("PUT", "/api/auth/device", { token: "cara-phone", platform: "ios" });
    await k.cole.call("PUT", "/api/auth/device", { token: "cole-phone", platform: "ios" });
    expect((await k.back("draft")).status).toBe(200);
    expect(
      w.pushes.map(({ token, title, body }) => ({ token, title, body })).sort((a, b) => a.token.localeCompare(b.token)),
    ).toEqual([
      {
        token: "cara-phone",
        title: "Kumite Summer 2027 Draft Paused",
        body: "Back to the drawn order. You'll hear when it opens again.",
      },
      {
        token: "cole-phone",
        title: "Kumite Summer 2027 Draft Paused",
        body: "Back to the drawn order. You'll hear when it opens again.",
      },
    ]);
    w.pushes.length = 0;
    expect((await k.draft("open")).status).toBe(200);
    expect(w.pushes.map((p) => p.title)).toEqual(["Kumite Summer 2027 Draft Open", "Kumite Summer 2027 Draft Open"]);
  });

  it("no other step back is sent to anyone", async () => {
    const k = await at_("played");
    await k.cara.call("PUT", "/api/auth/device", { token: "cara-phone", platform: "ios" });
    for (const from of ["results", "fixtures", "teams"]) expect((await k.back(from)).status).toBe(200);
    expect(w.pushes).toEqual([]);
  });
});

describe("who steps back", () => {
  it("someone who runs the draft steps the draft back, not the fixtures; a member or captain can't at all", async () => {
    const k = await at_("fixtures");
    const role = await k.dana.call("POST", "/api/roles", {
      name: "Draft runner",
      description: "",
      actions: ["run:Draft"],
    });
    expect(role.status).toBe(201);
    const rae = ((await k.dana.call("GET", "/api/bootstrap")).body as Json).members.find(
      (m: Json) => m.name === "Rae Runner",
    );
    expect(
      (await k.dana.call("PUT", `/api/members/${rae.id}`, { ...rae, roles: ["Draft runner", "Member"] })).status,
    ).toBe(200);
    const raePhone = await w.signedIn("rae@example.com");
    expect((await k.back("fixtures", raePhone)).status).toBe(403);
    expect((await k.back("fixtures", k.cara)).status).toBe(403);
    expect((await k.back("fixtures")).status).toBe(200);
    expect((await k.back("teams", raePhone)).status).toBe(200);
    expect((await k.back("draft", raePhone)).status).toBe(200);
  });
});

describe("teams that enter have no draft to step through", () => {
  it("the fight card back to the teams, then the teams back to sign-up open", async () => {
    const dana = await w.signedIn("dana@example.com");
    const made = await dana.call("POST", "/api/tournaments", {
      name: "Summer Cup",
      heldOn: "2026-12-12",
      startTime: "11:00",
      endTime: "16:00",
      status: "open",
      feePence: 0,
      kind: "teams",
      signupClosesOn: "2026-12-05",
      teams: ["Ants", "Bees"].map((name) => ({ name, logo: null, captainMemberId: null, players: [] })),
    });
    expect(made.status).toBe(201);
    const id = made.body.id as number;
    const back = (from: string) => dana.call("POST", `/api/tournaments/${id}/step-back`, { from }, at);
    expect((await dana.call("POST", `/api/tournaments/${id}/fixtures`)).status).toBe(200);
    expect((await back("teams")).status).toBe(409);
    expect((await back("fixtures")).status).toBe(200);
    expect((await back("signup")).status).toBe(200);
    // The teams stay: they entered
    const t = ((await dana.call("GET", "/api/bootstrap", undefined, at)).body as Json).tournaments.find(
      (x: Json) => x.id === id,
    );
    expect([t.status, t.signupClosesOn, t.teams.length]).toEqual(["open", null, 2]);
    expect((await back("signup")).status).toBe(409);
  });
});
