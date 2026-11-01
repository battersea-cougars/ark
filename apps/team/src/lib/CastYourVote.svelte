<script lang="ts">
  // Cast your vote (ADR 0044): on the awards' page, from the last match played till the awards are confirmed,
  // everyone who played votes for the voted awards (Best keeper: the skaters, for a keeper), one vote an award,
  // secret, never for yourself. A card that opens the ballot (lib/VoteSheet); once cast, "Your votes are in", the
  // votes there to look back at. Nothing at all for someone who didn't play, or once the awards are confirmed. At the
  // after-party the vote is on the awards' own card (lib/AwardsEntry) instead.
  import Icon from "../app/shell/Icon.svelte";
  import { PLAYERS } from "../demo/data";
  import type { Tournament, TournamentType } from "../demo/model";
  import { me } from "../demo/session.svelte";
  import DraftStep from "./DraftStep.svelte";
  import VoteSheet from "./VoteSheet.svelte";
  import { ballotOf, voteLineOf } from "./afters";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  const positionOf = (id: number) => PLAYERS.find((p) => p.id === id)?.position;
  const ballot = $derived(ballotOf(tournament, me().id, { positionOf }));
  const left = $derived(ballot.filter((b) => b.mine === null));
  let open = $state(false);
</script>

{#if ballot.length}
  <DraftStep {type} mark="awards" title={left.length ? "Cast your vote" : "Your votes are in"}>
    {left.length ? voteLineOf(left) : "Sealed till the reveal. Nobody sees who you chose. Waiting for the reveal."}
    {#snippet action()}
      <button class="btn primary" onclick={() => (open = true)}
        ><Icon name="medal" size={18} />{left.length ? "Vote" : "Your votes"}</button
      >
    {/snippet}
  </DraftStep>
  <VoteSheet {type} {tournament} {ballot} bind:open />
{/if}
