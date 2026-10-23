<script lang="ts">
  // Cast your vote (ADR 0044): from the last match played till the awards are confirmed, everyone who played votes
  // for the voted awards (Best goalie: the skaters, for a goalie), one vote an award, secret, never for yourself. A
  // card on the Kumite page (the after-party, and the KUMITE! day once it's done) opens one sheet: each award, its
  // line, and who you can vote for, a row each. Cast, they're in; a vote's yours to see, and only yours. Nothing at
  // all for someone who didn't play, or once the awards are confirmed (then it's Waiting for the reveal).
  import { castVotes } from "../app/backend.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { PLAYERS } from "../demo/data";
  import type { Tournament, TournamentType } from "../demo/model";
  import { me } from "../demo/session.svelte";
  import DraftStep from "./DraftStep.svelte";
  import PeopleChoice from "./PeopleChoice.svelte";
  import Sheet from "./Sheet.svelte";
  import { ballotOf } from "./afters";
  import { goesByOf } from "./names";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  const positionOf = (id: number) => PLAYERS.find((p) => p.id === id)?.position;
  const ballot = $derived(ballotOf(tournament, me().id, { positionOf }));
  const left = $derived(ballot.filter((b) => b.mine === null));

  let open = $state(false);
  let chosen = $state<Record<string, number | null>>({});
  let busy = $state(false);
  const ready = $derived(left.filter((b) => chosen[b.award.name]));
  async function cast() {
    if (busy || !ready.length) return;
    busy = true;
    try {
      const done = await castVotes(
        tournament.id,
        ready.map((b) => ({ award: b.award.name, memberId: chosen[b.award.name]! })),
      );
      if (done) {
        chosen = {};
        open = false;
      }
    } finally {
      busy = false;
    }
  }
  const nameOf = (id: number | null) => goesByOf(PLAYERS.find((p) => p.id === id));
</script>

{#if ballot.length}
  <DraftStep {type} mark="awards" title={left.length ? "Cast your vote" : "Your votes are in"}>
    {#if left.length}
      {left.length === 1 ? `${left[0].award.name}: one vote, secret.` : `${left.length} awards, one vote each, secret.`}
      Not for yourself. We checked.
    {:else}
      Sealed till the reveal. Nobody sees who you chose. Waiting for the reveal.
    {/if}
    {#snippet action()}
      <button class="btn primary" onclick={() => (open = true)}
        ><Icon name="medal" size={18} />{left.length ? "Vote" : "Your votes"}</button
      >
    {/snippet}
  </DraftStep>

  <Sheet
    bind:open
    title="Cast your vote"
    sub="One each, secret. Voting closes when the awards are confirmed."
    tall
    lazy
  >
    <div class="ballot">
      {#each ballot as b (b.award.name)}
        <section class="award" aria-labelledby="vote-{b.award.name}">
          <h3 class="award-name" id="vote-{b.award.name}">{b.award.name}</h3>
          {#if b.award.about}<p class="hint">{b.award.about}</p>{/if}
          {#if b.mine !== null}
            <p class="mine"><Icon name="check" size={16} />Your vote: <b>{nameOf(b.mine)}</b></p>
          {:else}
            <PeopleChoice
              {tournament}
              people={b.candidates}
              bind:value={() => chosen[b.award.name] ?? null, (v) => (chosen[b.award.name] = v)}
              aria-label="Your vote for {b.award.name}"
            />
          {/if}
        </section>
      {/each}
    </div>
    {#snippet footer()}
      {#if left.length}
        <button class="btn primary cast" disabled={busy || !ready.length} onclick={cast}
          ><Icon name="check" size={18} />{ready.length > 1 ? `Cast ${ready.length} votes` : "Cast your vote"}</button
        >
      {/if}
    {/snippet}
  </Sheet>
{/if}

<style>
  .ballot {
    display: grid;
    gap: var(--s-6);
  }
  .award {
    display: grid;
    gap: var(--s-2);
  }
  .award-name {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .award .hint {
    margin: 0;
  }
  .mine {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 3.5rem;
    margin: 0;
    color: var(--fg-muted);
  }
  .mine b {
    color: var(--fg);
  }
  .cast {
    width: 100%;
    height: 3.5rem;
    gap: var(--s-2);
  }
</style>
