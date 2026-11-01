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
import { editions, type EditionBy } from "./editions.svelte";

/** Of a series' pages, the ones on their way (app/editions.svelte.ts): their pages are there, loading, till they come. */
const asked = (slug: string, by: EditionBy) =>
  editions.asking.filter((a) => a.slug === slug && a.by === by).map((a) => a.n);

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
      // Every edition's games and teams the app has, and those on their way, so a past one's links work too (#175)
      games: [
        ...db.tournaments.filter((x) => x.typeId === t.id).flatMap((x) => (x.games ?? []).map((g) => g.id)),
        ...asked(t.slug, "game"),
      ],
      past: pastTournaments(t.id).map((x) => x.id),
      editions: [...db.tournaments.filter((x) => x.typeId === t.id).map((x) => x.id), ...asked(t.slug, "tournament")],
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
        )
        .concat(asked(t.slug, "team").map((id) => ({ id, mine: false }))),
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
    // The ones the app has, and those on their way: one that isn't there (a 404) goes back to the front door
    const ids = [
      ...db.tournaments.filter((t) => t.typeId === type.id).map((t) => t.id),
      ...asked(type.slug, "tournament"),
    ];
    const to = frontDoorTo(path, type.slug, currentTournament(type.id)?.id, ids) ?? goneTo(path, type.slug);
    if (to) return to;
  }
  return null;
}

/** A game's or a team's page that isn't there (a 404, app/editions.svelte.ts): the series' front door. */
function goneTo(path: string, slug: string) {
  const gone = editions.gone.find((a) => a.slug === slug && a.by !== "tournament");
  return gone && path.startsWith(`/tournaments/${slug}/${gone.by === "game" ? "games" : "teams"}/${gone.n}`)
    ? `/tournaments/${slug}`
    : null;
}
