<script lang="ts">
  // The after-party (ADR 0074): the evening a tournament ends, its last status. Everyone's at the afterwards (the
  // Kumite's The Anchor), so the page is the pub after the film's last match: warm brass on the carbon, the Kumite's
  // motif kept. Where everyone is; the awards, a big card to their own page (pages/Awards, the stage where they're
  // revealed one at a time), with everyone who played voting on it and whoever runs it confirming them on it too
  // (lib/AwardsEntry, ADR 0044); then the final table (the champions first) and the day's
  // results, one line each.
  import type { Tournament, TournamentType } from "../demo/model";
  import type { After } from "@cougars/shared/places";
  import { PLAYERS } from "../demo/data";
  import Icon from "../app/shell/Icon.svelte";
  import Kanji from "./Kanji.svelte";
  import BoardTable from "./BoardTable.svelte";
  import { finalOrder } from "./afters";
  import AwardsEntry from "./AwardsEntry.svelte";
  import { kanjiFor } from "./motif";
  import { nameOfTeam } from "./names";
  import { afterNoteWords } from "./tournament-front";
  import { clock } from "./dates";

  let {
    type,
    tournament: t,
    after,
    manage,
  }: {
    type: TournamentType;
    tournament: Tournament;
    /** Where everyone is: the afterwards, or none this time. */
    after: After | null;
    /** Whoever runs it (manage:Tournament): the reveal is theirs. */
    manage: boolean;
  } = $props();

  const teams = $derived(t.teams);
  const byId = (id: number | null) => PLAYERS.find((p) => p.id === id);
  const teamIndex = (id: number | null) => teams.findIndex((x) => x.id === id);
  const teamName = (id: number | null) => nameOfTeam(teams[teamIndex(id)], teams, byId);
  const standings = $derived(finalOrder(t));
  const games = $derived([...(t.games ?? [])].sort((a, b) => a.position - b.position));
  const sub = $derived(
    after
      ? [afterNoteWords(after.note) || "celebration and awards", after.time && `from ${clock(after.time)}`]
          .filter(Boolean)
          .join(" · ")
      : "",
  );
</script>

<div class="afters">
  <!-- Where everyone is now: the place big, what for, the map -->
  <section class="part pub">
    <span class="eyebrow">Now</span>
    <div class="pub-body">
      <span class="pub-place display"
        ><Icon name="glass" size={24} />{after?.name ?? `After the ${type.shortName}`}</span
      >
      <span class="pub-sub">{sub || "Everyone's done. Get a round in."}</span>
      {#if after}
        <a class="btn sm outline" href={after.mapUrl} target="_blank" rel="noopener noreferrer"
          ><Icon name="pin" size={16} />Map</a
        >
      {/if}
    </div>
  </section>

  <!-- The awards: voted and confirmed here, on one card, revealed on their own page, the stage -->
  <AwardsEntry {type} tournament={t} {manage} />

  {#if standings.length}
    <!-- The table with the stats we track (played, won, drawn, lost, goal difference, points), the champions first -->
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
</div>

<style>
  /* The pub after the last fight: brass on the carbon, a warm glow over the top of the view in place of the red */
  .afters {
    --brass: #d9a84e;
    --brass-ink: #f0c879;
    --brass-wash: color-mix(in srgb, var(--brass) 10%, transparent);
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-6);
  }
  /* The glow fades to nothing inside its own box on every side (the mask), and the box stays inside the page's
     sides (.view clips across), so it reads as warm light with no edge on a phone or a desktop */
  .afters::before {
    position: absolute;
    inset: -4rem -1rem auto;
    z-index: -1;
    height: 26rem;
    background: radial-gradient(60% 55% at 32% 40%, color-mix(in srgb, var(--brass) 15%, transparent), transparent 75%);
    content: "";
    pointer-events: none;
    mask-image: radial-gradient(closest-side, #000 55%, transparent);
  }
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

  /* Where everyone is: on the page, no panel */
  .pub {
    gap: var(--s-1);
  }
  .pub .eyebrow {
    color: var(--brass-ink);
  }
  .pub-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-1) var(--s-4);
  }
  .pub-place {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    color: var(--fg);
    font-size: clamp(1.9rem, 6vw, 2.6rem);
    line-height: 1;
  }
  .pub-place :global(svg) {
    flex: none;
    color: var(--brass);
  }
  .pub-sub {
    grid-column: 1;
    color: var(--fg-muted);
  }
  .pub-body .btn {
    grid-row: 1 / span 2;
    grid-column: 2;
    gap: var(--s-1);
  }

  .results {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* The day's results: one line a match, the score in the middle */
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
