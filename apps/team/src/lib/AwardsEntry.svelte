<script lang="ts">
  // The awards at the after-party (ADR 0074): one big card for everyone. Before they're confirmed, everyone who played
  // votes on it (Vote opens the ballot, lib/VoteSheet), and whoever runs it confirms them on it too (how many have
  // voted, what's still to choose); anyone else is waiting. Then where the reveal's at. Always the way to the awards'
  // own page, the stage (pages/Awards).
  import type { Tournament, TournamentType } from "../demo/model";
  import { PLAYERS } from "../demo/data";
  import { me } from "../demo/session.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { enterAwards } from "./AwardsDrawer.svelte";
  import DraftStep from "./DraftStep.svelte";
  import VoteSheet from "./VoteSheet.svelte";
  import { ballotOf, revealOf, toConfirmOf, voteLineOf } from "./afters";

  let { type, tournament: t, manage }: { type: TournamentType; tournament: Tournament; manage: boolean } = $props();

  const reveal = $derived(revealOf(t));
  const href = $derived(`/tournaments/${type.slug}/awards`);
  const positionOf = (id: number) => PLAYERS.find((p) => p.id === id)?.position;
  const toConfirm = $derived(toConfirmOf(t, { positionOf }));
  const ballot = $derived(ballotOf(t, me().id, { positionOf }));
  const left = $derived(ballot.filter((b) => b.mine === null));
  const confirming = $derived(manage && !reveal.confirmed);
  let voting = $state(false);
  const line = $derived.by(() => {
    if (!reveal.confirmed) {
      const yours = left.length ? voteLineOf(left) : ballot.length ? "Your votes are in, sealed till the reveal." : "";
      const theirs = confirming
        ? `${toConfirm || "Check them"}. Confirming closes voting; then the reveal, one card at a time.`
        : yours
          ? ""
          : "Waiting for the reveal. One card at a time, everyone watching.";
      return [yours, theirs].filter(Boolean).join(" ");
    }
    if (reveal.all) return "Every award's out.";
    if (reveal.revealed) return `${reveal.revealed} of ${reveal.awards.length} out. Everyone's watching.`;
    return "Confirmed. The reveal, one card at a time, everyone watching.";
  });
</script>

{#if reveal.awards.length}
  <DraftStep {type} mark="awards" title={left.length ? "Cast your vote" : "The awards"}>
    {line}
    {#snippet action()}
      <!-- The one main button: your vote first, while you've one to cast; then confirming, for whoever runs it; else
           the awards' page -->
      {#if left.length}
        <button class="btn primary" onclick={() => (voting = true)}><Icon name="medal" size={18} />Vote</button>
      {/if}
      {#if confirming}
        <button class="btn {left.length ? 'outline' : 'primary'}" onclick={() => enterAwards(t.id)}
          ><Icon name="check" size={18} />Confirm the awards</button
        >
      {/if}
      {#if left.length || confirming}
        <a class="btn ghost" {href}>The awards</a>
      {:else}
        <a class="btn primary" {href}><Icon name="medal" size={18} />{reveal.all ? "The winners" : "The awards"}</a>
      {/if}
    {/snippet}
  </DraftStep>
  {#if ballot.length}<VoteSheet {type} tournament={t} {ballot} bind:open={voting} />{/if}
{/if}
