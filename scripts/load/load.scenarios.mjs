// The club's busy moments, as load runs (docs/load-testing.md). Each sets up through the API as the admin (not timed),
// then does what the members' phones would, timed into `stats`. Against a Worker of the run's own (load.server.mjs)
// or dev (load.dev.mjs): what each makes is named with the run's mark (load.club.mjs), kept off the website, and
// deleted through the API at the end where there's a route for it; the rest goes in the run's clean-up.
import { MARK } from "./load.club.mjs";
import { phone, phones, sleep } from "./load.client.mjs";

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
/** The team on the clock after `made` picks among `teams` (src/lib/draft.ts onTheClock, snake order). */
const onTheClock = (teams, made) => {
  const round = Math.floor(made / teams);
  const slot = made % teams;
  return round % 2 ? teams - 1 - slot : slot;
};
/** The admin's phone (its own address, or the shared one). */
const adminPhone = (target, roster, stats, shared, address = "10.9.9.9") =>
  phone(target, roster[0].email, stats, { address: target.remote ? undefined : shared ? "10.0.0.1" : address });
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * A training night of the run's own, made through the API as the admin: one session three days on, 40 skaters'
 * places and 2 keepers' (or `capacity`), free (or `pence` a night), off the website. The club's own Fridays are never
 * touched.
 */
async function loadNight(admin, club, { capacity = 40, pence = 0 } = {}) {
  const day = inDays(3);
  const like = club.series[0] ?? {};
  const { id: _id, slug: _slug, ...rest } = like;
  must(
    await admin.call("setup", "POST", "/api/series", {
      ...rest,
      name: `Load night ${MARK}`,
      shortName: "Load",
      icon: like.icon ?? "skate",
      tone: like.tone ?? "green",
      repeatEvery: 1,
      weekdays: [WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]],
      startsOn: day,
      endsOn: day,
      startTime: like.startTime ?? "19:00",
      endTime: like.endTime ?? "21:00",
      capacity,
      goalieCapacity: 2,
      public: false,
      active: true,
      fees: pence ? [{ pence, from: day }] : [],
    }),
    "training",
  );
  const after = await admin.boot("setup");
  const series = after.series.find((x) => x.name === `Load night ${MARK}`);
  return after.sessions.find((x) => x.seriesId === series.id);
}

/**
 * Friday sign-up opening: every member opens the app and taps In within 10 seconds, everyone on Home following the
 * sign-ups live; both crons run in the middle of it; then the team maker publishes the teams while they're all still
 * on the page.
 */
async function fridayRush({ target, roster, stats, shared, notes }) {
  const admin = await adminPhone(target, roster, stats, shared);
  const session = await loadNight(admin, await admin.boot("setup"));
  const everyone = await phones(
    target,
    roster.map((r) => r.email),
    stats,
    { shared },
  );
  const window = 10_000;
  const stops = [];
  const taps = everyone.map(async (p) => {
    await sleep(Math.random() * window);
    await p.boot("bootstrap: open the app");
    stops.push(p.follow(["sessions"]));
    await p.change("answer: in", "POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
  });
  // The crons, in the middle of it
  await sleep(window / 2);
  notes.push(`Crons in the middle of it: ${(await target.crons()).join(", ")}`);
  await Promise.all(taps);
  const night = (await admin.boot("setup")).sessions.find((s) => s.id === session.id);
  notes.push(`The night: ${night.going.length} in, ${night.waitlist.length} waiting (40 skaters' places, 2 keepers')`);
  // The teams, published while everyone's on the page
  await sleep(2000);
  const going = night.going;
  const teams = [0, 1].map((t) => ({ name: t ? "Whites" : "Darks", players: going.filter((_, i) => i % 2 === t) }));
  must(await admin.change("publish teams", "POST", `/api/sessions/${session.id}/teams`, { teams }), "teams");
  await sleep(5000);
  await Promise.all(stops.map((s) => s()));
}

/**
 * A Kumite draft: eight captains picking in turn, 60 players watching the draft room live, whoever runs it taking one
 * pick back and making one for a captain.
 */
async function liveDraft({ target, roster, stats, shared, notes }) {
  const admin = await adminPhone(target, roster, stats, shared);
  await admin.boot("setup");
  // The roster is the members' page's
  const club = await admin.page("setup", ["members"]);
  const idOf = new Map(club.members.map((m) => [m.name, m.id]));
  const type = must(
    await admin.call("setup", "POST", "/api/tournament-types", {
      name: `Load Cup ${MARK}`,
      shortName: "Load",
      icon: "trophy",
      tone: "green",
      kind: "draft",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      gameMinutes: 12,
      active: true,
      defaultFeePence: 0,
      defaultStartTime: "19:30",
      defaultEndTime: "21:30",
      awards: [],
      location: "Battersea Park",
    }),
    "series",
  );
  const captains = roster.slice(1, 9);
  const players = roster.slice(9, 69);
  const t = must(
    await admin.call("setup", "POST", "/api/tournaments", {
      typeId: type.id,
      name: `Load Cup 2026 ${MARK}`,
      public: false,
      location: "",
      heldOn: inDays(10),
      startTime: "11:00",
      endTime: "16:00",
      capacity: 100,
      status: "open",
      feePence: 0,
      signupClosesOn: inDays(5),
      draftOn: today(),
      teams: captains.map((c) => ({ name: "", logo: null, captainMemberId: idOf.get(c.name), players: [] })),
    }),
    "tournament",
  );
  const watching = await phones(
    target,
    players.map((r) => r.email),
    stats,
    { shared },
  );
  for (const p of watching)
    must(await p.call("setup", "POST", `/api/tournaments/${t.id}/answer`, { answer: "in" }), "in");
  must(await admin.call("setup", "POST", `/api/tournaments/${t.id}/draft/draw`, {}), "draw");
  must(await admin.call("setup", "POST", `/api/tournaments/${t.id}/draft/open`, {}), "open");
  const captainPhones = await phones(
    target,
    captains.map((r) => r.email),
    stats,
    { shared },
  );
  const goalies = new Set(club.members.filter((m) => m.position === "G").map((m) => m.id));
  let picks = 0;
  let lastPick = Date.now();
  let finished = false;
  /** The draft as a phone sees it: whose turn, and who's left. */
  const draftOf = (c) => {
    const x = c?.tournaments.find((y) => y.id === t.id);
    if (!x) return null;
    const teams = [...x.teams].sort((a, b) => (a.pick ?? 99) - (b.pick ?? 99));
    const taken = new Set(teams.flatMap((tm) => tm.players.map((p) => p.memberId)));
    const made = teams.reduce((n, tm) => n + tm.players.filter((p) => p.pick != null).length, 0);
    const pool = x.going.filter((m) => !taken.has(m) && !teams.some((tm) => tm.captainMemberId === m));
    return { teams, made, pool, team: teams[onTheClock(teams.length, made)] };
  };
  // Everyone watching: the stream, reloading on each pick
  // Opening the draft room: the core, then the Kumite's pages' parts, as the app reads them
  const opened = (p) =>
    p.boot("bootstrap: open the draft").then(() => p.page("page: the draft room", ["members", "lastPlayed"]));
  const stops = watching.map((p) => (opened(p), p.follow(["tournaments"])));
  // The captains: on each change, the one on the clock thinks a moment and picks
  const busy = new Set();
  const turn = async (cap) => {
    const d = draftOf(cap.club());
    if (!d || finished || busy.has(cap) || d.team.captainMemberId !== cap.memberId) return;
    if (!d.pool.length) return void (finished = true);
    busy.add(cap);
    await sleep(500 + Math.random() * 1000);
    const hasGoalie = d.team.players.some((p) => goalies.has(p.memberId)) || goalies.has(cap.memberId);
    const choices = d.pool.filter((m) => !(hasGoalie && goalies.has(m)));
    const memberId = choices[Math.floor(Math.random() * choices.length)] ?? d.pool[0];
    // Its reply brings the draft back, as the app's save puts it in place
    const r = await cap.change("pick", "POST", `/api/tournaments/${t.id}/draft/picks`, { memberId, turn: d.made });
    busy.delete(cap);
    // Refused (the turn moved on, or the one left is a second goalie): wait for the next change, not try again at once
    if (r.status !== 200) return;
    picks++;
    lastPick = Date.now();
    turn(cap);
  };
  for (const cap of captainPhones) {
    await cap.boot("bootstrap: open the draft");
    await cap.page("page: the draft room", ["members", "lastPlayed"]);
    stops.push(cap.follow(["tournaments"], () => turn(cap)));
    turn(cap);
  }
  // Whoever runs it: one Undo, and one pick for a captain
  const started = Date.now();
  let undone = false;
  let pickedFor = false;
  while (!finished && Date.now() - started < 240_000) {
    await sleep(1000);
    const d = draftOf(await admin.boot("bootstrap: whoever runs it"));
    // Everyone's picked, or nobody can be (the last left would be a team's second goalie)
    if (!d.pool.length || Date.now() - lastPick > 15_000) finished = true;
    if (!undone && d.made >= 20) {
      undone = true;
      notes.push(
        `Undo at pick ${d.made}: ${(await admin.change("undo", "DELETE", `/api/tournaments/${t.id}/draft/picks/last`)).status}`,
      );
    }
    if (!pickedFor && d.made >= 30 && d.pool.length) {
      pickedFor = true;
      const r = await admin.change("pick for a captain", "POST", `/api/tournaments/${t.id}/draft/picks`, {
        memberId: d.pool.find((m) => !goalies.has(m)) ?? d.pool[0],
        turn: d.made,
      });
      notes.push(`A pick for a captain: ${r.status}`);
    }
  }
  await sleep(3000);
  const d = draftOf(await admin.boot("setup"));
  notes.push(`Picks made: ${d.made} of ${players.length}; ${picks} by captains`);
  await Promise.all(stops.map((s) => s()));
  notes.push(
    `The draft's tournament deleted: ${(await admin.call("setup", "DELETE", `/api/tournaments/${t.id}`)).status}`,
  );
}

/**
 * A game scored live: one scorekeeper, `followers` members (80, at most the roster's less ten) following the game
 * page. Besides the run's totals, what each of the scorekeeper's changes cost once everyone's on the page: the
 * requests and D1 rows read a change, and how long until every phone shows it (from the tap to the game on its screen).
 */
async function scoring({ target, roster, stats, shared, followers = 80, notes, d1 }) {
  const admin = await adminPhone(target, roster, stats, shared);
  await admin.boot("setup");
  // The roster is the members' page's
  const club = await admin.page("setup", ["members"]);
  const idOf = new Map(club.members.map((m) => [m.name, m.id]));
  const captains = roster.slice(1, 4);
  const t = must(
    await admin.call("setup", "POST", "/api/tournaments", {
      name: `Load Scrimmage ${MARK}`,
      public: false,
      location: "Battersea Park",
      heldOn: today(),
      startTime: "10:00",
      endTime: "15:00",
      status: "planned",
      feePence: 0,
      kind: "teams",
      playoffs: [],
      periods: 2,
      teams: captains.map((c, i) => ({
        name: `Team ${i + 1}`,
        logo: null,
        captainMemberId: idOf.get(c.name),
        players: [],
      })),
    }),
    "tournament",
  );
  must(await admin.call("setup", "POST", `/api/tournaments/${t.id}/fixtures`), "fixtures");
  const x = (await admin.boot("setup")).tournaments.find((y) => y.id === t.id);
  const game = x.games[0];
  const keeperName = captains.find(
    (c) => idOf.get(c.name) === x.teams.find((tm) => tm.id === game.scoringTeamId).captainMemberId,
  );
  const keeper = await adminPhone(target, [keeperName], stats, shared, "10.9.9.8");
  const viewers = await phones(
    target,
    roster.slice(10, 10 + Math.min(followers, roster.length - 10)).map((r) => r.email),
    stats,
    { shared },
  );
  // The game as each phone shows it, each time it changes: when the phone first had each state
  const shown = (c) => JSON.stringify(c?.tournaments?.find((y) => y.id === t.id)?.games.find((y) => y.id === game.id));
  const seen = viewers.map(() => []);
  // Everyone opens the game page first: the changes' cost is counted from once they're all on it
  await Promise.all(
    viewers.map((p) =>
      p.boot("bootstrap: open the game").then(() => p.page("page: the game", ["members", "lastPlayed"])),
    ),
  );
  const stops = viewers.map((p, i) =>
    p.follow(["tournaments"], (c) => seen[i].push({ at: performance.now(), game: shown(c) })),
  );
  await sleep(2000);
  // From here, the scorekeeper's changes: their cost, and each one's state of the game and when it was sent
  const from = { rows: d1 ? (await d1()).rowsRead : null, requests: stats.rows.length };
  const sent = [];
  const path = `/api/tournaments/${t.id}/games/${game.id}`;
  const score = async (label, method, where, payload) => {
    const at = performance.now();
    const r = await keeper.change(label, method, where, payload);
    sent.push({ at, game: shown(r.body?.changed) });
    return r;
  };
  must(await score("claim the sheet", "POST", `${path}/scorer`, { action: "claim" }), "claim");
  must(await score("clock", "POST", `${path}/clock`, { action: "start" }), "start");
  const home = game.homeTeamId;
  const away = game.awayTeamId;
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    await score("goal", "POST", `${path}/goals`, { teamId: i % 3 ? home : away });
    if (i % 4 === 1)
      await score("penalty", "POST", `${path}/penalties`, {
        teamId: i % 2 ? away : home,
        infraction: "delay-of-game",
      });
    if (i === 5) {
      await score("clock", "POST", `${path}/clock`, { action: "period", period: 1 });
      await sleep(1000);
      await score("clock", "POST", `${path}/clock`, { action: "start" });
    }
    if (i === 8) await score("undo goal", "DELETE", `${path}/goals/last`);
  }
  await score("clock", "POST", `${path}/clock`, { action: "end" });
  await sleep(4000);
  const changes = sent.length;
  const during = stats.rows
    .slice(from.requests)
    // A stream opening is the page's, not a change's
    .filter(
      (r) => !r.label.startsWith("live: event") && !["live: change to screen", "live: connect"].includes(r.label),
    );
  const reads = during.filter((r) => r.label.startsWith("live: read")).length;
  const rows = d1 ? (await d1()).rowsRead - from.rows : null;
  notes.push(
    `Scoring, ${viewers.length} following: ${changes} changes; a change ${(during.length / changes).toFixed(1)} requests, ` +
      `${(reads / changes).toFixed(1)} reads on the phones` +
      (rows === null ? "" : `, ${Math.round(rows / changes)} D1 rows read`) +
      `; at most ${peakIn10s(stats, during)} requests in 10 s (the domain's rule: 150 an address)`,
  );
  notes.push(toEveryScreen(sent, seen));
  const g = (await admin.boot("setup")).tournaments.find((y) => y.id === t.id).games.find((y) => y.id === game.id);
  notes.push(`Full time: ${g.homeGoals}–${g.awayGoals}, ${g.status}`);
  await Promise.all(stops.map((s) => s()));
  notes.push(
    `The game's tournament deleted: ${(await admin.call("setup", "DELETE", `/api/tournaments/${t.id}`)).status}`,
  );
}

/**
 * The night's register: 40 signed up for a night at £8, `followers` phones (60 by default: the 40 and 20 more) with
 * the app open on it, following live; whoever takes the register marks each one here a second or two apart, and two
 * walk-ins. Each mark makes or takes away a charge and moves the night's sign-ups on every phone.
 */
async function register({ target, roster, stats, shared, notes, d1, followers = 60 }) {
  const admin = await adminPhone(target, roster, stats, shared);
  const session = await loadNight(admin, await admin.boot("setup"), { pence: 800 });
  const players = await phones(
    target,
    roster.slice(1, 41).map((r) => r.email),
    stats,
    { shared },
  );
  for (const p of players)
    must(await p.call("setup", "POST", `/api/sessions/${session.id}/answer`, { answer: "in" }), "in");
  const others = await phones(
    target,
    roster.slice(41, 61).map((r) => r.email),
    stats,
    { shared },
  );
  const watching = [...players, ...others].slice(0, Math.min(followers, 60));
  await Promise.all(watching.map((p) => p.boot("bootstrap: open the night")));
  const stops = watching.map((p) => p.follow(["sessions"]));
  await admin.boot("bootstrap: the register");
  await sleep(2000);
  const from = { rows: d1 ? (await d1()).rowsRead : null, requests: stats.rows.length };
  const marks = [...players.map((p) => p.memberId), ...others.slice(0, 2).map((p) => p.memberId)];
  for (const memberId of marks) {
    const r = await admin.change("register: here", "POST", `/api/sessions/${session.id}/register`, {
      memberId,
      here: true,
    });
    if (r.status !== 200) notes.push(`A mark refused: ${r.status} ${JSON.stringify(r.body)}`);
    await sleep(1000 + Math.random() * 1000);
  }
  await sleep(4000);
  const during = stats.rows.slice(from.requests);
  const reads = during.filter((r) => r.label.startsWith("live: read")).length;
  const rows = d1 ? (await d1()).rowsRead - from.rows : null;
  notes.push(
    `The register, ${watching.length} watching: ${marks.length} marks; a mark ${(during.filter((r) => !r.label.startsWith("live: event") && r.label !== "live: change to screen").length / marks.length).toFixed(1)} requests, ` +
      `${(reads / marks.length).toFixed(1)} reads on the phones` +
      (rows === null ? "" : `, ${Math.round(rows / marks.length)} D1 rows read`),
  );
  await Promise.all(stops.map((s) => s()));
}

/** The after-party's awards: the judges' call, a stat, a draw and the champions, revealed in this order. */
const AWARDS = [
  { name: "The Judges' Call", about: "", decidedBy: { kind: "live", options: ["Most Dramatic Fall"] } },
  { name: "Top scorer", about: "", decidedBy: { kind: "stat", stat: "goals" } },
  { name: "Dim Mak", about: "", decidedBy: { kind: "random" } },
  { name: "Champions", about: "", decidedBy: { kind: "stat", stat: "table" } },
];

/**
 * A Kumite of four teams of the run's members, made, played out (results typed in) and its awards confirmed, through
 * the API as the admin: the evening up to the reveal. Returns its id.
 */
async function playedKumite(admin, roster) {
  await admin.boot("setup");
  const club = await admin.page("setup", ["members"]);
  const idOf = new Map(club.members.map((m) => [m.name, m.id]));
  const captains = roster.slice(1, 5);
  const squads = [0, 1, 2, 3].map((t) => roster.slice(5 + t * 5, 10 + t * 5));
  const t = must(
    await admin.call("setup", "POST", "/api/tournaments", {
      name: `Load Kumite ${MARK}`,
      public: false,
      location: "Battersea Park",
      heldOn: today(),
      startTime: "10:00",
      endTime: "15:00",
      status: "planned",
      feePence: 0,
      kind: "teams",
      playoffs: [],
      awards: AWARDS,
      teams: captains.map((c, i) => ({
        name: `Team ${i + 1}`,
        logo: null,
        captainMemberId: idOf.get(c.name),
        players: squads[i].map((p) => ({ memberId: idOf.get(p.name) })),
      })),
    }),
    "tournament",
  );
  must(await admin.call("setup", "POST", `/api/tournaments/${t.id}/fixtures`), "fixtures");
  let x = (await admin.boot("setup")).tournaments.find((y) => y.id === t.id);
  for (const [i, g] of x.games.entries())
    must(
      await admin.call("setup", "PUT", `/api/tournaments/${t.id}/games/${g.id}`, {
        homeGoals: 2 + (i % 3),
        awayGoals: 1,
      }),
      "result",
    );
  x = (await admin.boot("setup")).tournaments.find((y) => y.id === t.id);
  const scorer = idOf.get(squads[0][0].name);
  must(
    await admin.call("setup", "PUT", `/api/tournaments/${t.id}/winners`, {
      winners: [
        { award: "The Judges' Call", memberId: idOf.get(squads[1][0].name), title: "Most Dramatic Fall" },
        { award: "Top scorer", memberId: scorer },
        { award: "Dim Mak", memberId: idOf.get(squads[2][0].name) },
        { award: "Champions", teamId: x.teams[0].id },
      ],
    }),
    "winners",
  );
  return t.id;
}

/**
 * The after-party: a Kumite played out and its awards confirmed (not timed), and the room (`followers` phones) on the
 * after-party page while whoever runs it turns each card over and rolls the drum on.
 */
async function reveals({ target, roster, stats, shared, notes, d1, followers = 100 }) {
  const admin = await adminPhone(target, roster, stats, shared);
  const t = { id: await playedKumite(admin, roster) };
  const awards = AWARDS;
  const room = await phones(
    target,
    roster.slice(1, 1 + Math.min(followers, roster.length - 1)).map((r) => r.email),
    stats,
    { shared },
  );
  await Promise.all(
    room.map((p) => p.boot("bootstrap: open the after-party").then(() => p.page("page: the after-party", ["members"]))),
  );
  const stops = room.map((p) => p.follow(["tournaments"]));
  await sleep(2000);
  const from = { rows: d1 ? (await d1()).rowsRead : null, requests: stats.rows.length };
  let changes = 0;
  for (let i = 0; i < awards.length; i++) {
    if (i > 0) {
      must(await admin.change("roll the drum", "POST", `/api/tournaments/${t.id}/awards/next`, { at: i }), "next");
      changes++;
      await sleep(4000);
    }
    must(await admin.change("reveal", "POST", `/api/tournaments/${t.id}/awards/reveal`, { next: i }), "reveal");
    changes++;
    await sleep(6000);
  }
  const during = stats.rows
    .slice(from.requests)
    .filter((r) => !r.label.startsWith("live: event") && r.label !== "live: change to screen");
  const reads = during.filter((r) => r.label.startsWith("live: read")).length;
  const rows = d1 ? (await d1()).rowsRead - from.rows : null;
  notes.push(
    `The reveal, ${room.length} in the room: ${changes} changes (reveals and rolls); a change ${(during.length / changes).toFixed(1)} requests, ` +
      `${(reads / changes).toFixed(1)} reads on the phones` +
      (rows === null ? "" : `, ${Math.round(rows / changes)} D1 rows read`) +
      `; at most ${peakIn10s(stats, during)} requests in 10 s`,
  );
  const revealed = (await admin.boot("setup")).tournaments.find((y) => y.id === t.id);
  notes.push(`Revealed: ${revealed.awardsRevealed ?? revealed.revealed ?? "?"} of ${awards.length}`);
  await Promise.all(stops.map((s) => s()));
  notes.push(`The Kumite deleted: ${(await admin.call("setup", "DELETE", `/api/tournaments/${t.id}`)).status}`);
}

/** A phone's push token as Firebase makes one, for nobody: Firebase answers that it's unregistered (forgotten). */
const nobodysToken = () => {
  const b = (n) =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(n)))
      .toString("base64url")
      .slice(0, n);
  return `${b(22)}:APA91b${b(134)}`;
};

/**
 * A send to every phone at once (as a club-wide announcement, or sign-up opening): every member in a night of the
 * run's own with a phone registered (a token Firebase has for nobody, so the run's phones are only ever told about
 * the run's night), everyone on Home following; the teams published, so each of them is told. The publish sends the
 * first 40; the push drain every minute the rest (ADR 0108). Against dev, the outbox is watched until it's empty.
 */
async function clubSend({ target, roster, stats, shared, notes }) {
  const admin = await adminPhone(target, roster, stats, shared);
  const session = await loadNight(admin, await admin.boot("setup"), { capacity: roster.length + 10 });
  const everyone = await phones(
    target,
    roster.slice(1).map((r) => r.email),
    stats,
    { shared },
  );
  for (const p of everyone) {
    must(await p.call("setup", "POST", `/api/sessions/${session.id}/answer`, { answer: "in" }), "in");
    must(await p.call("setup", "PUT", "/api/auth/device", { platform: "android", token: nobodysToken() }), "device");
  }
  await Promise.all(everyone.map((p) => p.boot("bootstrap: open the app")));
  const stops = everyone.map((p) => p.follow(["sessions"]));
  await sleep(2000);
  const night = (await admin.boot("setup")).sessions.find((s) => s.id === session.id);
  const teams = [0, 1].map((t) => ({
    name: t ? "Whites" : "Darks",
    players: night.going.filter((_, i) => i % 2 === t),
  }));
  const sentAt = Date.now();
  must(
    await admin.change("publish teams (tells every phone)", "POST", `/api/sessions/${session.id}/teams`, { teams }),
    "teams",
  );
  // The outbox, watched as the drain empties it (dev's own crons; a local Worker sends every row at once)
  if (target.db) {
    const ours = `member_id IN (SELECT id FROM members WHERE email LIKE '%@load.test')`;
    const seen = [];
    for (;;) {
      const [o] = await target.db.rows(
        `SELECT COUNT(*) total, SUM(state IN ('queued', 'claimed')) waiting FROM push_outbox WHERE ${ours}`,
      );
      seen.push(`${Math.round((Date.now() - sentAt) / 1000)} s: ${o.waiting ?? 0} of ${o.total} waiting`);
      if (!o.waiting || Date.now() - sentAt > 10 * 60_000) break;
      if (!target.remote) await target.cron?.("* * * * *");
      await sleep(target.remote ? 15_000 : 1000);
    }
    notes.push(`The outbox, ${everyone.length} phones told: ${seen.join("; ")}`);
  }
  await Promise.all(stops.map((s) => s()));
}

/** The most of these requests sent in one of the clock's 10-second windows, as the domain's rule counts them. */
function peakIn10s(stats, rows) {
  const windows = new Map();
  for (const r of rows) {
    const w = Math.floor((stats.startedAt + r.at - r.ms) / 10_000);
    windows.set(w, (windows.get(w) ?? 0) + 1);
  }
  return Math.max(0, ...windows.values());
}

/**
 * How long each change took to reach the screens: from the tap to the last phone showing it (or anything after it,
 * once it's moved on), and to each phone. `sent`: each change's game and when it was sent; `seen`: each phone's.
 */
function toEveryScreen(sent, seen) {
  const toEvery = sent.map((s, k) => {
    const states = new Set(sent.slice(k).map((later) => later.game));
    const times = seen.map((list) => list.find((v) => v.at >= s.at && states.has(v.game))?.at ?? Infinity);
    return { last: Math.max(...times) - s.at, each: times.map((at) => at - s.at) };
  });
  const sorted = (xs) => xs.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (xs, p) => Math.round(xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? NaN);
  const lasts = sorted(toEvery.map((c) => c.last));
  const each = sorted(toEvery.flatMap((c) => c.each));
  const missed = toEvery.reduce((n, c) => n + c.each.filter((v) => !Number.isFinite(v)).length, 0);
  return (
    `A change to every screen (tap to the last phone): p50 ${at(lasts, 0.5)} ms, p95 ${at(lasts, 0.95)} ms; ` +
    `to each phone p50 ${at(each, 0.5)} ms, p95 ${at(each, 0.95)} ms; never shown ${missed}`
  );
}

/**
 * One phone at a time, nothing else running: what each request costs on its own (latency, CPU, rows), the yardstick
 * for the busy runs. A cold bootstrap, an unchanged one (304), a changed one, an In and an Out. Against dev, `cpu` and
 * `d1` are null: latencies only.
 */
async function baseline({ target, roster, stats, cpu, d1, notes }) {
  const admin = await adminPhone(target, roster, stats, false);
  const session = await loadNight(admin, await admin.boot("setup"));
  const members = await phones(
    target,
    roster.slice(1, 21).map((r) => r.email),
    stats,
  );
  const costs = [];
  /** One request, its CPU and D1 rows on its own */
  // Against dev there's no counter beside each request: its latency here, Cloudflare's numbers for the run as a whole
  const alone = async (label, run) => {
    if (!d1) return run();
    await d1(true);
    const before = cpu();
    await run();
    costs.push({ label, cpu: cpu() - before, ...(await d1()) });
  };
  for (const p of members) {
    await alone("bootstrap (first)", () => p.boot("bootstrap (first)"));
    await alone("bootstrap (unchanged, 304)", () => p.boot("bootstrap (unchanged, 304)"));
    await alone("answer: in", () =>
      p.call("answer: in", "POST", `/api/sessions/${session.id}/answer`, { answer: "in" }),
    );
    await alone("bootstrap (changed)", () => p.boot("bootstrap (changed)"));
    await alone("answer: out", () =>
      p.call("answer: out", "POST", `/api/sessions/${session.id}/answer`, { answer: "out" }),
    );
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const label of [...new Set(costs.map((c) => c.label))]) {
    const each = costs.filter((c) => c.label === label);
    notes.push(
      `${label}: CPU ${mean(each.map((c) => c.cpu)).toFixed(1)} ms, ${mean(each.map((c) => c.queries)).toFixed(1)} statements, ` +
        `${mean(each.map((c) => c.rowsRead)).toFixed(0)} rows read, ${mean(each.map((c) => c.rowsWritten)).toFixed(1)} written, on average`,
    );
  }
}

export const SCENARIOS = {
  baseline,
  "friday-rush": fridayRush,
  register,
  "live-draft": liveDraft,
  scoring,
  reveals,
  "club-send": clubSend,
};
