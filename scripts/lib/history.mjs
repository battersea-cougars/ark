// A made-up past for a local club (`npm run seed:history`, scripts/seed-history.mjs): years of played Kumites and a
// year of training nights, for the club's real local members, so History's pages, past Kumites read on demand, logos
// by address and the dues ledger can be tried with a club's weight behind them. Local only, and all of it can go again:
//   Kumites       tournaments.signup_told_at is SEEDED_AT, a moment before the app existed (nothing else reads it once
//                 a Kumite's day has passed); their teams, draft, games, goals, penalties, awards, votes, sign-ups and
//                 charges go with them
//   training      its own series, slug "seed-history" (Tuesday Skills, finished and paused), with its nights, their
//                 sign-ups and charges
//   payments      created_at is SEEDED_AT; what they paid goes with them
// The same seed makes the same past for the same club. `db` is { rows(sql), run(sql) }: a local D1 through wrangler, a
// SQLite file, or the tests' SQLite.
import { KUMITE_ID_TABLES, KUMITE_TABLES, NEXT_IDS_SQL, idsFrom, insertsSql, kumiteRows } from "./history.rows.mjs";

export const SEEDED_AT = "2000-01-01T00:00:00.000Z";
export const SERIES_SLUG = "seed-history";

const TRAINING_TABLES = ["training_series", "series_fees", "training_sessions", "attendance", "charges"];
const MONEY_TABLES = ["payments", "payment_allocations"];
const ID_TABLES = ["training_series", "training_sessions", "attendance", "charges", "payments", ...KUMITE_ID_TABLES];

// ─── What's there ───

const SERIES = `SELECT id FROM training_series WHERE slug = '${SERIES_SLUG}'`;
const SESSIONS = `SELECT id FROM training_sessions WHERE series_id IN (${SERIES})`;
const TOURNAMENTS = `SELECT id FROM tournaments WHERE signup_told_at = '${SEEDED_AT}'`;
const PAYMENTS = `SELECT id FROM payments WHERE created_at = '${SEEDED_AT}'`;

/** What a seeded history has left in the database, by kind: all zeros when there's none. */
export async function leftovers(db) {
  const count = (select) => `(SELECT COUNT(*) FROM (${select}))`;
  const [row] = await db.rows(
    `SELECT ${count(TOURNAMENTS)} kumites, ${count(SERIES)} trainings, ${count(SESSIONS)} nights,
            (SELECT COUNT(*) FROM attendance WHERE session_id IN (${SESSIONS})) signUps,
            (SELECT COUNT(*) FROM charges WHERE session_id IN (${SESSIONS}) OR tournament_id IN (${TOURNAMENTS})) charges,
            ${count(PAYMENTS)} payments`,
  );
  return row;
}
export const nothingLeft = (left) => Object.values(left).every((n) => !n);

/** Everything seeded, gone, in one go: what cascades goes with its tournament, night or payment. Phones reload. */
export const REMOVE_SQL = [
  `DELETE FROM agenda WHERE (source = 'tournament' AND source_id IN (${TOURNAMENTS}))
     OR (source = 'session' AND source_id IN (${SESSIONS}))`,
  `DELETE FROM payments WHERE id IN (${PAYMENTS})`,
  `DELETE FROM tournaments WHERE id IN (${TOURNAMENTS})`,
  `DELETE FROM training_sessions WHERE id IN (${SESSIONS})`,
  `DELETE FROM training_series WHERE id IN (${SERIES})`,
  "INSERT INTO data_version (id, version) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER)) ON CONFLICT (id) DO UPDATE SET version = version + 1",
].join(";\n");

/** Takes a seeded history away: what was there, and what's left (nothing). */
export async function removeHistory(db) {
  const before = await leftovers(db);
  if (!nothingLeft(before)) await db.run(REMOVE_SQL);
  return { before, after: await leftovers(db) };
}

/** The club as the history needs it: its active members, admins, the Kumite series, venues and the next free ids. */
export async function readClub(db) {
  const members = await db.rows("SELECT id, name, position, rating FROM members WHERE status = 'active' ORDER BY id");
  const admins = (
    await db.rows(
      `SELECT mr.member_id id FROM member_roles mr JOIN roles r ON r.id = mr.role_id
       JOIN members m ON m.id = mr.member_id WHERE r.name = 'Admin' AND m.status = 'active' ORDER BY mr.member_id`,
    )
  ).map((r) => r.id);
  // Quarterly Members (or a quarter charged by hand) don't pay by the night: none of their nights are charged
  const quarterly = (
    await db.rows(
      "SELECT member_id id FROM subscriptions UNION SELECT member_id FROM charges WHERE quarter IS NOT NULL",
    )
  ).map((r) => r.id);
  const [type] = await db.rows(
    "SELECT * FROM tournament_types WHERE kind = 'draft' ORDER BY slug = 'kumite' DESC, id LIMIT 1",
  );
  const venues = (await db.rows("SELECT id FROM venues WHERE active = 1 ORDER BY id")).map((r) => r.id);
  // Names already taken: a seeded Kumite never shares one with the club's own
  const names = (await db.rows("SELECT name FROM tournaments")).map((r) => r.name);
  const [next] = await db.rows(NEXT_IDS_SQL(ID_TABLES));
  return { members, admins, quarterly, type, venues, names, next };
}

// ─── Making it up ───

/** A seeded generator (mulberry32): the same seed, the same history. */
function dice(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n) => Math.floor(next() * n);
  const one = (list) => list[below(list.length)];
  const shuffled = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = below(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  /** One of `list`, likelier the more it weighs. */
  const weighted = (list, weight) => {
    const total = list.reduce((s, x) => s + weight(x), 0);
    let at = next() * total;
    for (const x of list) if ((at -= weight(x)) < 0) return x;
    return list.at(-1);
  };
  /** A count around `mean` (Poisson). */
  const around = (mean) => {
    let k = 0;
    for (let p = Math.exp(-mean), s = p, u = next(); u > s; k++) s += p = (p * mean) / (k + 1);
    return k;
  };
  return { next, below, one, shuffled, weighted, around };
}

const DAY_MS = 86_400_000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const msOf = (day) => Date.parse(`${day}T12:00:00Z`);
const addDays = (day, n) => dayOf(msOf(day) + n * DAY_MS);
/** The last `weekday` (0 Sunday … 6 Saturday) on or before `day`. */
const onOrBefore = (day, weekday) => addDays(day, -((new Date(msOf(day)).getUTCDay() - weekday + 7) % 7));

const london = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
/** A London wall-clock time on a day, `plus` minutes on, as an instant (UTC ISO). */
function londonAt(day, time, plus = 0) {
  const [h, m] = time.split(":").map(Number);
  const guess = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h, m);
  const p = Object.fromEntries(london.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(guess - (shown - guess) + plus * 60_000).toISOString();
}

/** "Autumn 2025", as the app names a Kumite by its season (packages/shared/seasons.ts). */
function seasonLabel(day) {
  const month = Number(day.slice(5, 7));
  const year = Number(day.slice(0, 4)) - (month <= 2 ? 1 : 0);
  const season = month <= 2 || month === 12 ? "Winter" : ["Spring", "Summer", "Autumn"][Math.floor((month - 3) / 3)];
  return `${season} ${year}`;
}

const TEAM_NAMES = [
  "Kumite Kings",
  "Dim Mak Attack",
  "Shidoshi Shooters",
  "Crane Kick Collective",
  "Iron Fist Five",
  "Chong Li's Revenge",
  "Hong Kong Hookers",
  "Dojo Destroyers",
  "Roundhouse Rink Rats",
  "Black Belt Blueliners",
  "Five Hole Fury",
  "Tiger Claw",
  "Splits & Sticks",
  "Kiai Collective",
  "Lotus Slapshots",
  "Paper Tigers",
  "Dragon Slashers",
  "The Bloodsporters",
  "Silent Shinpads",
  "Spin Kick Specialists",
  "Mawashi Muppets",
  "Sensei's Spare Tyres",
  "Flying Elbows",
  "The Wax-On Wingers",
  "Bamboo Breakaways",
  "Shaolin Snipers",
  "Eye of the Tiger Line",
  "Sweep the Leg",
  "Kata Catastrophe",
  "The Blindfolded",
  "Powder in the Eyes",
  "Tanaka's Tape Jobs",
  "Grasshopper Grinders",
  "Hand of Death",
  "Nunchuck Norrises",
  "Ninja Neutral Zone",
  "Mighty Morphin Muppets",
  "Toe Drag Tigers",
  "Ki Thieves",
  "Blood & Biscuits",
  "Uppercut Ultras",
  "Dux Deluxe",
];

/** One-off places a Kumite went, not saved as venues. */
const ONE_OFFS = [
  { location: "Latchmere Leisure Centre", map_url: "" },
  { location: "Tooting Bec Lido car park", map_url: "" },
  { location: "Clapham Common bandstand courts", map_url: "" },
  { location: "Wandsworth Town Hall sports hall", map_url: "" },
];

/** A team's crest: its initials on its colours, an SVG as a data: URL (a real one is a small WebP, lib/logo.ts). */
export function crestOf(name) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const [a, b] = [h % 360, (h >>> 9) % 360];
  const initials = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, "")[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const shapes = [
    `<circle cx="128" cy="128" r="92" fill="hsl(${b} 70% 45%)"/>`,
    `<path d="M128 20 236 128 128 236 20 128Z" fill="hsl(${b} 70% 45%)"/>`,
    `<path d="M40 40h176v110c0 50-44 80-88 92-44-12-88-42-88-92Z" fill="hsl(${b} 70% 45%)"/>`,
  ];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="36" ` +
    `fill="hsl(${a} 55% 22%)"/>${shapes[h % 3]}<text x="128" y="160" font-family="Arial, sans-serif" ` +
    `font-size="92" font-weight="700" text-anchor="middle" fill="#fff">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** How an award is decided: its own `decidedBy`, else a guess from its name (apps/team/src/lib/awards.ts). */
function decidedByOf(a) {
  if (a.decidedBy) return a.decidedBy;
  if (/dim mak|random|lucky|fun/i.test(a.name)) return { kind: "random" };
  if (/champion/i.test(a.name)) return { kind: "stat", stat: "table" };
  if (/scor/i.test(a.name)) return { kind: "stat", stat: "goals" };
  if (/goalie|keeper|goaltend/i.test(a.name)) return { kind: "stat", stat: "goalsAgainst" };
  return { kind: "live", options: [] };
}

/** The round robin's table, as packages/shared/results.ts sorts it: points, goal difference, goals for. */
function table(teamCount, games, points) {
  const rows = Array.from({ length: teamCount }, (_, team) => ({ team, pts: 0, gf: 0, ga: 0 }));
  for (const g of games)
    for (const [t, f, a] of [
      [g.home, g.home_goals, g.away_goals],
      [g.away, g.away_goals, g.home_goals],
    ]) {
      rows[t].gf += f;
      rows[t].ga += a;
      rows[t].pts += f > a ? points.win : f === a ? points.draw : points.loss;
    }
  return rows.sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf).map((r) => r.team);
}

/** The round robin by the circle method: everyone plays everyone once, nobody twice running where it can be helped. */
function roundRobin(n) {
  const seats = Array.from({ length: n % 2 ? n + 1 : n }, (_, i) => (i < n ? i : null));
  const out = [];
  for (let r = 0; r < seats.length - 1; r++) {
    for (let i = 0; i < seats.length / 2; i++) {
      const [x, y] = [seats[i], seats[seats.length - 1 - i]];
      if (x !== null && y !== null) out.push(r % 2 ? [y, x] : [x, y]);
    }
    seats.splice(1, 0, seats.pop());
  }
  return out;
}

const INFRACTIONS = ["tripping", "hooking", "high-stick", "slashing", "interference", "holding", "roughing"];

/**
 * Who came and the draft: the captains (skaters), up to a keeper a team, then the rest picked in snake order from the
 * pick order drawn, by their captain or now and then by an admin running it. A captain keeps their team's name half
 * the time. Each team's skaters, keeper and strength, for the games.
 */
function draft(roll, club, heldOn, lastNames) {
  const { members, admins } = club;
  const goalies = roll.shuffled(members.filter((m) => m.position === "G"));
  const skaters = roll.shuffled(members.filter((m) => m.position !== "G"));
  const going = skaters.slice(0, Math.max(8, Math.round(skaters.length * (0.55 + roll.next() * 0.4))));
  const fits = Math.floor((going.length + goalies.length) / 5);
  const teamCount = Math.max(2, Math.min(fits, roll.next() < 0.2 ? 6 : 4));
  const captains = going.slice(0, teamCount);
  const keepers = goalies.slice(0, Math.min(goalies.length, teamCount - (roll.next() < 0.2 ? 1 : 0)));
  // Keepers first (one a team), then the best skaters, more or less
  const pool = [
    ...keepers,
    ...going.slice(teamCount).sort((x, y) => y.rating + roll.below(25) - (x.rating + roll.below(25))),
  ];
  const used = new Set();
  const teams = captains.map((c) => {
    const kept = lastNames.get(c.id);
    const name =
      kept && !used.has(kept) && roll.next() < 0.5
        ? kept
        : (roll.one(TEAM_NAMES.filter((n) => !used.has(n))) ?? `Team ${used.size + 1}`);
    used.add(name);
    lastNames.set(c.id, name);
    const created_at = londonAt(addDays(heldOn, -14), "09:00");
    return { name, logo: roll.next() < 0.85 ? crestOf(name) : null, captain_member_id: c.id, created_at, players: [] };
  });
  roll.shuffled(teams.map((_, i) => i)).forEach((team, order) => (teams[team].pick = order + 1));
  const byPick = [...teams].sort((a, b) => a.pick - b.pick);
  const people = new Map(teams.map((t, i) => [t, [captains[i]]]));
  pool.forEach((m, n) => {
    const at = n % teamCount;
    const team = byPick[Math.floor(n / teamCount) % 2 ? teamCount - 1 - at : at];
    const helper = admins.find((a) => a !== team.captain_member_id);
    const picked_by = helper && roll.next() < 0.15 ? helper : team.captain_member_id;
    team.players.push({ member_id: m.id, pick_number: n + 1, picked_by });
    people.get(team).push(m);
  });
  const sides = teams.map((t) => {
    const sk = people.get(t).filter((p) => p.position !== "G");
    const keeper = people.get(t).find((p) => p.position === "G") ?? null;
    return { skaters: sk, keeper, strength: sk.reduce((sum, p) => sum + p.rating, 0) / sk.length };
  });
  const out = skaters.filter((m) => !going.includes(m)).slice(0, 3);
  return { teams, sides, said: [...captains, ...pool], out };
}

/** Each player's goals, assists, penalty minutes, goals let in (a keeper) and games, as the evening goes. */
function tally() {
  const stats = new Map();
  return (id) => {
    if (!stats.has(id)) stats.set(id, { goals: 0, assists: 0, pim: 0, against: 0, games: 0 });
    return stats.get(id);
  };
}

/** A game's goals, `n` for a side: its skaters score (the better, the likelier), most with an assist. */
function goalsFor(roll, stat, side, skaters, n) {
  return Array.from({ length: n }, () => {
    const scorer = roll.weighted(skaters, (p) => p.rating ** 2);
    const others = skaters.filter((p) => p !== scorer);
    const assist = others.length && roll.next() < 0.75 ? roll.weighted(others, (p) => p.rating) : null;
    stat(scorer.id).goals++;
    if (assist) stat(assist.id).assists++;
    return { side, scorer_member_id: scorer.id, assist_member_id: assist?.id ?? null, at: roll.next() };
  });
}

/** A game's penalties: about one a game, a player's (now and then the bench's), mostly the series' usual length. */
function penaltiesIn(roll, stat, type, sides, home, away, recordedBy) {
  return Array.from({ length: roll.around(0.9) }, () => {
    const [side, team] = roll.next() < 0.5 ? ["home", home] : ["away", away];
    const bench = roll.next() < 0.06;
    const who = bench ? null : roll.one(sides[team].skaters);
    const minutes = bench ? 2 : roll.next() < 0.1 ? 4 : roll.next() < 0.05 ? 5 : type.default_penalty_minutes;
    if (who) stat(who.id).pim += minutes;
    const infraction = bench ? roll.one(["too-many-players", "bench-minor"]) : roll.one(INFRACTIONS);
    return { side, member_id: who?.id ?? null, minutes, infraction, recorded_by: recordedBy, at: roll.next() };
  });
}

/**
 * The evening: the round robin, then the playoffs from its table, each game after the one before, scored by the
 * teams' strengths (a playoff never level). What was played, who won it, and when it was over.
 */
function evening(roll, club, base, heldOn, sides) {
  const { type } = club;
  const slot = type.game_minutes * type.periods + type.break_minutes + 4;
  const games = [];
  const stat = tally();
  const play = (home, away, extra) => {
    const startedAt = londonAt(heldOn, base.start_time, games.length * slot);
    const lambda = (s, o) => 1.8 * (sides[s].strength / sides[o].strength) ** 1.5;
    let [hg, ag] = [roll.around(lambda(home, away)), roll.around(lambda(away, home))];
    if (extra.stage === "playoff" && hg === ag) [hg, ag] = roll.next() < 0.5 ? [hg + 1, ag] : [hg, ag + 1];
    const goals = [
      ...goalsFor(roll, stat, "home", sides[home].skaters, hg),
      ...goalsFor(roll, stat, "away", sides[away].skaters, ag),
    ].sort((x, y) => x.at - y.at);
    const penalties = penaltiesIn(roll, stat, type, sides, home, away, club.admins[0] ?? null);
    // Each in its period, at its time in it
    const timed = ({ at, ...row }) => {
      const period = 1 + Math.floor(at * type.periods);
      const at_ms = Math.floor((at * type.periods - (period - 1)) * type.game_minutes * 60_000);
      const created_at = new Date(Date.parse(startedAt) + at_ms + (period - 1) * 60_000).toISOString();
      return { ...row, at_ms, period, created_at };
    };
    for (const [team, against] of [
      [home, ag],
      [away, hg],
    ]) {
      for (const p of [...sides[team].skaters, sides[team].keeper].filter(Boolean)) stat(p.id).games++;
      if (sides[team].keeper) stat(sides[team].keeper.id).against += against;
    }
    games.push({
      ...extra,
      round: extra.round ?? games.length + 1,
      position: games.length + 1,
      home,
      away,
      home_goals: hg,
      away_goals: ag,
      status: "done",
      period: type.periods,
      started_at: startedAt,
      goals: goals.map(timed),
      penalties: penalties.map(timed),
    });
  };
  const fixtures = roundRobin(sides.length);
  for (const [h, a] of fixtures) play(h, a, { stage: "group", name: "" });
  const points = { win: type.points_win, draw: type.points_draw, loss: type.points_loss };
  const standings = table(sides.length, games, points);
  const playoffs = JSON.parse(type.playoffs || "[]").filter(
    (p) => Number.isInteger(p.home) && Number.isInteger(p.away) && Math.max(p.home, p.away) <= sides.length,
  );
  for (const p of playoffs)
    play(standings[p.home - 1], standings[p.away - 1], {
      stage: "playoff",
      name: p.name,
      round: fixtures.length + 1,
      home_seed: p.home,
      away_seed: p.away,
    });
  const final = games.filter((g) => g.stage === "playoff").at(-1);
  const champions = final ? (final.home_goals > final.away_goals ? final.home : final.away) : standings[0];
  const over = (plus = 0) => londonAt(heldOn, base.start_time, games.length * slot + plus);
  return { games, stat, playoffs, champions, over };
}

/** A voted award's votes, cast after the last game (never for themselves), and who most voted for. */
function voted(roll, how, award, played, castAt) {
  const voters = how.voters === "skaters" ? played.filter((p) => p.position !== "G") : played;
  const candidates = how.voters === "skaters" ? played.filter((p) => p.position === "G") : played;
  const pull = new Map(candidates.map((c) => [c.id, 1 + roll.next() * 3]));
  const votes = [];
  for (const v of voters) {
    const choices = candidates.filter((c) => c.id !== v.id);
    if (!choices.length || roll.next() < 0.1) continue;
    const c = roll.weighted(choices, (x) => pull.get(x.id));
    votes.push({ award, voter_member_id: v.id, candidate_member_id: c.id, cast_at: castAt(roll.below(10)) });
  }
  const counted = new Map();
  for (const v of votes) counted.set(v.candidate_member_id, (counted.get(v.candidate_member_id) ?? 0) + 1);
  const [winner] = [...counted].sort((a, b) => b[1] - a[1]);
  return { votes, winner: winner?.[0] ?? null };
}

/**
 * Each award's winners, as an admin confirmed them (lib/awards.ts): the champions; a stat's leaders (joint when
 * level); the keeper letting in fewest a game; a vote's; the judges' call, named; a draw. And the votes cast.
 */
function awarded(roll, awards, played, { stat, champions, over }) {
  const winners = [];
  const votes = [];
  const best = (key) => {
    const top = Math.max(...played.map(key));
    return top > 0 ? played.filter((p) => key(p) === top) : [];
  };
  const by = {
    goals: (p) => stat(p.id).goals * 1000 + stat(p.id).assists,
    assists: (p) => stat(p.id).assists * 1000 + stat(p.id).goals,
    points: (p) => (stat(p.id).goals + stat(p.id).assists) * 1000 + stat(p.id).goals,
    penaltyMinutes: (p) => stat(p.id).pim,
  };
  const keepers = played.filter((p) => p.position === "G");
  const letIn = (p) => stat(p.id).against / Math.max(1, stat(p.id).games);
  for (const { name, ...award } of awards) {
    const how = decidedByOf({ name, ...award });
    const toPlayers = (list) => list.forEach((p, position) => winners.push({ award: name, member_id: p.id, position }));
    if (how.kind === "stat" && how.stat === "table") winners.push({ award: name, team: champions, position: 0 });
    else if (how.kind === "stat" && how.stat === "goalsAgainst")
      toPlayers(keepers.length ? [keepers.reduce((a, b) => (letIn(b) < letIn(a) ? b : a))] : []);
    else if (how.kind === "stat") toPlayers(best(by[how.stat] ?? by.goals));
    else if (how.kind === "vote") {
      const v = voted(roll, how, name, played, over);
      votes.push(...v.votes);
      if (v.winner) winners.push({ award: name, member_id: v.winner, position: 0 });
    } else if (how.kind === "live") {
      const title = roll.one(how.options?.length ? how.options : [name]);
      winners.push({ award: name, member_id: roll.one(played).id, position: 0, title });
    } else toPlayers([roll.one(played)]);
  }
  return { winners, votes };
}

/** One played Kumite on `heldOn`, as kumiteRows takes it: who came, the draft, every game, the awards. */
function playedKumite(roll, club, base, heldOn, lastNames) {
  const { teams, sides, said, out } = draft(roll, club, heldOn, lastNames);
  const night = evening(roll, club, base, heldOn, sides);
  const played = sides.flatMap((s) => [...s.skaters, s.keeper].filter(Boolean));
  const awards = JSON.parse(base.awards);
  const { winners, votes } = awarded(roll, awards, played, night);
  // Signed up over the fortnight before, a few hours apart
  const opens = Date.parse(londonAt(addDays(heldOn, -14), "08:00"));
  const inAt = (i) => new Date(opens + (i + 1) * 3 * 3_600_000).toISOString();
  return {
    tournament: {
      ...base,
      status: "finished",
      draft_state: "closed",
      playoffs: JSON.stringify(night.playoffs),
      awards_revealed: awards.length,
      awards_confirmed_at: night.over(10),
    },
    teams,
    entries: [
      ...said.map((m, i) => ({ member_id: m.id, signup: "in", signed_up_at: inAt(i), attended: 1 })),
      ...out.map((m, i) => ({ member_id: m.id, signup: "out", signed_up_at: inAt(said.length + i) })),
    ],
    games: night.games,
    winners,
    votes,
  };
}

/** A Kumite whose day came and went unplayed: sign-up opened and its captains were in, but it never got going. */
function unplayedKumite(roll, club, base, heldOn) {
  const skaters = roll.shuffled(club.members.filter((m) => m.position !== "G"));
  const signedUp = skaters.slice(0, Math.min(skaters.length, 6 + roll.below(6)));
  const opens = addDays(heldOn, -14);
  return {
    tournament: { ...base, status: "open" },
    teams: signedUp.slice(0, 2).map((c, i) => ({
      name: "",
      captain_member_id: c.id,
      created_at: londonAt(opens, "09:00", i),
      players: [],
    })),
    entries: signedUp.map((m, i) => ({
      member_id: m.id,
      signup: "in",
      signed_up_at: londonAt(opens, "10:00", i * 90),
    })),
  };
}

/** The Kumites: `count` of them over the four years to five weeks ago, on Fridays, two of them never played. */
function kumites(roll, club, today, count, nextId, out) {
  const { type, venues } = club;
  const last = msOf(addDays(today, -35));
  const first = Math.min(last, msOf(addDays(today, -4 * 365)));
  const never = count >= 6 ? new Set([Math.floor(count * 0.3), Math.floor(count * 0.7)]) : new Set();
  const taken = new Set(club.names ?? []);
  const lastNames = new Map();
  // Somewhere else to play now and then: a saved venue that isn't its usual one, nor where everyone goes afterwards
  const others = venues.filter((v) => v !== type.venue_id && v !== type.after_venue_id);
  let previous = "";
  const made = { played: 0, unplayed: 0, from: null, to: null };
  for (let i = 0; i < count; i++) {
    let heldOn = onOrBefore(dayOf(first + ((last - first) * i) / Math.max(1, count - 1)), 5);
    if (heldOn <= previous) heldOn = addDays(previous, 7);
    previous = heldOn;
    const season = `${type.short_name} ${seasonLabel(heldOn)}`;
    const name =
      ["", " II", " III", " IV", " V"].map((n) => season + n).find((n) => !taken.has(n)) ?? `${season} (${i})`;
    taken.add(name);
    const where = roll.next();
    const place =
      where < 0.15 && others.length ? { venue_id: roll.one(others) } : where < 0.3 ? roll.one(ONE_OFFS) : {};
    const base = {
      type_id: type.id,
      name,
      ...place,
      held_on: heldOn,
      start_time: type.default_start_time,
      end_time: type.default_end_time,
      fee_pence: 0,
      signup_opens_on: addDays(heldOn, -14),
      signup_closes_on: addDays(heldOn, -1),
      signup_told_at: SEEDED_AT,
      draft_on: heldOn,
      points_win: type.points_win,
      points_draw: type.points_draw,
      points_loss: type.points_loss,
      game_minutes: type.game_minutes,
      penalty_rule: type.penalty_rule,
      default_penalty_minutes: type.default_penalty_minutes,
      periods: type.periods,
      break_minutes: type.break_minutes,
      kind: "draft",
      awards: type.awards,
      playoffs: type.playoffs,
    };
    const k = never.has(i)
      ? unplayedKumite(roll, club, base, heldOn)
      : playedKumite(roll, club, base, heldOn, lastNames);
    kumiteRows(k, nextId, out);
    made[never.has(i) ? "unplayed" : "played"]++;
    made.from ??= heldOn;
    made.to = heldOn;
  }
  return made;
}

/**
 * A training of its own, Tuesday Skills, every Tuesday for `weeks` weeks to the last one gone: the club's members
 * signed up (each as keen as they are), the odd no-show and walk-in, the register taken, each night charged at its
 * fee (not keepers', not Quarterly Members'), and paid for as people pay: by the month, the quarter, in cash on the
 * night, or not for a while.
 */
function training(roll, club, today, weeks, nextId, out) {
  const add = (table, row) => ((out[table] ??= []).push(row), row);
  const lastNight = onOrBefore(addDays(today, -1), 2);
  const firstNight = addDays(lastNight, -7 * (weeks - 1));
  const series = add("training_series", {
    id: nextId("training_series"),
    slug: SERIES_SLUG,
    name: "Tuesday Skills",
    short_name: "Tuesday",
    icon: "stick",
    tone: "blue",
    weekdays: "tue",
    starts_on: firstNight,
    ends_on: lastNight,
    start_time: "20:00",
    end_time: "21:30",
    venue_id: club.venues[0] ?? null,
    capacity: 21,
    goalie_capacity: 3,
    public: 0,
    active: 0,
  });
  const rise = weeks >= 20 ? addDays(firstNight, 7 * Math.floor(weeks / 2)) : null;
  add("series_fees", { series_id: series.id, effective_from: firstNight, amount_pence: 1000 });
  if (rise) add("series_fees", { series_id: series.id, effective_from: rise, amount_pence: 1200 });
  const feeOn = (day) => (rise && day >= rise ? 1200 : 1000);
  const keen = new Map(club.members.map((m) => [m.id, 0.15 + roll.next() * 0.6]));
  const admin = club.admins[0] ?? null;
  const cancelled = new Set(weeks >= 10 ? [roll.below(weeks), roll.below(weeks)] : []);
  const charges = [];
  for (let w = 0; w < weeks; w++) {
    const day = addDays(firstNight, 7 * w);
    const closed = londonAt(day, "21:30");
    const night = add("training_sessions", {
      id: nextId("training_sessions"),
      series_id: series.id,
      held_on: day,
      fee_pence: feeOn(day),
      signup_told_at: SEEDED_AT,
      register_closed_at: cancelled.has(w) ? null : closed,
      cancelled_at: cancelled.has(w) ? londonAt(addDays(day, -1), "18:00") : null,
      note: cancelled.has(w) ? "Hall double-booked, sorry" : null,
    });
    if (cancelled.has(w)) continue;
    for (const m of club.members) {
      const r = roll.next();
      const going = r < keen.get(m.id);
      const walkIn = !going && r < keen.get(m.id) + 0.03;
      const saidNo = !going && !walkIn && r > 0.95;
      if (!going && !walkIn && !saidNo) continue;
      const attended = saidNo ? null : walkIn ? 1 : roll.next() < 0.05 ? 0 : 1;
      add("attendance", {
        id: nextId("attendance"),
        session_id: night.id,
        member_id: m.id,
        signup: saidNo ? "out" : "in",
        signed_up_at: walkIn
          ? londonAt(day, "20:05")
          : londonAt(addDays(day, -1 - roll.below(4)), "12:00", roll.below(600)),
        attended,
        walk_in: walkIn ? 1 : 0,
        recorded_by: saidNo ? null : admin,
        recorded_at: saidNo ? null : closed,
      });
      if (attended !== 1 || m.position === "G" || club.quarterly.includes(m.id)) continue;
      charges.push(
        add("charges", {
          id: nextId("charges"),
          member_id: m.id,
          session_id: night.id,
          amount_pence: feeOn(day),
          due_on: day,
          created_at: closed,
        }),
      );
    }
  }
  const paid = payments(roll, club, today, charges, nextId, out);
  return { nights: weeks - cancelled.size, cancelled: cancelled.size, from: firstNight, to: lastNight, ...paid };
}

const monthOf = (day) => day.slice(0, 7);
const quarterOf = (day) => `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3)}`;
/** The first of the month after a day's. */
const nextMonth = (day) => `${monthOf(addDays(`${monthOf(day)}-28`, 7))}-01`;
/** The first day of the quarter after a day's. */
const nextQuarter = (day) => {
  const month = Math.floor((Number(day.slice(5, 7)) - 1) / 3) * 3 + 4;
  return month > 12
    ? `${Number(day.slice(0, 4)) + 1}-01-01`
    : `${day.slice(0, 4)}-${String(month).padStart(2, "0")}-01`;
};
const PAYERS = [
  ["monthly", 50],
  ["cash", 20],
  ["quarterly", 15],
  ["behind", 15],
];

/**
 * What one member paid, as { on, via, charges }: in cash on the night (most nights), or by transfer a few days into
 * the next month or quarter for that one's nights; one who's behind hasn't paid for the last three months.
 */
function paidBy(roll, today, theirs, style) {
  if (style === "cash")
    return theirs.filter(() => roll.next() < 0.9).map((c) => ({ on: c.due_on, via: "cash", charges: [c] }));
  const group = style === "quarterly" ? quarterOf : monthOf;
  const groups = new Map();
  for (const c of theirs) groups.set(group(c.due_on), [...(groups.get(group(c.due_on)) ?? []), c]);
  const behindFrom = addDays(today, -90);
  return [...groups.values()]
    .map((charges) => {
      const last = charges.at(-1).due_on;
      const on = addDays(style === "quarterly" ? nextQuarter(last) : nextMonth(last), roll.below(7));
      return { on, via: "transfer", charges, last };
    })
    .filter(({ on, last }) => on <= today && !(style === "behind" && last >= behindFrom));
}

/** How each member pays for their nights, and the payments that makes, each paying for its nights in full. */
function payments(roll, club, today, charges, nextId, out) {
  const add = (table, row) => ((out[table] ??= []).push(row), row);
  for (const m of club.members) {
    const theirs = charges.filter((c) => c.member_id === m.id);
    if (!theirs.length) continue;
    const [style] = roll.weighted(PAYERS, ([, weight]) => weight);
    for (const { on, via, charges: list } of paidBy(roll, today, theirs, style)) {
      const p = add("payments", {
        id: nextId("payments"),
        member_id: m.id,
        amount_pence: list.reduce((sum, c) => sum + c.amount_pence, 0),
        received_on: on,
        via,
        recorded_by: club.admins[0] ?? null,
        created_at: SEEDED_AT,
      });
      for (const c of list)
        add("payment_allocations", { payment_id: p.id, charge_id: c.id, amount_pence: c.amount_pence });
    }
  }
  const made = out.payments ?? [];
  return { payments: made.length, paidPence: made.reduce((s, p) => s + p.amount_pence, 0) };
}

/**
 * The history for this club (readClub's), as rows by table: `kumites` Kumites over four years and `weeks` weeks of
 * training, as of `today`. With what it made, in words' worth of numbers.
 */
export function planHistory(club, { today, kumites: count = 30, weeks = 52, seed = 1 }) {
  if (!club.type) throw new Error("No captains' draft series (the Kumite) to give a history.");
  if (club.members.filter((m) => m.position !== "G").length < 8)
    throw new Error("Fewer than eight active skaters: not enough for a Kumite's teams.");
  const roll = dice(seed);
  const nextId = idsFrom(club.next);
  const tables = {};
  const trained = weeks > 0 ? training(roll, club, today, weeks, nextId, tables) : null;
  const played = count > 0 ? kumites(roll, club, today, count, nextId, tables) : null;
  return { tables, made: { kumites: played, training: trained } };
}

/** The plan as one SQL text, parents first, then the club's data version moved on so open apps reload. */
export const historySql = (plan) =>
  insertsSql(plan.tables, [...TRAINING_TABLES, ...MONEY_TABLES, ...KUMITE_TABLES]) +
  "\nINSERT INTO data_version (id, version) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER))" +
  " ON CONFLICT (id) DO UPDATE SET version = version + 1;";

/** Rows a plan writes, table by table. */
export const counts = (plan) => Object.fromEntries(Object.entries(plan.tables).map(([t, rows]) => [t, rows.length]));

/**
 * Seeds the history into `db`: refuses while an earlier one's still there (remove it first). Returns what it made.
 */
export async function seedHistory(db, options) {
  const left = await leftovers(db);
  if (!nothingLeft(left))
    throw new Error(
      `A seeded history is already there (${JSON.stringify(left)}): npm run seed:history -- --remove first.`,
    );
  const plan = planHistory(await readClub(db), options);
  await db.run(historySql(plan));
  return { made: plan.made, rows: counts(plan) };
}
