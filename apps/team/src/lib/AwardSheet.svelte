<script lang="ts">
  // One award, opened from its row in a series' or a tournament's editor (ADR 0044, 0065): its name, its line, how
  // it's decided (and a vote's tie-break), and what that means on the night. Changes go straight into the editor's
  // form, saved with the editor's Save; Done closes it, Remove takes the award off (asking once).
  import Sheet from "./Sheet.svelte";
  import Select from "./Select.svelte";
  import {
    DECIDED_BY_OPTIONS,
    TIE_BREAK_OPTIONS,
    decidedByHint,
    decidedByOf,
    fromKey,
    keyOf,
    type Award,
    type DecidedByKey,
    type PlayerStat,
  } from "./awards";

  let {
    award = $bindable(),
    open = $bindable(false),
    isNew = false,
    onremove,
    onclose,
  }: {
    award: Award;
    open?: boolean;
    /** Just added: its name is where it starts. */
    isNew?: boolean;
    onremove: () => void;
    onclose?: () => void;
  } = $props();

  const how = $derived(decidedByOf(award));
  const tieBreak = $derived(how.kind === "vote" ? (how.tieBreak ?? "") : "");
  function setTieBreak(value: string) {
    if (award.decidedBy?.kind !== "vote") return;
    const { tieBreak: _, ...vote } = award.decidedBy;
    award.decidedBy = value ? { ...vote, tieBreak: value as PlayerStat } : vote;
  }

  // Remove asks once: a second tap takes it off
  let sure = $state(false);
  function remove() {
    if (!sure && award.name.trim()) return void (sure = true);
    open = false;
    onremove();
  }
</script>

<Sheet
  bind:open
  title={isNew ? "New award" : award.name || "Award"}
  onclose={() => {
    sure = false;
    onclose?.();
  }}
>
  <div class="form">
    <label class="field">
      Name
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" maxlength="40" placeholder="e.g. Best keeper" autofocus={isNew} bind:value={award.name} />
    </label>
    <label class="field">
      <span>Its line <span class="hint">· on the website and at the reveal</span></span>
      <input class="input" maxlength="120" placeholder="e.g. Bribes were accepted." bind:value={award.about} />
    </label>
    <div class="field">
      Decided by
      <Select
        id="award-how"
        aria-label="Decided by"
        options={[...DECIDED_BY_OPTIONS]}
        bind:value={() => keyOf(how), (key: DecidedByKey) => (award.decidedBy = fromKey(key, award.decidedBy))}
      />
    </div>
    {#if how.kind === "vote"}
      <div class="field">
        A tie on votes goes to
        <Select
          id="award-tie"
          aria-label="A tie on votes goes to"
          options={[...TIE_BREAK_OPTIONS]}
          bind:value={() => tieBreak, setTieBreak}
        />
      </div>
    {/if}
    <p class="hint">{decidedByHint(how)}</p>
  </div>
  {#snippet footer()}
    <button type="button" class="btn ghost remove" onclick={remove} onblur={() => (sure = false)}>
      {sure ? "Sure? Remove it" : "Remove"}
    </button>
    <button type="button" class="btn primary" onclick={() => (open = false)}>Done</button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    gap: var(--s-4);
  }
  .form .hint {
    margin: 0;
  }
  /* Red words, never a red fill */
  .remove {
    color: var(--red-hot);
  }
</style>
