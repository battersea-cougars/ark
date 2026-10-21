<script lang="ts">
  // The table from the tournament's group games with a result (ADR 0061): points, then goal difference, then goals
  // for, with its own points for a win, draw and loss. Empty until the fixtures are made. Once it's decided, the
  // champions up top and marked in the table. Under it, the leaderboards: points, goals, assists, PIM (#47).
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import ChampionCard from "../lib/ChampionCard.svelte";
  import BoardTable from "../lib/BoardTable.svelte";
  import Leaderboard from "../lib/Leaderboard.svelte";
  import EmptyState from "../lib/EmptyState.svelte";
  import Icon from "../app/shell/Icon.svelte";

  let { typeId }: { typeId: number } = $props();

  const type = $derived(typeById(typeId)!);
  const tournament = $derived(currentTournament(typeId));
  // This tournament's own points (ADR 0030), else the series'
  const rules = $derived(tournament ?? type);
  const group = $derived((tournament?.games ?? []).filter((g) => g.stage === "group"));
</script>

<div class="page">
  <TournamentHead {type} {tournament} title="The board" />

  {#if tournament}<ChampionCard {type} {tournament} />{/if}

  {#if !group.length}
    <EmptyState icon="trophy" title="No table yet">
      It fills in from the first result: who's on top, and who's chasing. Win {rules.pointsWin}, draw {rules.pointsDraw},
      loss {rules.pointsLoss}.
      {#snippet action()}
        <a class="btn outline" href="/tournaments/{type.slug}/schedule"
          ><Icon name={type.slug === "kumite" ? "gong" : "calendar"} size={18} />The fight card</a
        >
      {/snippet}
    </EmptyState>
  {:else if tournament}
    <BoardTable {type} {tournament} />
    <p class="hint">
      Points, then goal difference, then goals for. Win {rules.pointsWin}, draw {rules.pointsDraw}, loss
      {rules.pointsLoss}: set under Settings → Tournaments.
    </p>
    <h2 class="section-title">Leaders</h2>
    <Leaderboard games={tournament.games ?? []} {tournament} />
  {/if}
</div>
