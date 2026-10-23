<script lang="ts">
  // What a tournament is (ADR 0030): its name and its type (teams enter, or captains draft), and in the editor its
  // series (`series`, the editor's own picker, which copies the series' defaults in). In the wizard's Details step
  // (Advanced) and the editor's Details tab alike.
  import type { Snippet } from "svelte";
  import FormSection from "./FormSection.svelte";
  import { TOURNAMENT_KINDS } from "../demo/model";
  import type { TournamentForm } from "./tournament-form";

  let {
    form = $bindable(),
    id,
    placeholder = "e.g. Winter Cup",
    kindFixed = false,
    series,
  }: {
    form: TournamentForm;
    /** The fields' ids start with it ("quick", "date") */
    id: string;
    placeholder?: string;
    /** It has teams, so its type stays (ADR 0030) */
    kindFixed?: boolean;
    /** The series picker, first, where it can change */
    series?: Snippet;
  } = $props();
</script>

<FormSection title="What">
  {@render series?.()}
  <label class="field">Name <input id="{id}-name" class="input" bind:value={form.name} {placeholder} required /></label>
  <div class="field">
    <span id="{id}-kind">Type</span>
    <div class="seg kind" role="group" aria-labelledby="{id}-kind">
      {#each TOURNAMENT_KINDS as k (k.id)}
        <button
          type="button"
          aria-pressed={form.kind === k.id}
          disabled={kindFixed && form.kind !== k.id}
          onclick={() => (form.kind = k.id)}
        >
          {k.label}
        </button>
      {/each}
    </div>
    <span class="hint small"
      >{TOURNAMENT_KINDS.find((k) => k.id === form.kind)?.hint}{kindFixed
        ? " It has teams, so its type stays."
        : ""}</span
    >
  </div>
</FormSection>

<style>
  .kind {
    justify-self: start;
  }
</style>
