// The first Kumite as the club seed used to schedule it (ADR 0109): planned for next summer, its day not set yet. The
// seed schedules none now, so the test worlds that start with one add it. For Vitest only.
export const FIRST_KUMITE_SQL = `INSERT INTO tournaments (id, type_id, name, location, held_on, start_time, end_time, capacity,
  status, champions, fee_pence, public, signup_closes_on, draft_on, season, points_win, points_draw, points_loss,
  game_minutes, kind, awards) VALUES
  (1, 1, 'The Cougars Kumite', '', '2027-08-31', '11:00', '16:00', NULL, 'planned', NULL, 0, 1, NULL, NULL, 'summer', 3, 1,
  0, 12, 'draft', '[{"name":"Champions","about":"The team on top of the table at the end of the day."},{"name":"Top scorer","about":"Most goals across every game."},{"name":"Best goalie","about":"Voted by the skaters they stopped."},{"name":"The Dim Mak","about":"Fastest goal from a faceoff. One touch. Lights out."}]')`;
