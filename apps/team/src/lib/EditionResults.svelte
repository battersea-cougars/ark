<script lang="ts">
  // A past one's results (ADR 0074), its after-party's view once that evening's over: the champions, the final, the
  // fight card, the board, the leaders, the awards. Its page (pages/Games) keeps its header and its track over them,
  // so every status it went through can still be opened.
  import type { Tournament, TournamentType } from "../demo/model";
  import Awards from "./Awards.svelte";
  import BoardTable from "./BoardTable.svelte";
  import Leaderboard from "./Leaderboard.svelte";
  import ChampionCard from "./ChampionCard.svelte";
  import FixtureRow from "./FixtureRow.svelte";
  import Kanji from "./Kanji.svelte";
  import { kanjiFor } from "./motif";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  const games = $derived([...(tournament.games ?? [])].sort((a, b) => a.position - b.position));
  const final = $derived(
    games
      .filter((g) => g.stage === "playoff")
      .reduce<(typeof games)[number] | undefined>((a, b) => (!a || b.position > a.position ? b : a), undefined),
  );
</script>

<div class="results">
  <ChampionCard {type} {tournament} />
  {#if final && final.status === "done"}
    <section class="part">
      <h2 class="section-title">The final<Kanji text={kanjiFor(type, "final")} /></h2>
      <div class="list"><FixtureRow big {tournament} game={final} /></div>
    </section>
  {/if}
  {#if games.length}
    <section class="part">
      <h2 class="section-title">Fight card<Kanji text={kanjiFor(type, "fights")} /></h2>
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
</div>

<style>
  .results {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-6);
  }
  .part {
    display: grid;
    gap: var(--s-3);
  }
  .part .section-title {
    margin: 0;
  }
</style>
