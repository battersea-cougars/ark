<script lang="ts">
  // The ballot (ADR 0044): one sheet, each voted award, its line, and who you can vote for, a row each; a vote cast
  // is yours to see, and only yours. Cast, you're taken on to the awards' own page, to wait for the reveal there.
  // Opened from the awards' card at the after-party and from the awards' page.
  import { castVotes } from "../app/backend.svelte";
  import { navigate } from "../app/router.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { PLAYERS } from "../demo/data";
  import type { Tournament, TournamentType } from "../demo/model";
  import PeopleChoice from "./PeopleChoice.svelte";
  import Sheet from "./Sheet.svelte";
  import type { Ballot } from "./afters";
  import { goesByOf } from "./names";

  let {
    type,
    tournament,
    ballot,
    open = $bindable(false),
  }: { type: TournamentType; tournament: Tournament; ballot: Ballot; open?: boolean } = $props();

  const left = $derived(ballot.filter((b) => b.mine === null));
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
        navigate(`/tournaments/${type.slug}/awards`);
      }
    } finally {
      busy = false;
    }
  }
  const nameOf = (id: number | null) => goesByOf(PLAYERS.find((p) => p.id === id));
</script>

<Sheet bind:open title="Cast your vote" sub="One each, secret. Voting closes when the awards are confirmed." tall lazy>
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
