<script lang="ts">
  // The day's end, as the after-party and the awards page show it (ADR 0129): the final table with the stats we
  // track (played, won, drawn, lost, goal difference, points), the champions first; then the day's results, one line
  // a match, the score in the middle. Brass on the carbon: the page round it sets --brass and --brass-ink.
  import type { Tournament, TournamentType } from "../demo/model";
  import { PLAYERS } from "../demo/data";
  import Kanji from "./Kanji.svelte";
  import BoardTable from "./BoardTable.svelte";
  import { finalOrder } from "./afters";
  import { kanjiFor } from "./motif";
  import { nameOfTeam } from "./names";

  let { type, tournament: t }: { type: TournamentType; tournament: Tournament } = $props();

  const teams = $derived(t.teams);
  const byId = (id: number | null) => PLAYERS.find((p) => p.id === id);
  const teamIndex = (id: number | null) => teams.findIndex((x) => x.id === id);
  const teamName = (id: number | null) => nameOfTeam(teams[teamIndex(id)], teams, byId);
  const standings = $derived(finalOrder(t));
  const games = $derived([...(t.games ?? [])].sort((a, b) => a.position - b.position));
</script>

{#if standings.length}
  <section class="part">
    <h2 class="section-title">The final table<Kanji text={kanjiFor(type, "champions")} /></h2>
    <BoardTable {type} tournament={t} order={standings} />
  </section>
{/if}

{#if games.length}
  <section class="part">
    <h2 class="section-title">The results<Kanji text={kanjiFor(type, "fights")} /></h2>
    <ol class="results">
      {#each games as g (g.id)}
        {@const home = teamIndex(g.homeTeamId)}
        {@const away = teamIndex(g.awayTeamId)}
        <li>
          <a class="result" href="/tournaments/{type.slug}/games/{g.id}">
            <span class="game hint">{g.name || `Game ${g.position}`}</span>
            <span class="side home" class:lost={(g.homeGoals ?? 0) < (g.awayGoals ?? 0)}
              >{home >= 0 ? teamName(g.homeTeamId) : "–"}</span
            >
            <span class="score num">{g.homeGoals ?? "–"}–{g.awayGoals ?? "–"}</span>
            <span class="side away" class:lost={(g.awayGoals ?? 0) < (g.homeGoals ?? 0)}
              >{away >= 0 ? teamName(g.awayTeamId) : "–"}</span
            >
          </a>
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  .part {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-3);
  }
  .part .section-title {
    margin: 0;
    color: color-mix(in srgb, var(--brass-ink) 70%, var(--fg-muted));
  }
  .section-title :global(.kanji) {
    color: color-mix(in srgb, var(--brass) 45%, var(--fg-subtle));
  }
  .results {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .result {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--s-3);
    min-height: 2.75rem;
    color: var(--fg);
  }
  .results li + li .result {
    border-top: 1px solid var(--border);
  }
  .side {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .home {
    text-align: right;
  }
  .lost {
    color: var(--fg-muted);
    font-weight: 500;
  }
  .score {
    color: var(--fg);
    font-weight: 700;
  }
  .game {
    font-size: var(--text-xs);
  }
  @media (hover: hover) {
    .result:hover .side:not(.lost) {
      color: var(--brass-ink);
    }
  }
  /* A phone: the results' columns closer */
  @media (max-width: 440px) {
    .result {
      grid-template-columns: 3.25rem minmax(0, 1fr) auto minmax(0, 1fr);
      gap: var(--s-2);
    }
  }
</style>
