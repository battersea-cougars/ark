<script lang="ts">
  // One past tournament, in full (ADR 0074), reached from History (or from the series' front page when nothing's on):
  // its day in the header, the champions, the final, every fight, the board, the awards. Back goes where the list is.
  import EmptyState from "../lib/EmptyState.svelte";
  import { db } from "../demo/store.svelte";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import Awards from "../lib/Awards.svelte";
  import BoardTable from "../lib/BoardTable.svelte";
  import Leaderboard from "../lib/Leaderboard.svelte";
  import ChampionCard from "../lib/ChampionCard.svelte";
  import FixtureRow from "../lib/FixtureRow.svelte";
  import Kanji from "../lib/Kanji.svelte";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import { kanjiFor } from "../lib/motif";

  let { typeId, tournamentId }: { typeId: number; tournamentId: number } = $props();

  const type = $derived(typeById(typeId)!);
  const tournament = $derived(db.tournaments.find((t) => t.id === tournamentId));
  // The list of them all: History while the next one's on or coming up, else the front page
  const back = $derived(`/tournaments/${type.slug}${currentTournament(typeId) ? "/history" : ""}`);
  const games = $derived([...(tournament?.games ?? [])].sort((a, b) => a.position - b.position));
  const final = $derived(
    games
      .filter((g) => g.stage === "playoff")
      .reduce<(typeof games)[number] | undefined>((a, b) => (!a || b.position > a.position ? b : a), undefined),
  );
</script>

<div class="page">
  <TournamentHead {type} {tournament} title="History" />
  <a class="back" href={back}><Icon name="chevronLeft" size={16} />All {type.shortName}s</a>

  {#if !tournament}
    <EmptyState icon="alert" title="Not found">There's no such {type.shortName}. Try the list of them all.</EmptyState>
  {:else}
    <ChampionCard {type} {tournament} />
    {#if final && final.status === "done"}
      <section class="part">
        <h2 class="section-title">The final<Kanji text={kanjiFor(type, "final")} /></h2>
        <div class="list"><FixtureRow big {tournament} game={final} /></div>
      </section>
    {/if}
    {#if games.length}
      <section class="part">
        <h2 class="section-title">Every fight<Kanji text={kanjiFor(type, "fights")} /></h2>
        <div class="list">
          {#each games as g (g.id)}
            <FixtureRow {tournament} game={g} />
          {/each}
        </div>
      </section>
      <section class="part">
        <h2 class="section-title">The board</h2>
        <BoardTable {type} {tournament} />
      </section>
      <section class="part">
        <h2 class="section-title">Leaders</h2>
        <Leaderboard games={tournament.games ?? []} {tournament} />
      </section>
    {/if}
    <Awards {tournament} />
  {/if}
</div>

<style>
  .back {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: var(--s-1);
    margin-bottom: calc(-1 * var(--s-2));
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .back:hover {
    color: var(--fg);
  }
  .part {
    display: grid;
    gap: var(--s-3);
  }
  .part .section-title {
    margin: 0;
  }
</style>
