<script lang="ts">
  // How a tournament is played (ADR 0030, 0061): its rules, its playoffs and its awards, copied from its series and
  // changed here for this one alone. In the wizard's Rules step (Advanced) and the editor's Rules & awards tab alike.
  import FormSection from "./FormSection.svelte";
  import Choice from "./Choice.svelte";
  import PlayoffsField from "./PlayoffsField.svelte";
  import AwardsField from "./AwardsField.svelte";
  import { PENALTY_LENGTH_OPTIONS, PENALTY_RULE_OPTIONS } from "./penalties";
  import { PERIOD_OPTIONS } from "./periods";
  import type { TournamentForm } from "./tournament-form";

  let {
    form = $bindable(),
    award = $bindable(null),
  }: {
    form: TournamentForm;
    /** The award whose sheet is open, by its place in the list; null: none */
    award?: number | null;
  } = $props();
</script>

<FormSection title="Rules" description="Round robin: every team plays every other once.">
  <div class="fit">
    <div class="cols">
      <label class="field"
        >Points for a win <input class="input num" type="number" min="0" bind:value={form.pointsWin} /></label
      >
      <label class="field">A draw <input class="input num" type="number" min="0" bind:value={form.pointsDraw} /></label>
      <label class="field">A loss <input class="input num" type="number" min="0" bind:value={form.pointsLoss} /></label>
      <label class="field">
        Minutes a period
        <input class="input num" type="number" min="1" max="90" bind:value={form.gameMinutes} />
      </label>
      <label class="field">
        Break between periods
        <!-- One period: no break to have -->
        <input
          class="input num"
          type="number"
          min="0"
          max="15"
          disabled={form.periods === 1}
          bind:value={form.breakMinutes}
        />
      </label>
    </div>
  </div>
  <div class="field">
    Periods
    <Choice
      bind:value={() => String(form.periods), (v) => (form.periods = Number(v))}
      options={PERIOD_OPTIONS}
      aria-label="Periods"
    />
  </div>
  <div class="field">
    Penalties
    <Choice bind:value={form.penaltyRule} options={PENALTY_RULE_OPTIONS} aria-label="Penalties" />
  </div>
  <div class="field">
    Usual penalty
    <Choice
      bind:value={() => String(form.defaultPenaltyMinutes), (v) => (form.defaultPenaltyMinutes = Number(v))}
      options={PENALTY_LENGTH_OPTIONS}
      aria-label="Usual penalty"
    />
  </div>
</FormSection>
<FormSection title="Playoffs" description="After the round robin, by place in the table.">
  <PlayoffsField bind:playoffs={form.playoffs} teams={form.teams.length} />
</FormSection>
<FormSection
  title="Awards"
  description="This one's own (a series' edition starts with the series'): handed out on the day, and shown on the website."
>
  <AwardsField bind:awards={form.awards} bind:open={award} />
</FormSection>

<style>
  /* Three to a row, wrapping on, so every field lines up with the ones above it; one on a phone */
  .fit {
    container-type: inline-size;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-5) var(--s-4);
    align-items: start;
  }
  @container (max-width: 30rem) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
