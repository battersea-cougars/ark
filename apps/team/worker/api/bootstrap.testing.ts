// A club of 120 with years behind it, for what opening the app costs (api.cpu.use-cases.test.ts) and what it sends
// (bootstrap.same.use-cases.test.ts): the last eight Fridays, 40 at each and all charged, a fee on the training, and
// three years of Kumites (a few a year, ADR 0009: twelve), each with its teams, logos, games, goals, penalties, awards
// and sign-ups. The bootstrap sends every tournament there has been (ADR 0053): they're what make it heavy (#175).
// For Vitest only.
import { expect } from "vitest";
import { NOW, testWorld } from "../testing";

const MEMBERS = 120;
const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  ...Array.from({ length: MEMBERS - 1 }, (_, i) => ({
    name: `Member ${i + 1}`,
    position: i % 30 === 0 ? "G" : i % 3 ? "F" : "D",
    rating: 40 + (i % 40),
    email: `m${i + 1}@example.com`,
    ...(i === 1 ? { roles: ["Session lead"] } : {}),
  })),
];

/** The club, Dana (an admin) signed in, its members' ids in name order (Dana first), and this week's Friday. */
export async function clubWithHistory(kumiteCount = 12) {
  const w = testWorld(ROSTER);
  const dana = await w.signedIn("dana@example.com");
  const boot = (await dana.call("GET", "/api/bootstrap")).body;
  const series = boot.series[0];
  expect(
    (await dana.call("PUT", `/api/series/${series.id}`, { ...series, fees: [{ pence: 800, from: "2026-01-01" }] }))
      .status,
  ).toBe(200);
  const ids: number[] = boot.members.map((m: { id: number }) => m.id).slice(1, 41);
  lastFridays(w, ids);
  kumites(w, ids, kumiteCount);
  expect((await dana.call("POST", `/api/members/${ids[0]}/payments`, { via: "cash", pence: 800 })).status).toBe(200);
  const friday: number = boot.sessions.find((s: { heldOn: string }) => s.heldOn >= "2026-10-06").id;
  return { w, dana, ids, friday };
}

/** The last eight Fridays, these forty at each. */
function lastFridays(w: ReturnType<typeof testWorld>, ids: number[]) {
  const fridays = w.db.raw
    .prepare("SELECT id FROM training_sessions WHERE held_on < ? ORDER BY held_on DESC LIMIT 8")
    .all(NOW.toISOString().slice(0, 10)) as { id: number }[];
  const insert = w.db.raw.prepare(
    "INSERT OR IGNORE INTO attendance (session_id, member_id, signup, signed_up_at, attended) VALUES (?, ?, 'in', ?, 1)",
  );
  for (const f of fridays) for (const m of ids) insert.run(f.id, m, NOW.toISOString());
}

/** A team's logo as the browser shrinks it (lib/logo.ts): a 256px WebP, about 16 KB as a data URL. */
const logo = (n: number) => `data:image/webp;base64,${Buffer.alloc(12_000, `logo${n}`).toString("base64")}`;

/**
 * Kumites (up to twelve), on the 14th of each month from January 2025: six drafted teams of the forty, each with its logo, a round robin and three playoffs, seven goals
 * and two penalties a game, four awards, and forty sign-ups. The first of `ids` captains Team 1 each time.
 */
function kumites(w: ReturnType<typeof testWorld>, ids: number[], count: number) {
  const db = w.db.raw;
  const at = NOW.toISOString();
  const tournament = db.prepare(
    `INSERT INTO tournaments (type_id, name, held_on, start_time, end_time, status, kind, draft_state, awards)
     VALUES (1, ?, ?, '11:00', '16:00', 'finished', 'draft', 'closed', (SELECT awards FROM tournaments WHERE id = 1))`,
  );
  const team = db.prepare(
    `INSERT INTO tournament_teams (tournament_id, name, logo, captain_member_id, pick, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const player = db.prepare(
    "INSERT INTO tournament_team_players (team_id, member_id, position, pick_number, picked_by) VALUES (?, ?, ?, ?, ?)",
  );
  const game = db.prepare(
    `INSERT INTO tournament_games (tournament_id, stage, round, position, name, home_team_id, away_team_id,
       home_goals, away_goals, status, period, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', 2, ?)`,
  );
  const goal = db.prepare(
    `INSERT INTO tournament_goals (game_id, team_id, scorer_member_id, assist_member_id, at_ms, period, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const penalty = db.prepare(
    `INSERT INTO tournament_penalties (game_id, team_id, member_id, minutes, infraction, at_ms, period, recorded_by,
       created_at) VALUES (?, ?, ?, 2, 'Hooking', ?, 1, ?, ?)`,
  );
  const winner = db.prepare(
    "INSERT INTO tournament_award_winners (tournament_id, award, team_id, member_id, position) VALUES (?, ?, ?, ?, 0)",
  );
  const entry = db.prepare(
    "INSERT INTO tournament_entries (tournament_id, member_id, signup, signed_up_at, attended) VALUES (?, ?, 'in', ?, 1)",
  );
  for (let n = 1; n <= count; n++) {
    const t = Number(tournament.run(`Kumite ${n}`, `2025-${String(n).padStart(2, "0")}-14`).lastInsertRowid);
    const teams = Array.from({ length: 6 }, (_, i) => {
      const id = Number(team.run(t, `Team ${i + 1}`, logo(i), ids[i], i + 1, at).lastInsertRowid);
      const squad = ids.slice(0, 48).filter((_, p) => p % 6 === i);
      squad.forEach((m, p) => player.run(id, m, p, p * 6 + i + 1, squad[0]));
      return { id, squad };
    });
    let position = 0;
    const play = (stage: string, home: (typeof teams)[number], away: (typeof teams)[number]) => {
      const name = stage === "playoff" ? "Final" : "";
      const g = Number(game.run(t, stage, 1, ++position, name, home.id, away.id, 4, 3, at).lastInsertRowid);
      for (let n = 0; n < 7; n++) {
        const side = n % 2 ? away : home;
        goal.run(
          g,
          side.id,
          side.squad[n % side.squad.length],
          side.squad[(n + 1) % side.squad.length],
          n * 90_000,
          1 + (n % 2),
          at,
        );
      }
      for (let n = 0; n < 2; n++) penalty.run(g, home.id, home.squad[n + 2], n * 120_000, ids[0], at);
    };
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) play("group", teams[a], teams[b]);
    for (let n = 0; n < 3; n++) play("playoff", teams[n], teams[n + 3]);
    winner.run(t, "Champions", teams[0].id, null);
    for (const award of ["Top scorer", "Best keeper", "The Dim Mak"]) winner.run(t, award, null, teams[1].squad[0]);
    for (const m of ids) entry.run(t, m, at);
  }
}
