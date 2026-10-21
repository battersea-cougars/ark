<script lang="ts">
  // A tournament's full schedule (ADR 0061): every game in the day's order, the round robin then the playoffs (which
  // show their places, 1st v 2nd, until the table fills them in), each the same card as on the Kumite's home. Admins
  // make the fixtures (again, until a game has a result); goal by goal, with the clock, is live scoring.
  import { clock } from "../lib/dates";
  import EmptyState from "../lib/EmptyState.svelte";
  import { can } from "../access/actions";
  import { granted } from "../demo/session.svelte";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import { makeFixtures } from "../app/backend.svelte";
  import { BREAK_MINUTES } from "../lib/fixtures";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import GameCard from "../lib/GameCard.svelte";

  let { typeId }: { typeId: number } = $props();

  const perms = $derived(granted());
  const type = $derived(typeById(typeId)!);
  const tournament = $derived(currentTournament(typeId));
  const teams = $derived(tournament?.teams ?? []);
  const games = $derived(tournament?.games ?? []);
  // Two teams are enough to make the fixtures: a draft's captains are its teams before anyone's picked (ADR 0060)
  const teamsSet = $derived(!!tournament && teams.length >= 2);
  const hasResult = $derived(games.some((g) => g.homeGoals !== null));
  const manage = $derived(can(perms, "manage:Tournament"));
  // The day's games in two groups, each under a header that sticks as its cards scroll: the round robin (its cards
  // needn't each say so), then the playoffs (each card keeps its name: Semi-final, Final)
  const groups = $derived.by(() => {
    const sorted = [...games].sort((a, b) => a.position - b.position);
    return [
      { name: "Round robin", games: sorted.filter((g) => g.stage !== "playoff") },
      { name: "Playoffs", games: sorted.filter((g) => g.stage === "playoff") },
    ].filter((x) => x.games.length);
  });
  const then = $derived(
    tournament?.playoffs.length ? `, then ${tournament.playoffs.map((p) => p.name).join(" and ")}` : "",
  );
</script>

<div class="page">
  <TournamentHead {type} {tournament} title="Fight card" />

  {#if tournament && games.length}
    <div class="head">
      <p class="hint num">
        {tournament.gameMinutes}-minute games, {BREAK_MINUTES} minutes between, from {clock(tournament.startTime)}
      </p>
      {#if manage && !hasResult}
        <button class="btn ghost sm" onclick={() => makeFixtures(tournament.id)}>Make them again</button>
      {/if}
    </div>
    <!-- Every game in the day's order, each the same card as on the Kumite's home, grouped by stage -->
    {#each groups as group (group.name)}
      <section class="group">
        <h2 class="section-title group-head">{group.name}</h2>
        <div class="cards">
          {#each group.games as g (g.id)}<GameCard {tournament} game={g} grouped />{/each}
        </div>
      </section>
    {/each}
  {:else if tournament && teamsSet && manage}
    <div class="panel pad make">
      <p>{teams.length} teams. Make the fixtures: every team plays every other once{then}.</p>
      <button class="btn primary sm" onclick={() => makeFixtures(tournament.id)}>Make the fixtures</button>
    </div>
  {:else}
    <EmptyState icon={type.slug === "kumite" ? "gong" : "calendar"} title="No fight card yet">
      It's made once the teams are in: a round robin, {(tournament ?? type).gameMinutes}-minute games{then}.
    </EmptyState>
  {/if}
</div>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .head p {
    margin: 0;
  }
  /* A group's header sticks under the app's bar while its cards pass, on the docked header's frosted ground */
  .group-head {
    position: sticky;
    top: var(--chrome-h, 0px);
    z-index: 2;
    margin: 0;
    padding-block: var(--s-3);
    background: var(--chrome-bg-solid);
    backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
  }
  .cards {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-3);
  }
  .make {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .make p {
    margin: 0;
  }
</style>
