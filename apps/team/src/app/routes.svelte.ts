// The live route tree: rebuilt whenever an admin adds, renames or pauses a training or tournament type.
import { can } from "../access/actions";
import { currentTournament, pastTournaments } from "../demo/schedule.svelte";
import { granted, me } from "../demo/session.svelte";
import { db } from "../demo/store.svelte";
import { DEV_TOOLS, UNFINISHED } from "../demo/data";
import { buildFolds, buildRoutes, buildTabs, routeFor, type NavConfig } from "./nav-routes";
import { navigate, router } from "./router.svelte";
import { goesBy } from "../lib/names";
import { stageOf } from "../lib/edition";
import { frontDoorTo } from "../lib/edition-address";

const config = (): NavConfig => ({
  series: db.series,
  types: db.tournamentTypes.map((t) => {
    const next = currentTournament(t.id);
    return {
      ...t,
      captains: (next?.teams ?? []).flatMap((team) => team.captainMemberId ?? []),
      onTeam: (next?.teams ?? []).some(
        (team) => team.captainMemberId === me().id || team.players.some((p) => p.memberId === me().id),
      ),
      // Every edition's games and teams, so a past one's links work too
      games: db.tournaments.filter((x) => x.typeId === t.id).flatMap((x) => (x.games ?? []).map((g) => g.id)),
      past: pastTournaments(t.id).map((x) => x.id),
      editions: db.tournaments.filter((x) => x.typeId === t.id).map((x) => x.id),
      idle: !next,
      stage: next && stageOf(next),
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
    };
  }),
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

/**
 * Where a series' address goes now (lib/edition-address.ts): with one on, its front door (and its old status
 * addresses: pushes, Home's cards, emails) opens that one's own address, so the address always says which one; an
 * edition that's gone, the front door. Null: stay.
 */
export function editionAddressOf(path: string): string | null {
  for (const type of db.tournamentTypes) {
    const editions = db.tournaments.filter((t) => t.typeId === type.id).map((t) => t.id);
    const to = frontDoorTo(path, type.slug, currentTournament(type.id)?.id, editions);
    if (to) return to;
  }
  return null;
}
