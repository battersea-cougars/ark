import { describe, expect, it } from "vitest";
import { createTestD1 } from "@cougars/shared/testing/d1-sqlite";
import { ROSTER_SQL } from "./roster-sql.mjs";

describe("the website roster's record", () => {
  it("counts sessions and tournaments each Cougar played, this year and in all", () => {
    const db = createTestD1().raw;
    const member = db.prepare(
      "INSERT INTO members (name, cougar, status, joined_on, created_at) VALUES (?, ?, ?, '2025-01-01', '2025-01-01')",
    );
    const sam = Number(member.run("Sam Jones", 1, "active").lastInsertRowid);
    member.run("Fri Day", 0, "active");
    member.run("Old Timer", 1, "inactive");
    const friday = db.prepare("SELECT id FROM training_series WHERE slug = 'friday'").get().id;
    const session = db.prepare("INSERT INTO training_sessions (series_id, held_on, cancelled_at) VALUES (?, ?, ?)");
    const year = new Date().getFullYear();
    const lastYear = Number(session.run(friday, `${year - 1}-06-06`, null).lastInsertRowid);
    const thisYear = Number(session.run(friday, `${year}-01-10`, null).lastInsertRowid);
    const noShow = Number(session.run(friday, `${year}-01-17`, null).lastInsertRowid);
    const cancelled = Number(session.run(friday, `${year}-01-24`, `${year}-01-20T09:00:00Z`).lastInsertRowid);
    const out = Number(session.run(friday, `${year}-01-31`, null).lastInsertRowid);
    const answer = db.prepare(
      "INSERT INTO attendance (session_id, member_id, signup, signed_up_at, attended) VALUES (?, ?, ?, '2025-01-01', ?)",
    );
    answer.run(lastYear, sam, "in", 1);
    answer.run(thisYear, sam, "in", null); // signed up, register not taken: counts
    answer.run(noShow, sam, "in", 0);
    answer.run(cancelled, sam, "in", null);
    answer.run(out, sam, "out", null);
    const kumite = db.prepare("SELECT id FROM tournament_types WHERE slug = 'kumite'").get().id;
    const t = db
      .prepare(
        "INSERT INTO tournaments (type_id, name, held_on, start_time, end_time) VALUES (?, ?, ?, '11:00', '16:00')",
      )
      .run(kumite, "Spring Kumite", `${year - 1}-04-01`).lastInsertRowid;
    db.prepare(
      "INSERT INTO tournament_entries (tournament_id, member_id, signup, signed_up_at, attended) VALUES (?, ?, 'in', '2025-01-01', 1)",
    ).run(t, sam);

    expect(db.prepare(ROSTER_SQL).all()).toEqual([
      expect.objectContaining({ name: "Sam Jones", sessions: 2, season: 1, tournaments: 1 }),
    ]);
  });

  it("counts goals, assists, penalty minutes and titles from tournaments on the website only: public and done (ADR 0100)", () => {
    const db = createTestD1().raw;
    const member = db.prepare(
      "INSERT INTO members (name, cougar, status, joined_on, created_at) VALUES (?, 1, 'active', '2025-01-01', '2025-01-01')",
    );
    const sam = Number(member.run("Sam Jones").lastInsertRowid);
    const dee = Number(member.run("Dee Fence").lastInsertRowid);
    /** A tournament where Sam captains one team against Dee's, with one game in the state given. */
    const cup = (name, { isPublic = 1, game = "done" } = {}) => {
      const t = Number(
        db
          .prepare(
            `INSERT INTO tournaments (name, held_on, start_time, end_time, public)
             VALUES (?, '2026-09-12', '10:00', '15:00', ?)`,
          )
          .run(name, isPublic).lastInsertRowid,
      );
      const team = db.prepare(
        "INSERT INTO tournament_teams (tournament_id, name, captain_member_id, created_at) VALUES (?, ?, ?, '2026-01-01')",
      );
      const ours = Number(team.run(t, "Ours", sam).lastInsertRowid);
      const theirs = Number(team.run(t, "Theirs", dee).lastInsertRowid);
      const g = Number(
        db
          .prepare(
            `INSERT INTO tournament_games (tournament_id, stage, round, position, home_team_id, away_team_id, status)
             VALUES (?, 'group', 1, 1, ?, ?, ?)`,
          )
          .run(t, ours, theirs, game).lastInsertRowid,
      );
      const goal = (teamId, scorer, assist = null) =>
        db
          .prepare(
            `INSERT INTO tournament_goals (game_id, team_id, scorer_member_id, assist_member_id, created_at)
             VALUES (?, ?, ?, ?, '2026-01-01')`,
          )
          .run(g, teamId, scorer, assist);
      const champions = (teamId) =>
        db
          .prepare("INSERT INTO tournament_award_winners (tournament_id, award, team_id) VALUES (?, 'Champions', ?)")
          .run(t, teamId);
      const penalty = (teamId, memberId, minutes) =>
        db
          .prepare(
            `INSERT INTO tournament_penalties (game_id, team_id, member_id, minutes, infraction, created_at)
             VALUES (?, ?, ?, ?, 'tripping', '2026-01-01')`,
          )
          .run(g, teamId, memberId, minutes);
      return { ours, theirs, goal, champions, penalty };
    };

    const summer = cup("Summer Cup");
    summer.goal(summer.ours, sam);
    summer.goal(summer.ours, sam);
    summer.goal(summer.theirs, dee, null);
    summer.goal(summer.ours, null, sam); // a goal nobody named the scorer of, Sam's assist
    summer.champions(summer.ours);
    summer.penalty(summer.ours, sam, 2);
    summer.penalty(summer.ours, sam, 5);
    summer.penalty(summer.theirs, null, 2); // a bench penalty: nobody's
    // Kept off the website, and one still being played: neither counts
    const members = cup("Members' Cup", { isPublic: 0 });
    members.goal(members.ours, sam);
    members.champions(members.ours);
    const today = cup("Today's Cup", { game: "live" });
    today.goal(today.ours, sam);
    today.penalty(today.ours, sam, 2);
    members.penalty(members.ours, dee, 2);

    const rows = Object.fromEntries(
      db
        .prepare(ROSTER_SQL)
        .all()
        .map((r) => [r.name, r]),
    );
    expect(rows["Sam Jones"]).toMatchObject({ goals: 2, assists: 1, titles: 1, pim: 7 });
    expect(rows["Dee Fence"]).toMatchObject({ goals: 1, assists: 0, titles: 0, pim: 0 });
  });
});
