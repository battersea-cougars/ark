<script lang="ts">
  // The way to the awards from the after-party (ADR 0074): one big card. Before they're confirmed, whoever runs it
  // confirms them here (how many have voted, what's still to choose); everyone else's waiting. Then where the reveal's
  // at, and the way to its page, the stage (pages/Awards).
  import type { Tournament, TournamentType } from "../demo/model";
  import { PLAYERS } from "../demo/data";
  import Icon from "../app/shell/Icon.svelte";
  import { enterAwards } from "./AwardsDrawer.svelte";
  import DraftStep from "./DraftStep.svelte";
  import { revealOf, toConfirmOf } from "./afters";

  let { type, tournament: t, manage }: { type: TournamentType; tournament: Tournament; manage: boolean } = $props();

  const reveal = $derived(revealOf(t));
  const href = $derived(`/tournaments/${type.slug}/awards`);
  const positionOf = (id: number) => PLAYERS.find((p) => p.id === id)?.position;
  const toConfirm = $derived(toConfirmOf(t, { positionOf }));
  const line = $derived.by(() => {
    if (!reveal.confirmed)
      return manage
        ? `${toConfirm || "Check them"}. Confirming closes voting; then the reveal, one card at a time.`
        : "Waiting for the reveal. One card at a time, everyone watching.";
    if (reveal.all) return "Every award's out.";
    if (reveal.revealed) return `${reveal.revealed} of ${reveal.awards.length} out. Everyone's watching.`;
    return "Confirmed. The reveal, one card at a time, everyone watching.";
  });
</script>

{#if reveal.awards.length}
  <DraftStep {type} mark="awards" title="The awards">
    {line}
    {#snippet action()}
      {#if manage && !reveal.confirmed}
        <button class="btn primary" onclick={() => enterAwards(t.id)}
          ><Icon name="medal" size={18} />Confirm the awards</button
        >
        <a class="btn outline" {href}>The awards</a>
      {:else}
        <a class="btn primary" {href}><Icon name="medal" size={18} />{reveal.all ? "The winners" : "The awards"}</a>
      {/if}
    {/snippet}
  </DraftStep>
{/if}
