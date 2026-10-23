<script lang="ts">
  // A series' or a tournament's awards (ADR 0044), in its editor: each award's name, what it's for, and how it's
  // decided: a stat we track (the table, goals, assists, points, goals against, penalty minutes), a vote (everyone who
  // played, or the skaters for a goalie, with a tie-break), the admin's call live, or a draw. Up to 8. An award saved
  // before it said how shows the old guess from its name (lib/awards.ts withDecidedBy, as the editor loads it), so
  // saving keeps what it did.
  import Icon from "../app/shell/Icon.svelte";
  import Select from "./Select.svelte";
  import {
    DECIDED_BY_OPTIONS,
    TIE_BREAK_OPTIONS,
    decidedByOf,
    fromKey,
    keyOf,
    type Award,
    type DecidedByKey,
    type PlayerStat,
  } from "./awards";

  let { awards = $bindable() }: { awards: Award[] } = $props();
  const MAX_AWARDS = 8;

  const tieBreakOf = (a: Award) => (a.decidedBy?.kind === "vote" ? (a.decidedBy.tieBreak ?? "") : "");
  function setTieBreak(a: Award, v: string) {
    if (a.decidedBy?.kind !== "vote") return;
    const { tieBreak: _, ...rest } = a.decidedBy;
    a.decidedBy = v ? { ...rest, tieBreak: v as PlayerStat } : rest;
  }
</script>

{#each awards as award, i (i)}
  <div class="award">
    <input class="input" aria-label="Award" placeholder="e.g. Best goalie" maxlength="40" bind:value={award.name} />
    <input
      class="input"
      aria-label="What it's for"
      placeholder="e.g. Voted by the skaters they stopped"
      maxlength="120"
      bind:value={award.about}
    />
    <button
      type="button"
      class="btn sm ghost"
      aria-label="Remove {award.name || 'this award'}"
      onclick={() => awards.splice(i, 1)}
    >
      <Icon name="x" size={16} />
    </button>
    <div class="how">
      <Select
        id="award-how-{i}"
        size="sm"
        aria-label="How {award.name || 'it'}'s decided"
        options={[...DECIDED_BY_OPTIONS]}
        bind:value={
          () => keyOf(decidedByOf(award)), (v: DecidedByKey) => (award.decidedBy = fromKey(v, award.decidedBy))
        }
      />
      {#if award.decidedBy?.kind === "vote"}
        <Select
          id="award-tie-{i}"
          size="sm"
          aria-label="A tie on votes is broken by"
          options={[...TIE_BREAK_OPTIONS]}
          bind:value={() => tieBreakOf(award), (v: string) => setTieBreak(award, v)}
        />
      {/if}
    </div>
    {#if award.decidedBy?.kind === "live"}
      <p class="hint how-said">
        At the reveal you name it ({award.decidedBy.options.slice(0, 2).join(", ")}… or your own) and choose who.
      </p>
    {:else if award.decidedBy?.kind === "vote"}
      <p class="hint how-said">
        {award.decidedBy.voters === "skaters"
          ? "The skaters who played vote for a goalie"
          : "Everyone who played votes"}, from the last match till it's revealed. One each, secret, never for yourself.
      </p>
    {/if}
  </div>
{/each}
{#if awards.length < MAX_AWARDS}
  <button
    type="button"
    class="btn sm add-award"
    onclick={() => awards.push({ name: "", about: "", decidedBy: fromKey("live") })}
  >
    <Icon name="plus" size={16} />Award
  </button>
{/if}

<style>
  /* An award: its name, then what it's for (wider), and remove; how it's decided under them */
  .award {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto;
    gap: var(--s-2);
    align-items: center;
  }
  .award + .award {
    padding-top: var(--s-3);
  }
  .how {
    grid-column: 1 / span 2;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .how-said {
    grid-column: 1 / span 2;
    margin: 0;
  }
  .add-award {
    justify-self: start;
  }
  @container (max-width: 34rem) {
    .award {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .award > input:nth-child(2) {
      grid-row: 2;
    }
    .how,
    .how-said {
      grid-column: 1 / -1;
    }
  }
</style>
