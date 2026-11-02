<script lang="ts">
  // A series' past ones (apps/team/worker/tournaments/README.md), newest first, while the next one's on or coming up,
  // each opening its own page; under them, the all-time leaderboards. Both read when opened, the list a page at a time:
  // the app has only the last one played.
  import EmptyState from "../lib/EmptyState.svelte";
  import { pastTournaments, typeById } from "../demo/schedule.svelte";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import Kanji from "../lib/Kanji.svelte";
  import PastEditions from "../lib/PastEditions.svelte";
  import AllTimeLeaders from "../lib/AllTimeLeaders.svelte";
  import { kanjiFor } from "../lib/motif";

  let { typeId }: { typeId: number } = $props();

  const type = $derived(typeById(typeId)!);
  const past = $derived(pastTournaments(typeId));
</script>

<div class="page">
  <TournamentHead
    {type}
    title="History"
    note="Every {type.shortName} so far, and who won it."
    back={{ href: `/tournaments/${type.slug}` }}
  />

  {#if !past.length}
    <EmptyState icon="swords" title="No history yet">The first one's history in the making.</EmptyState>
  {:else}
    <h2 class="section-title">Past {type.shortName}s<Kanji text={kanjiFor(type, "martial")} /></h2>
    <PastEditions {type} />
    <h2 class="section-title">All-time leaders</h2>
    <AllTimeLeaders {typeId} />
  {/if}
</div>
