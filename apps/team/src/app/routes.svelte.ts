// The live route tree: rebuilt whenever an admin adds, renames or pauses a training or tournament type.
import { can } from "../access/actions";
import { currentTournament, pastTournaments } from "../demo/schedule.svelte";
import { granted, me } from "../demo/session.svelte";
import { db } from "../demo/store.svelte";
import { DEV_TOOLS, UNFINISHED } from "../demo/data";
import { buildFolds, buildRoutes, buildTabs, routeFor, type NavConfig } from "./nav-routes";
import { navigate, router } from "./router.svelte";
import { goesBy } from "../lib/names";

const config = (): NavConfig => ({
  series: db.series,
  types: db.tournamentTypes.map((t) => ({
    ...t,
    captains: (currentTournament(t.id)?.teams ?? []).flatMap((team) => team.captainMemberId ?? []),
    onTeam: (currentTournament(t.id)?.teams ?? []).some(
      (team) => team.captainMemberId === me().id || team.players.some((p) => p.memberId === me().id),
    ),
    // Every edition's games and teams, so a past one's links work too
    games: db.tournaments.filter((x) => x.typeId === t.id).flatMap((x) => (x.games ?? []).map((g) => g.id)),
    past: pastTournaments(t.id).map((x) => x.id),
    idle: !currentTournament(t.id),
    teams: db.tournaments
      .filter((x) => x.typeId === t.id)
      .flatMap((x) => x.teams)
      .flatMap((team) =>
        team.id
          ? [
              {
                id: team.id,
                mine: team.captainMemberId === me().id || team.players.some((p) => p.memberId === me().id),
              },
            ]
          : [],
      ),
  })),
  me: me().id,
  members: db.members.filter((m) => m.status === "active").map((m) => ({ id: m.player.id, name: goesBy(m.player) })),
  devTools: DEV_TOOLS,
  unfinished: UNFINISHED,
});

export const routes = () => buildRoutes(config());
export const tabs = () => buildTabs(config());
export const folds = () => buildFolds(config());

/** After switching who the app shows (View as, back, your everyday role): stay on this page if they can see it,
 * else Home. */
export function stayIfAllowed() {
  const here = routeFor(routes(), router.path);
  if (!here || !can(granted(), here.action)) navigate("/", { replace: true });
}
