<script lang="ts">
  // A draft's day (ADR 0060, 0074): a reminder for the captains, opened on the night. In the wizard's Teams step and
  // the editor's Draft & teams tab alike.
  import FormSection from "./FormSection.svelte";
  import DateField from "./DateField.svelte";
  import { londonToday } from "./dates";
  import { formDay, type TournamentForm } from "./tournament-form";

  let {
    form = $bindable(),
    id,
    future = false,
  }: {
    form: TournamentForm;
    /** The fields' ids start with it ("quick", "date") */
    id: string;
    /** A new one: the day can't be in the past */
    future?: boolean;
  } = $props();
</script>

<FormSection
  title="Draft"
  description="Captains choose in snake order on the Draft page. The day's a reminder for them; you open it on the night. Not set yet? It shows as TBC."
>
  <div class="cols">
    <div class="field">
      Draft day <DateField
        id="{id}-draft"
        aria-label="Draft day"
        placeholder="TBC"
        min={future ? londonToday() : undefined}
        max={formDay(form)}
        bind:value={form.draftOn}
      />
    </div>
  </div>
</FormSection>

<style>
  .cols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-5) var(--s-4);
  }
</style>
