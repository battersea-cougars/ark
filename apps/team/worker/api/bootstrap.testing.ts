// A club of 120 with years behind it, for what opening the app costs (api.cpu.use-cases.test.ts) and what it sends
// (bootstrap.same.use-cases.test.ts): the last eight Fridays, 40 at each and all charged, a fee on the training, and
// three years of Kumites (a few a year, ADR 0009: twelve), each with its teams, logos, games, goals, penalties, awards
// and sign-ups. They made the bootstrap heavy when it sent every one (#175); now it sends the next one and the
// last one played, and the rest are read when they're opened (tournaments/editions.ts). For Vitest only.
import { expect } from "vitest";
import { NOW, testWorld } from "../testing";
import {
  KUMITE_ID_TABLES,
  KUMITE_TABLES,
  NEXT_IDS_SQL,
  idsFrom,
  insertsSql,
  kumiteRows,
} from "../../../../scripts/lib/history.rows.mjs";

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
 * and two penalties a game, four awards, and forty sign-ups. The first of `ids` captains Team 1 each time. Written as
 * `npm run seed:history` writes its Kumites (scripts/lib/history.rows.mjs).
 */
function kumites(w: ReturnType<typeof testWorld>, ids: number[], count: number) {
  const db = w.db.raw;
  const at = NOW.toISOString();
  const { awards } = db.prepare("SELECT awards FROM tournaments WHERE id = 1").get() as { awards: string };
  const nextId = idsFrom(db.prepare(NEXT_IDS_SQL(KUMITE_ID_TABLES)).get() as Record<string, number>);
  const tables: Record<string, object[]> = {};
  for (let n = 1; n <= count; n++) {
    const squads = Array.from({ length: 6 }, (_, i) => ids.slice(0, 48).filter((_, p) => p % 6 === i));
    const teams = squads.map((squad, i) => ({
      name: `Team ${i + 1}`,
      logo: logo(i),
      captain_member_id: ids[i],
      pick: i + 1,
      created_at: at,
      players: squad.map((m, p) => ({ member_id: m, position: p, pick_number: p * 6 + i + 1, picked_by: squad[0] })),
    }));
    const games: Record<string, unknown>[] = [];
    const play = (stage: string, home: number, away: number) =>
      games.push({
        stage,
        round: 1,
        position: games.length + 1,
        name: stage === "playoff" ? "Final" : "",
        home,
        away,
        home_goals: 4,
        away_goals: 3,
        status: "done",
        period: 2,
        started_at: at,
        goals: Array.from({ length: 7 }, (_, g) => {
          const [side, squad] = g % 2 ? ["away", squads[away]] : ["home", squads[home]];
          return {
            side,
            scorer_member_id: squad[g % squad.length],
            assist_member_id: squad[(g + 1) % squad.length],
            at_ms: g * 90_000,
            period: 1 + (g % 2),
            created_at: at,
          };
        }),
        penalties: [0, 1].map((p) => ({
          side: "home",
          member_id: squads[home][p + 2],
          minutes: 2,
          infraction: "Hooking",
          at_ms: p * 120_000,
          period: 1,
          recorded_by: ids[0],
          created_at: at,
        })),
      });
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) play("group", a, b);
    for (let i = 0; i < 3; i++) play("playoff", i, i + 3);
    kumiteRows(
      {
        tournament: {
          type_id: 1,
          name: `Kumite ${n}`,
          held_on: `2025-${String(n).padStart(2, "0")}-14`,
          start_time: "11:00",
          end_time: "16:00",
          status: "finished",
          kind: "draft",
          draft_state: "closed",
          awards,
        },
        teams,
        games,
        winners: [
          { award: "Champions", team: 0, member_id: null, position: 0 },
          ...["Top scorer", "Best keeper", "The Dim Mak"].map((award) => ({
            award,
            team: null,
            member_id: squads[1][0],
            position: 0,
          })),
        ],
        entries: ids.map((m) => ({ member_id: m, signup: "in", signed_up_at: at, attended: 1 })),
      },
      nextId,
      tables,
    );
  }
  db.exec(insertsSql(tables, KUMITE_TABLES));
}
