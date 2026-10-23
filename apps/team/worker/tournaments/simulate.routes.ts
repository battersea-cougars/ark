// The Kumite simulator (ADR 0123): dev only. Not there at all in production, or wherever the environment doesn't
// say it's dev or your own machine (simulate.ts simulatorHere; api.ts leaves the route out, so it's a 404).
import { id, rowOf, type Route } from "../api/api.route";
import { body, HttpError, json } from "../api/api.http";
import { simulateMoves, simulatorHere } from "./simulate";
import { setUpPastDay } from "./past-day";

export const SIMULATE_ROUTES: Route[] = [
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/simulate$/,
    only: simulatorHere,
    // Like any admin job on a tournament
    action: "manage:Tournament",
    // How far it's played, before and after: on the record when a request closes the draft, makes the fixtures or
    // finishes a match (one read each side, so a request keeps inside its D1 queries), not for every goal
    audit: {
      event: "tournament.simulated",
      subject: rowOf(
        `SELECT t.id, t.name, t.draft_state draftState,
                (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = t.id) games,
                (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = t.id AND status = 'done') played
         FROM tournaments t WHERE t.id = ?`,
      ),
    },
    changes: ["tournaments"],
    // One move on towards the after-party (or `{ moves: n }`, up to a few, as many as fit: Spin kick), what the last
    // was, how many, and whether there's more: the app asks again, paced (lib/simulation.ts), till it's done
    handle: async (c) => {
      // The router leaves it out elsewhere; and should it ever be mounted without that, it still isn't there
      if (!simulatorHere(c.env)) throw new HttpError(404, "Not found.");
      const asked = await body(c.request).catch(() => ({}) as Record<string, unknown>);
      // `onItsDay`: a Kumite dated in the past, played on that evening and on through its awards (on-its-day.ts)
      return json(
        await simulateMoves(c.env.DB, id(c), c, new Date(c.now), Number(asked.moves ?? 1), asked.onItsDay === true),
      );
    },
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/past-day$/,
    only: simulatorHere,
    action: "manage:Tournament",
    // What was made: the Kumite on its day, its captains and who signed up (nothing before: it's new)
    audit: {
      event: "tournament.past_day",
      subject: rowOf(
        `SELECT t.id, t.name, t.held_on heldOn, t.draft_state draftState,
                (SELECT COUNT(*) FROM tournament_teams WHERE tournament_id = t.id) teams,
                (SELECT COUNT(*) FROM tournament_entries WHERE tournament_id = t.id AND signup = 'in') signedUp
         FROM tournaments t WHERE t.id = ?`,
      ),
    },
    changes: ["tournaments"],
    // { typeId, heldOn }: a Kumite on a day gone by, signed up for, its captains named; then the app plays it out on
    // that evening (`simulate` with `onItsDay`), to its awards, so it's history with a whole evening behind it
    handle: async (c) => {
      if (!simulatorHere(c.env)) throw new HttpError(404, "Not found.");
      return json(await setUpPastDay(c.env.DB, await body(c.request), c.today), 201);
    },
  },
];
