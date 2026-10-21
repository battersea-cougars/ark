<script lang="ts">
  // A series' past ones (ADR 0074), newest first, while the next one's on or coming up; with nothing on, they're on the
  // series' front page instead. Each opens its own page (Edition): the champions, every fight, the board, the awards.
  // Under them, the all-time leaderboards over every edition played (#47).
  import EmptyState from "../lib/EmptyState.svelte";
  import { pastTournaments, typeById } from "../demo/schedule.svelte";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import Kanji from "../lib/Kanji.svelte";
  import PastEditions from "../lib/PastEditions.svelte";
  import Leaderboard from "../lib/Leaderboard.svelte";
  import { kanjiFor } from "../lib/motif";

  let { typeId }: { typeId: number } = $props();

  const type = $derived(typeById(typeId)!);
  const past = $derived(pastTournaments(typeId));
  const allGames = $derived(past.flatMap((t) => t.games ?? []));
</script>

<div class="page">
  <TournamentHead {type} title="History" note="Every {type.shortName} so far, and who won it." />

  {#if !past.length}
    <EmptyState icon="swords" title="No history yet">The first one's history in the making.</EmptyState>
  {:else}
    <h2 class="section-title">Past {type.shortName}s<Kanji text={kanjiFor(type, "martial")} /></h2>
    <PastEditions {type} {past} />
    <h2 class="section-title">All-time leaders</h2>
    <Leaderboard games={allGames} label="All-time leaders" />
  {/if}
</div>
