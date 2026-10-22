// The Kumite simulator (ADR 0123): dev only. Not there at all in production, or wherever the environment doesn't
// say it's dev or your own machine (simulate.ts simulatorHere; api.ts leaves the route out, so it's a 404).
import { id, rowOf, type Route } from "../api/api.route";
import { HttpError, json } from "../api/api.http";
import { simulate, simulatorHere } from "./simulate";

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
    // The draft closing takes its night off the agenda, so the agenda comes too
    // A few moves on towards the after-party, and whether there's more: the app asks again till it's done
    handle: async (c) => {
      // The router leaves it out elsewhere; and should it ever be mounted without that, it still isn't there
      if (!simulatorHere(c.env)) throw new HttpError(404, "Not found.");
      return json(await simulate(c.env.DB, id(c), c, new Date(c.now)));
    },
  },
];
