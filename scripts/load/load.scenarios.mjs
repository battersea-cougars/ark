// The club's busy moments, as load runs (docs/load-testing.md). Each sets up through the API as the admin (not timed),
// then does what the members' phones would, timed into `stats`. Against a Worker of the run's own (load.server.mjs).
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
const crons = (url, cron) => fetch(`${url}/__scheduled?cron=${encodeURIComponent(cron)}`).then((r) => r.status);

/**
 * Friday sign-up opening: every member opens the app and taps In within 10 seconds, everyone on Home following the
 * sign-ups live; both crons run in the middle of it; then the team maker publishes the teams while they're all still
 * on the page.
 */
async function fridayRush({ url, roster, stats, shared, notes }) {
  const admin = await phone(url, roster[0].email, stats, { address: shared ? "10.0.0.1" : "10.9.9.9" });
  const club = await admin.boot("setup");
  const session = club.sessions.find((s) => s.heldOn >= today() && !s.cancelledAt);
  const series = club.series.find((s) => s.id === session.seriesId) ?? club.series[0];
  must(
    await admin.call("setup", "PUT", `/api/series/${series.id}`, { ...series, capacity: 40, goalieCapacity: 2 }),
    "places",
  );
  const everyone = await phones(
    url,
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
    await p.call("answer: in", "POST", `/api/sessions/${session.id}/answer`, { answer: "in" });
  });
  // The crons, in the middle of it
  await sleep(window / 2);
  const ran = await Promise.all([crons(url, "*/5 * * * *"), crons(url, "7 * * * *")]);
  notes.push(`Crons in the middle of it: ${ran.join(", ")}`);
  await Promise.all(taps);
  const night = (await admin.boot("setup")).sessions.find((s) => s.id === session.id);
  notes.push(`The night: ${night.going.length} in, ${night.waitlist.length} waiting (40 skaters' places, 2 keepers')`);
  // The teams, published while everyone's on the page
  await sleep(2000);
  const going = night.going;
  const teams = [0, 1].map((t) => ({ name: t ? "Whites" : "Darks", players: going.filter((_, i) => i % 2 === t) }));
  must(await admin.call("publish teams", "POST", `/api/sessions/${session.id}/teams`, { teams }), "teams");
  await sleep(5000);
  await Promise.all(stops.map((s) => s()));
}

/**
 * A Kumite draft: eight captains picking in turn, 60 players watching the draft room live, whoever runs it taking one
 * pick back and making one for a captain.
 */
async function liveDraft({ url, roster, stats, shared, notes }) {
  const admin = await phone(url, roster[0].email, stats, { address: shared ? "10.0.0.1" : "10.9.9.9" });
  const club = await admin.boot("setup");
  const idOf = new Map(club.members.map((m) => [m.name, m.id]));
  const type = must(
    await admin.call("setup", "POST", "/api/tournament-types", {
      name: "Load Cup",
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
      name: "Load Cup 2026",
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
    url,
    players.map((r) => r.email),
    stats,
    { shared },
  );
  for (const p of watching)
    must(await p.call("setup", "POST", `/api/tournaments/${t.id}/answer`, { answer: "in" }), "in");
  must(await admin.call("setup", "POST", `/api/tournaments/${t.id}/draft/draw`, {}), "draw");
  must(await admin.call("setup", "POST", `/api/tournaments/${t.id}/draft/open`, {}), "open");
  const captainPhones = await phones(
    url,
    captains.map((r) => r.email),
    stats,
    { shared },
  );
  const goalies = new Set(club.members.filter((m) => m.position === "G").map((m) => m.id));
  let picks = 0;
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
  const stops = watching.map((p) => (p.boot("bootstrap: open the draft"), p.follow(["tournaments"])));
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
    const r = await cap.call("pick", "POST", `/api/tournaments/${t.id}/draft/picks`, { memberId, turn: d.made });
    if (r.status === 200) picks++;
    busy.delete(cap);
    await cap.boot("bootstrap: after the pick");
    turn(cap);
  };
  for (const cap of captainPhones) {
    await cap.boot("bootstrap: open the draft");
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
    if (!d.pool.length) finished = true;
    if (!undone && d.made >= 20) {
      undone = true;
      notes.push(
        `Undo at pick ${d.made}: ${(await admin.call("undo", "DELETE", `/api/tournaments/${t.id}/draft/picks/last`)).status}`,
      );
    }
    if (!pickedFor && d.made >= 30 && d.pool.length) {
      pickedFor = true;
      const r = await admin.call("pick for a captain", "POST", `/api/tournaments/${t.id}/draft/picks`, {
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
}

/** A game scored live: one scorekeeper, 80 members following the game page. */
async function scoring({ url, roster, stats, shared, notes }) {
  const admin = await phone(url, roster[0].email, stats, { address: shared ? "10.0.0.1" : "10.9.9.9" });
  const club = await admin.boot("setup");
  const idOf = new Map(club.members.map((m) => [m.name, m.id]));
  const captains = roster.slice(1, 4);
  const t = must(
    await admin.call("setup", "POST", "/api/tournaments", {
      name: "Load Scrimmage",
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
  const keeper = await phone(url, keeperName.email, stats, { address: shared ? "10.0.0.1" : "10.9.9.8" });
  const viewers = await phones(
    url,
    roster.slice(10, 90).map((r) => r.email),
    stats,
    { shared },
  );
  const stops = viewers.map((p) => (p.boot("bootstrap: open the game"), p.follow(["tournaments"])));
  await sleep(2000);
  const path = `/api/tournaments/${t.id}/games/${game.id}`;
  must(await keeper.call("claim the sheet", "POST", `${path}/scorer`, { action: "claim" }), "claim");
  must(await keeper.call("clock", "POST", `${path}/clock`, { action: "start" }), "start");
  const home = game.homeTeamId;
  const away = game.awayTeamId;
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    await keeper.call("goal", "POST", `${path}/goals`, { teamId: i % 3 ? home : away });
    if (i % 4 === 1)
      await keeper.call("penalty", "POST", `${path}/penalties`, {
        teamId: i % 2 ? away : home,
        infraction: "delay-of-game",
      });
    if (i === 5) {
      await keeper.call("clock", "POST", `${path}/clock`, { action: "period", period: 1 });
      await sleep(1000);
      await keeper.call("clock", "POST", `${path}/clock`, { action: "start" });
    }
    if (i === 8) await keeper.call("undo goal", "DELETE", `${path}/goals/last`);
  }
  await keeper.call("clock", "POST", `${path}/clock`, { action: "end" });
  await sleep(4000);
  const g = (await admin.boot("setup")).tournaments.find((y) => y.id === t.id).games.find((y) => y.id === game.id);
  notes.push(`Full time: ${g.homeGoals}–${g.awayGoals}, ${g.status}`);
  await Promise.all(stops.map((s) => s()));
}

/**
 * One phone at a time, nothing else running: what each request costs on its own (latency, CPU, rows), the yardstick
 * for the busy runs. A cold bootstrap, an unchanged one (304), a changed one, an In and an Out.
 */
async function baseline({ url, roster, stats, cpu, d1, notes }) {
  const admin = await phone(url, roster[0].email, stats);
  const session = (await admin.boot("setup")).sessions.find((s) => s.heldOn >= today() && !s.cancelledAt);
  const members = await phones(
    url,
    roster.slice(1, 21).map((r) => r.email),
    stats,
  );
  const costs = [];
  /** One request, its CPU and D1 rows on its own */
  const alone = async (label, run) => {
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

export const SCENARIOS = { baseline, "friday-rush": fridayRush, "live-draft": liveDraft, scoring };
